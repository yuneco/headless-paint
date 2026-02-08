import { mat3, vec2 } from "gl-matrix";
import type {
  CompiledExpand,
  ExpandConfig,
  ExpandLevel,
  ExpandMode,
  Point,
  StrokePoint,
} from "./types";

/**
 * デフォルトの展開設定を作成
 */
export function createDefaultExpandConfig(
  width: number,
  height: number,
): ExpandConfig {
  return {
    levels: [
      {
        mode: "none",
        offset: { x: width / 2, y: height / 2 },
        angle: 0,
        divisions: 6,
      },
    ],
  };
}

/**
 * 1レベル分のローカル回転/反射行列を生成
 * angle は T_level 側で処理されるため、ここでは使わない
 */
export function compileLocalTransforms(
  mode: ExpandMode,
  divisions: number,
): mat3[] {
  const results: mat3[] = [];

  switch (mode) {
    case "none":
      results.push(mat3.create());
      break;

    case "axial":
      results.push(mat3.create());
      results.push(createLocalReflection(Math.PI / 2));
      break;

    case "radial":
      for (let i = 0; i < divisions; i++) {
        const angle = (2 * Math.PI * i) / divisions;
        const r = mat3.create();
        mat3.rotate(r, r, angle);
        results.push(r);
      }
      break;

    case "kaleidoscope":
      for (let i = 0; i < divisions; i++) {
        const rotAngle = (2 * Math.PI * i) / divisions;
        const r = mat3.create();
        mat3.rotate(r, r, rotAngle);
        results.push(r);

        results.push(createLocalReflection((Math.PI * i) / divisions));
      }
      break;
  }

  return results;
}

/**
 * ローカル空間での反射行列を生成
 * axisAngle は反射軸の角度（ラジアン、x軸からの反時計回り）
 * reflect(axisAngle) = R(axisAngle) * flipY * R(-axisAngle)
 */
function createLocalReflection(axisAngle: number): mat3 {
  const m = mat3.create();
  mat3.rotate(m, m, axisAngle);
  const flipY = mat3.fromValues(1, 0, 0, 0, -1, 0, 0, 0, 1);
  mat3.multiply(m, m, flipY);
  mat3.rotate(m, m, -axisAngle);
  return m;
}

/**
 * 再帰的に多段展開行列を構築
 */
function buildExpandMatrices(
  levels: readonly ExpandLevel[],
  depth: number,
  accumulated: mat3,
): mat3[] {
  const level = levels[depth];

  // T_level: translate(offset) * rotate(effectiveAngle)
  const T = mat3.create();
  mat3.translate(T, T, [level.offset.x, level.offset.y]);
  const effectiveAngle =
    depth === 0
      ? level.angle
      : Math.atan2(level.offset.y, level.offset.x) + level.angle;
  mat3.rotate(T, T, effectiveAngle);

  const base = mat3.multiply(mat3.create(), accumulated, T);
  const localTransforms = compileLocalTransforms(level.mode, level.divisions);

  if (depth === levels.length - 1) {
    // リーフ: base * R をそのまま返す
    return localTransforms.map((R) => mat3.multiply(mat3.create(), base, R));
  }

  // 非リーフ: 各 R について再帰
  return localTransforms.flatMap((R) => {
    const composed = mat3.multiply(mat3.create(), base, R);
    return buildExpandMatrices(levels, depth + 1, composed);
  });
}

/**
 * 展開設定をコンパイル（変換行列を事前計算）
 * 設定変更時に1回だけ呼び出す
 */
export function compileExpand(config: ExpandConfig): CompiledExpand {
  const { levels } = config;

  if (levels.length === 0) {
    return {
      config,
      matrices: [mat3.create() as unknown as Float32Array],
      outputCount: 1,
    };
  }

  const rawMatrices = buildExpandMatrices(levels, 0, mat3.create());

  // 正規化: M_norm(i) = M(i) * inverse(M(0))
  // → 第一出力 = identity (入力位置がそのまま残る)
  const firstInverse = mat3.create();
  mat3.invert(firstInverse, rawMatrices[0]);
  const matrices = rawMatrices.map((m) =>
    mat3.multiply(mat3.create(), m, firstInverse),
  );

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
  const { levels } = config;
  if (levels.length === 0) return 1;

  let count = 1;
  for (const level of levels) {
    switch (level.mode) {
      case "none":
        count *= 1;
        break;
      case "axial":
        count *= 2;
        break;
      case "radial":
        count *= level.divisions;
        break;
      case "kaleidoscope":
        count *= level.divisions * 2;
        break;
    }
  }
  return count;
}

/**
 * StrokePoint版ストローク展開（pressure保持）
 */
export function expandStrokePoints(
  points: readonly StrokePoint[],
  compiled: CompiledExpand,
): StrokePoint[][] {
  if (points.length === 0) {
    return Array(compiled.outputCount)
      .fill(null)
      .map(() => []);
  }

  const inputVec = vec2.create();
  const outputVec = vec2.create();
  const strokes: StrokePoint[][] = Array(compiled.outputCount)
    .fill(null)
    .map(() => []);

  for (const point of points) {
    vec2.set(inputVec, point.x, point.y);
    for (let i = 0; i < compiled.matrices.length; i++) {
      vec2.transformMat3(
        outputVec,
        inputVec,
        compiled.matrices[i] as unknown as mat3,
      );
      strokes[i].push({
        x: outputVec[0],
        y: outputVec[1],
        pressure: point.pressure,
      });
    }
  }

  return strokes;
}
