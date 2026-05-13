import { clearLayer } from "./layer";
import type { Layer, LayerMeta } from "./types";

export interface MergeLayerDownOptions {
  readonly resultMeta?: Partial<LayerMeta>;
}

function applyLayerMeta(
  ctx: OffscreenCanvasRenderingContext2D,
  meta: LayerMeta,
): void {
  ctx.globalAlpha = meta.opacity;
  ctx.globalCompositeOperation = meta.compositeOperation ?? "source-over";
}

export function mergeLayerDown(
  targetLayer: Layer,
  sourceLayer: Layer,
  options?: MergeLayerDownOptions,
): void {
  const work = new OffscreenCanvas(targetLayer.width, targetLayer.height);
  const workCtx = work.getContext("2d");
  if (!workCtx) {
    throw new Error("Failed to get 2d context from OffscreenCanvas");
  }

  workCtx.save();
  applyLayerMeta(workCtx, targetLayer.meta);
  workCtx.drawImage(targetLayer.canvas, 0, 0);
  applyLayerMeta(workCtx, sourceLayer.meta);
  workCtx.drawImage(sourceLayer.canvas, 0, 0);
  workCtx.restore();

  clearLayer(targetLayer);
  targetLayer.ctx.save();
  targetLayer.ctx.globalAlpha = 1;
  targetLayer.ctx.globalCompositeOperation = "source-over";
  targetLayer.ctx.drawImage(work, 0, 0);
  targetLayer.ctx.restore();

  const resultMeta: LayerMeta = {
    name: targetLayer.meta.name,
    visible: targetLayer.meta.visible,
    opacity: 1,
    alphaLocked: targetLayer.meta.alphaLocked,
    compositeOperation: "source-over",
    ...options?.resultMeta,
  };
  targetLayer.meta.name = resultMeta.name;
  targetLayer.meta.visible = resultMeta.visible;
  targetLayer.meta.opacity = resultMeta.opacity;
  targetLayer.meta.alphaLocked = resultMeta.alphaLocked;
  targetLayer.meta.compositeOperation = resultMeta.compositeOperation;
}
