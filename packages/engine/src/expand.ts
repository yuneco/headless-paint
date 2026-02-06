import { mat3, vec2 } from "gl-matrix";
import type { CompiledExpand, ExpandConfig, Point } from "./types";

/**
 * デフォルトの展開設定を作成
 */
export function createDefaultExpandConfig(
  width: number,
  height: number,
): ExpandConfig {
  return {
    mode: "none",
    origin: { x: width / 2, y: height / 2 },
    angle: 0,
    divisions: 1,
  };
}

/**
 * 展開設定をコンパイル（変換行列を事前計算）
 * 設定変更時に1回だけ呼び出す
 */
export function compileExpand(config: ExpandConfig): CompiledExpand {
  const matrices: mat3[] = [];

  switch (config.mode) {
    case "none":
      matrices.push(mat3.create());
      break;

    case "axial":
      matrices.push(mat3.create());
      matrices.push(createAxialReflectionMatrix(config.origin, config.angle));
      break;

    case "radial":
      for (let i = 0; i < config.divisions; i++) {
        const angle = (2 * Math.PI * i) / config.divisions + config.angle;
        matrices.push(createRotationMatrix(config.origin, angle));
      }
      break;

    case "kaleidoscope":
      for (let i = 0; i < config.divisions; i++) {
        const baseAngle = (2 * Math.PI * i) / config.divisions + config.angle;
        matrices.push(createRotationMatrix(config.origin, baseAngle));
        const reflectionAngle = baseAngle + Math.PI / config.divisions;
        matrices.push(
          createRotationReflectionMatrix(
            config.origin,
            baseAngle,
            reflectionAngle,
          ),
        );
      }
      break;
  }

  return {
    config,
    matrices: matrices as unknown as Float32Array[],
    outputCount: matrices.length,
  };
}

/**
 * 単一の点を展開する
 */
export function expandPoint(point: Point, compiled: CompiledExpand): Point[] {
  const inputVec = vec2.fromValues(point.x, point.y);
  const outputVec = vec2.create();
  const result: Point[] = [];

  for (const matrix of compiled.matrices) {
    vec2.transformMat3(outputVec, inputVec, matrix as unknown as mat3);
    result.push({ x: outputVec[0], y: outputVec[1] });
  }

  return result;
}

/**
 * ストローク全体を展開する
 */
export function expandStroke(
  points: readonly Point[],
  compiled: CompiledExpand,
): Point[][] {
  if (points.length === 0) {
    return Array(compiled.outputCount)
      .fill(null)
      .map(() => []);
  }

  const strokes: Point[][] = Array(compiled.outputCount)
    .fill(null)
    .map(() => []);

  for (const point of points) {
    const expanded = expandPoint(point, compiled);
    for (let i = 0; i < expanded.length; i++) {
      strokes[i].push(expanded[i]);
    }
  }

  return strokes;
}

/**
 * 展開設定の出力数を取得
 */
export function getExpandCount(config: ExpandConfig): number {
  switch (config.mode) {
    case "none":
      return 1;
    case "axial":
      return 2;
    case "radial":
      return config.divisions;
    case "kaleidoscope":
      return config.divisions * 2;
  }
}

// ============================================================
// 行列生成ヘルパー（内部関数）
// ============================================================

function createRotationMatrix(origin: Point, angle: number): mat3 {
  const result = mat3.create();
  mat3.translate(result, result, vec2.fromValues(origin.x, origin.y));
  mat3.rotate(result, result, angle);
  mat3.translate(result, result, vec2.fromValues(-origin.x, -origin.y));
  return result;
}

function createAxialReflectionMatrix(origin: Point, axisAngle: number): mat3 {
  const result = mat3.create();
  mat3.translate(result, result, vec2.fromValues(origin.x, origin.y));
  mat3.rotate(result, result, -axisAngle);
  const flipY = mat3.fromValues(-1, 0, 0, 0, 1, 0, 0, 0, 1);
  mat3.multiply(result, result, flipY);
  mat3.rotate(result, result, axisAngle);
  mat3.translate(result, result, vec2.fromValues(-origin.x, -origin.y));
  return result;
}

function createRotationReflectionMatrix(
  origin: Point,
  rotationAngle: number,
  reflectionAxisAngle: number,
): mat3 {
  const reflection = createAxialReflectionMatrix(origin, reflectionAxisAngle);
  const rotation = createRotationMatrix(origin, rotationAngle);
  const result = mat3.create();
  mat3.multiply(result, rotation, reflection);
  return result;
}
