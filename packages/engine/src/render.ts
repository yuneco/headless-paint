import type { mat3 } from "gl-matrix";
import type { Layer } from "./types";

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

  // mat3 を setTransform に適用
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
): void {
  for (const layer of layers) {
    // 非表示レイヤーはスキップ
    if (!layer.meta.visible) continue;

    ctx.save();

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
