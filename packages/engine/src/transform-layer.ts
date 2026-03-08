import type { mat3 } from "gl-matrix";
import type { Layer } from "./types";

/**
 * アフィン変換をピクセルに焼き込む。
 * temp canvas にコピー → clear → setTransform(matrix) で drawImage。
 * wrapShiftLayer と同じ temp canvas パターン。
 *
 * @param layer  対象レイヤー
 * @param matrix 適用するアフィン変換行列（gl-matrix の mat3 形式）
 * @param temp   再利用可能なtempキャンバス（省略時は内部で生成）
 */
export function transformLayer(
  layer: Layer,
  matrix: mat3,
  temp?: OffscreenCanvas,
): void {
  const w = layer.width;
  const h = layer.height;

  const tempCanvas = temp ?? new OffscreenCanvas(w, h);
  if (tempCanvas.width !== w || tempCanvas.height !== h) {
    tempCanvas.width = w;
    tempCanvas.height = h;
  }

  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return;

  // 1. temp にコピー
  tempCtx.clearRect(0, 0, w, h);
  tempCtx.drawImage(layer.canvas, 0, 0);

  // 2. レイヤーをクリアし、変換を適用して描画
  layer.ctx.clearRect(0, 0, w, h);
  layer.ctx.save();
  // mat3 column-major: [m00, m01, -, m10, m11, -, m20, m21, -]
  // setTransform(a, b, c, d, e, f): a=m00, b=m01, c=m10, d=m11, e=m20, f=m21
  layer.ctx.setTransform(
    matrix[0],
    matrix[1],
    matrix[3],
    matrix[4],
    matrix[6],
    matrix[7],
  );
  layer.ctx.drawImage(tempCanvas, 0, 0);
  layer.ctx.restore();
}
