import { mat3, vec2 } from "gl-matrix";
import type { CompiledSymmetry, Point, SymmetryConfig } from "./types";

/**
 * デフォルトの対称設定を作成
 */
export function createDefaultSymmetryConfig(
  layerWidth: number,
  layerHeight: number,
): SymmetryConfig {
  return {
    mode: "none",
    origin: { x: layerWidth / 2, y: layerHeight / 2 },
    angle: 0, // 垂直軸
    divisions: 6,
  };
}

/**
 * 対称設定をコンパイル（変換行列を事前計算）
 * 設定変更時に1回だけ呼び出す
 */
export function compileSymmetry(config: SymmetryConfig): CompiledSymmetry {
  const matrices: mat3[] = [];

  switch (config.mode) {
    case "none":
      // 恒等変換のみ
      matrices.push(mat3.create());
      break;

    case "axial":
      // 元の点 + 線対称に反射した点
      matrices.push(mat3.create());
      matrices.push(createAxialReflectionMatrix(config.origin, config.angle));
      break;

    case "radial":
      // N分割の回転
      for (let i = 0; i < config.divisions; i++) {
        const angle = (2 * Math.PI * i) / config.divisions + config.angle;
        matrices.push(createRotationMatrix(config.origin, angle));
      }
      break;

    case "kaleidoscope":
      // N分割の回転 + 各セグメントで反射
      for (let i = 0; i < config.divisions; i++) {
        const baseAngle = (2 * Math.PI * i) / config.divisions + config.angle;

        // 偶数: 純粋回転
        matrices.push(createRotationMatrix(config.origin, baseAngle));

        // 奇数: 回転 + 反射
        const reflectionAngle = baseAngle + Math.PI / config.divisions;
        matrices.push(
          createRotationReflectionMatrix(config.origin, baseAngle, reflectionAngle),
        );
      }
      break;
  }

  return { config, matrices };
}

/**
 * 点を対称変換で展開
 * ストローク中の各点で呼び出す（高速）
 */
export function expandSymmetry(
  point: Point,
  compiled: CompiledSymmetry,
): Point[] {
  const inputVec = vec2.fromValues(point.x, point.y);
  const outputVec = vec2.create();
  const result: Point[] = [];

  for (const matrix of compiled.matrices) {
    vec2.transformMat3(outputVec, inputVec, matrix);
    result.push({ x: outputVec[0], y: outputVec[1] });
  }

  return result;
}

/**
 * 対称変換で生成される点の数を取得
 */
export function getSymmetryCount(config: SymmetryConfig): number {
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
// 行列生成ヘルパー
// ============================================================

/**
 * 原点を中心とした回転行列を作成
 * R = T(origin) × Rotate(angle) × T(-origin)
 *
 * gl-matrixでは mat3.op(out, a, b) は out = a * b なので、
 * 左から右の順に掛けていく
 */
function createRotationMatrix(origin: Point, angle: number): mat3 {
  const result = mat3.create();

  // T(origin)
  mat3.translate(result, result, vec2.fromValues(origin.x, origin.y));

  // Rotate(angle)
  mat3.rotate(result, result, angle);

  // T(-origin)
  mat3.translate(result, result, vec2.fromValues(-origin.x, -origin.y));

  return result;
}

/**
 * 線対称（軸反射）行列を作成
 * R = T(origin) × Rotate(-θ) × FlipY × Rotate(θ) × T(-origin)
 *
 * FlipYを使用: Y座標を反転して軸に対して反射
 * angle=0 のとき垂直軸（左右対称）
 */
function createAxialReflectionMatrix(origin: Point, axisAngle: number): mat3 {
  const result = mat3.create();

  // T(origin)
  mat3.translate(result, result, vec2.fromValues(origin.x, origin.y));

  // Rotate(-θ) - 元の角度に戻す
  mat3.rotate(result, result, -axisAngle);

  // FlipY - Y軸を中心に反射（X座標を反転）
  // angle=0で垂直軸に対して左右反射したいので、X座標を反転
  const flipY = mat3.fromValues(-1, 0, 0, 0, 1, 0, 0, 0, 1);
  mat3.multiply(result, result, flipY);

  // Rotate(θ) - 軸を水平にする
  mat3.rotate(result, result, axisAngle);

  // T(-origin)
  mat3.translate(result, result, vec2.fromValues(-origin.x, -origin.y));

  return result;
}

/**
 * 回転 + 反射の複合行列を作成（万華鏡用）
 */
function createRotationReflectionMatrix(
  origin: Point,
  rotationAngle: number,
  reflectionAxisAngle: number,
): mat3 {
  // まず反射
  const reflection = createAxialReflectionMatrix(origin, reflectionAxisAngle);

  // 次に回転
  const rotation = createRotationMatrix(origin, rotationAngle);

  // 反射 → 回転 の順序で合成
  const result = mat3.create();
  mat3.multiply(result, rotation, reflection);

  return result;
}
