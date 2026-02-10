import { mat3 } from "gl-matrix";
import type { Point, TransformComponents, ViewTransform } from "./types";

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
    inverse[0] * screenCenter[0] + inverse[3] * screenCenter[1] + inverse[6];
  layerCenter[1] =
    inverse[1] * screenCenter[0] + inverse[4] * screenCenter[1] + inverse[7];

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
 * レイヤー全体がビューポートに収まるビュー変換を作成する。
 * 初期表示・リセット時に使用する。
 *
 * @param viewWidth ビューポートの幅（Screen Space）
 * @param viewHeight ビューポートの高さ（Screen Space）
 * @param layerWidth レイヤーの幅（Layer Space）
 * @param layerHeight レイヤーの高さ（Layer Space）
 * @returns レイヤーをビュー中央にフィットさせるビュー変換
 */
export function fitToView(
  viewWidth: number,
  viewHeight: number,
  layerWidth: number,
  layerHeight: number,
): ViewTransform {
  const scale = Math.min(viewWidth / layerWidth, viewHeight / layerHeight);
  const offsetX = (viewWidth - layerWidth * scale) / 2;
  const offsetY = (viewHeight - layerHeight * scale) / 2;

  let t = createViewTransform();
  t = zoom(t, scale, 0, 0);
  t = pan(t, offsetX, offsetY);
  return t;
}

/**
 * ビュー変換に Device Pixel Ratio スケーリングを適用する。
 * Canvas API の描画時に、論理ピクセルと物理ピクセルの対応を取るために使用する。
 *
 * @param transform 適用元のビュー変換
 * @param dpr Device Pixel Ratio（通常は `window.devicePixelRatio`）
 * @returns DPR スケーリングが適用された新しいビュー変換
 */
export function applyDpr(transform: ViewTransform, dpr: number): ViewTransform {
  const result = mat3.clone(transform);
  result[0] *= dpr;
  result[1] *= dpr;
  result[3] *= dpr;
  result[4] *= dpr;
  result[6] *= dpr;
  result[7] *= dpr;
  return result;
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

/**
 * 2組の点対応から相似変換を計算する。
 * ピンチジェスチャーで使用し、指の下のレイヤー座標が完全に保存される（ドリフトゼロ）。
 *
 * @param layerP1 1本目の指のレイヤー座標（ジェスチャー開始時に記録）
 * @param layerP2 2本目の指のレイヤー座標（ジェスチャー開始時に記録）
 * @param screenP1 1本目の指の現在のスクリーン座標
 * @param screenP2 2本目の指の現在のスクリーン座標
 * @returns 相似変換行列。2つのレイヤー座標が一致する場合 null
 */
export function computeSimilarityTransform(
  layerP1: Point,
  layerP2: Point,
  screenP1: Point,
  screenP2: Point,
): ViewTransform | null {
  const dLx = layerP2.x - layerP1.x;
  const dLy = layerP2.y - layerP1.y;
  const denom = dLx * dLx + dLy * dLy;

  if (denom < 1e-10) return null;

  const dSx = screenP2.x - screenP1.x;
  const dSy = screenP2.y - screenP1.y;

  const a = (dSx * dLx + dSy * dLy) / denom;
  const b = (dSy * dLx - dSx * dLy) / denom;
  const tx = screenP1.x - a * layerP1.x + b * layerP1.y;
  const ty = screenP1.y - b * layerP1.x - a * layerP1.y;

  // mat3 column-major: [a, b, 0, -b, a, 0, tx, ty, 1]
  const result = mat3.create();
  result[0] = a;
  result[1] = b;
  result[3] = -b;
  result[4] = a;
  result[6] = tx;
  result[7] = ty;
  return result;
}
