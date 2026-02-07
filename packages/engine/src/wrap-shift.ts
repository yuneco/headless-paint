import type { Layer } from "./types";

/**
 * レイヤーの全ピクセルをラップシフト（GPU加速drawImage使用）。
 * 整数シフトはモジュロ演算により完全可逆: shift(+dx) → shift(-dx) = 恒等。
 *
 * @param layer  対象レイヤー
 * @param dx     水平シフト量（ピクセル、正=右）
 * @param dy     垂直シフト量（ピクセル、正=下）
 * @param temp   再利用可能なtempキャンバス（省略時は内部で生成）
 */
export function wrapShiftLayer(
  layer: Layer,
  dx: number,
  dy: number,
  temp?: OffscreenCanvas,
): void {
  const w = layer.width;
  const h = layer.height;

  // モジュロ正規化（常に 0 <= sdx < w, 0 <= sdy < h）
  const sdx = ((dx % w) + w) % w;
  const sdy = ((dy % h) + h) % h;

  if (sdx === 0 && sdy === 0) return;

  const tempCanvas = temp ?? new OffscreenCanvas(w, h);
  // tempキャンバスのサイズが合わない場合はリサイズ
  if (tempCanvas.width !== w || tempCanvas.height !== h) {
    tempCanvas.width = w;
    tempCanvas.height = h;
  }

  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return;

  // 1. tempにコピー
  tempCtx.clearRect(0, 0, w, h);
  tempCtx.drawImage(layer.canvas, 0, 0);

  // 2. レイヤーをクリアして4象限drawImage
  layer.ctx.clearRect(0, 0, w, h);
  layer.ctx.drawImage(tempCanvas, sdx, sdy);
  layer.ctx.drawImage(tempCanvas, sdx - w, sdy);
  layer.ctx.drawImage(tempCanvas, sdx, sdy - h);
  layer.ctx.drawImage(tempCanvas, sdx - w, sdy - h);
}
