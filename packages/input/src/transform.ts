import { mat3 } from "gl-matrix";
import type { ViewTransform, TransformComponents } from "./types";

/**
 * 単位行列のビュー変換を作成
 */
export function createViewTransform(): ViewTransform {
  return mat3.create();
}

/**
 * ビュー変換に平行移動を適用
 * @param transform 現在のビュー変換
 * @param dx X方向の移動量（Screen Space）
 * @param dy Y方向の移動量（Screen Space）
 * @returns 新しいビュー変換
 */
export function pan(
  transform: ViewTransform,
  dx: number,
  dy: number,
): ViewTransform {
  const result = mat3.clone(transform);
  const translation = mat3.fromTranslation(mat3.create(), [dx, dy]);
  return mat3.multiply(result, translation, result);
}

/**
 * 中心点を基準にズームを適用
 * @param transform 現在のビュー変換
 * @param scale スケール倍率（1.0 = 等倍）
 * @param centerX ズーム中心のX座標（Screen Space）
 * @param centerY ズーム中心のY座標（Screen Space）
 * @returns 新しいビュー変換
 */
export function zoom(
  transform: ViewTransform,
  scale: number,
  centerX: number,
  centerY: number,
): ViewTransform {
  const result = mat3.clone(transform);

  // 1. 中心点を原点に移動
  const toOrigin = mat3.fromTranslation(mat3.create(), [-centerX, -centerY]);
  // 2. スケール適用
  const scaling = mat3.fromScaling(mat3.create(), [scale, scale]);
  // 3. 中心点を元に戻す
  const fromOrigin = mat3.fromTranslation(mat3.create(), [centerX, centerY]);

  // 合成: fromOrigin * scaling * toOrigin * transform
  mat3.multiply(result, toOrigin, result);
  mat3.multiply(result, scaling, result);
  mat3.multiply(result, fromOrigin, result);

  return result;
}

/**
 * 中心点を基準に回転を適用
 * Screen Space の中心座標に対応する Layer Space の点を軸に回転する。
 * これにより、ビューポート中心に表示されているコンテンツがその場で回転する。
 *
 * @param transform 現在のビュー変換
 * @param angleRad 回転角度（ラジアン、正=反時計回り）
 * @param centerX 回転中心のX座標（Screen Space）
 * @param centerY 回転中心のY座標（Screen Space）
 * @returns 新しいビュー変換
 */
export function rotate(
  transform: ViewTransform,
  angleRad: number,
  centerX: number,
  centerY: number,
): ViewTransform {
  // Screen Space の中心に対応する Layer Space の点を求める
  const inverse = invertViewTransform(transform);
  if (!inverse) return transform;

  const screenCenter = [centerX, centerY] as const;
  const layerCenter = [0, 0];
  layerCenter[0] =
    inverse[0] * screenCenter[0] +
    inverse[3] * screenCenter[1] +
    inverse[6];
  layerCenter[1] =
    inverse[1] * screenCenter[0] +
    inverse[4] * screenCenter[1] +
    inverse[7];

  // Layer Space で中心基準の回転を適用
  // newTransform = transform * fromLayerOrigin * rotation * toLayerOrigin
  const toLayerOrigin = mat3.fromTranslation(mat3.create(), [
    -layerCenter[0],
    -layerCenter[1],
  ]);
  const rotation = mat3.fromRotation(mat3.create(), angleRad);
  const fromLayerOrigin = mat3.fromTranslation(mat3.create(), [
    layerCenter[0],
    layerCenter[1],
  ]);

  const result = mat3.clone(transform);
  mat3.multiply(result, result, fromLayerOrigin);
  mat3.multiply(result, result, rotation);
  mat3.multiply(result, result, toLayerOrigin);

  return result;
}

/**
 * ビュー変換の逆変換を計算
 * @param transform 逆変換を求める対象
 * @returns 逆変換行列。逆行列が存在しない場合は null
 */
export function invertViewTransform(
  transform: ViewTransform,
): ViewTransform | null {
  const result = mat3.create();
  const inverted = mat3.invert(result, transform);
  return inverted ? result : null;
}

/**
 * ビュー変換行列を個別の変換成分に分解
 *
 * 行列構造（column-major, gl-matrix形式）:
 * [a, b, 0, c, d, 0, tx, ty, 1]
 *  0  1  2  3  4  5   6   7  8
 *
 * @param transform 分解対象のビュー変換
 * @returns 変換成分（スケール、回転、平行移動）
 */
export function decomposeTransform(
  transform: ViewTransform,
): TransformComponents {
  const a = transform[0];
  const b = transform[1];
  const c = transform[3];
  const d = transform[4];

  return {
    scaleX: Math.sqrt(a * a + b * b),
    scaleY: Math.sqrt(c * c + d * d),
    rotation: Math.atan2(b, a),
    translateX: transform[6],
    translateY: transform[7],
  };
}
