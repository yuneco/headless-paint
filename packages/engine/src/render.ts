import type { mat3 } from "gl-matrix";
import { colorToStyle } from "./layer";
import type { BackgroundSettings, Layer } from "./types";

export interface RenderOptions {
  background?: BackgroundSettings;
}

/**
 * ビュー変換を適用してレイヤーを描画
 * @param layer 描画するレイヤー
 * @param ctx 描画先のコンテキスト
 * @param transform 適用するビュー変換（mat3形式）
 */
export function renderLayerWithTransform(
  layer: Layer,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  transform: mat3,
): void {
  ctx.save();

  // 拡大時（scale >= 1）はスムージングを無効にしてにじみを防ぐ
  const scale = Math.hypot(transform[0], transform[1]);
  ctx.imageSmoothingEnabled = scale < 1;

  // mat3 を setTransform に適用
  // 呼び出し側でDPRスケーリングを含めた変換行列を渡すことを期待
  // mat3: [a, b, 0, c, d, 0, tx, ty, 1] (column-major)
  // setTransform(a, b, c, d, tx, ty)
  ctx.setTransform(
    transform[0], // a
    transform[1], // b
    transform[3], // c
    transform[4], // d
    transform[6], // tx
    transform[7], // ty
  );

  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}

/**
 * 複数レイヤーを順番に合成描画
 * @param layers 描画するレイヤーの配列（背面から前面順）
 * @param ctx 描画先のコンテキスト
 * @param transform 適用するビュー変換（mat3形式）
 */
export function renderLayers(
  layers: readonly Layer[],
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  transform: mat3,
  options?: RenderOptions,
): void {
  // 拡大時（scale >= 1）はスムージングを無効にしてにじみを防ぐ
  const scale = Math.hypot(transform[0], transform[1]);
  const smoothing = scale < 1;

  // 背景描画（レイヤー領域にビュー変換を適用して描画）
  if (options?.background?.visible && layers.length > 0) {
    const { width, height } = layers[0];
    ctx.save();
    ctx.setTransform(
      transform[0],
      transform[1],
      transform[3],
      transform[4],
      transform[6],
      transform[7],
    );
    ctx.fillStyle = colorToStyle(options.background.color);
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  for (const layer of layers) {
    // 非表示レイヤーはスキップ
    if (!layer.meta.visible) continue;

    ctx.save();

    ctx.imageSmoothingEnabled = smoothing;

    // 不透明度を適用
    ctx.globalAlpha = layer.meta.opacity;

    // mat3 を setTransform に適用
    ctx.setTransform(
      transform[0],
      transform[1],
      transform[3],
      transform[4],
      transform[6],
      transform[7],
    );

    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }
}
