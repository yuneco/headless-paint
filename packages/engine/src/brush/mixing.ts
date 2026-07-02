import { colorToStyle } from "../layer";
import { DEFAULT_BRUSH_MIXING } from "../types";
import type { BrushMixing, Color, Layer } from "../types";

const CONTEXT_CACHE = new WeakMap<
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D
>();

export function getActiveMixing(
  mixing: BrushMixing | undefined,
): BrushMixing | null {
  if (!mixing?.enabled) return null;
  const pickup = clamp01(mixing.pickup);
  const restore = clamp01(mixing.restore);
  if (pickup <= 0 && restore <= 0) return null;
  const updateDistancePx =
    Number.isFinite(mixing.updateDistancePx) && mixing.updateDistancePx > 0
      ? mixing.updateDistancePx
      : DEFAULT_BRUSH_MIXING.updateDistancePx;
  return { enabled: true, pickup, restore, updateDistancePx };
}

export function getMixingUpdateSpacing(
  stampSpacing: number,
  mixing: BrushMixing,
): number {
  return Math.max(stampSpacing, mixing.updateDistancePx);
}

export function shouldUpdateMixedTip(
  colorBuffer: OffscreenCanvas | undefined,
  mixedCanvas: OffscreenCanvas | undefined,
  stampDistance: number,
  lastMixingUpdateDistance: number | undefined,
  mixingUpdateSpacing: number,
): boolean {
  if (!colorBuffer) return true;
  if (!mixedCanvas) return true;
  if (lastMixingUpdateDistance === undefined) return true;
  return stampDistance - lastMixingUpdateDistance >= mixingUpdateSpacing;
}

export function renderMixedTip(
  tipCanvas: OffscreenCanvas,
  baseColor: Color,
  x: number,
  y: number,
  stampSize: number,
  sourceLayer: Layer,
  mixing: BrushMixing,
  colorBuffer: OffscreenCanvas | undefined,
  mixedCanvas: OffscreenCanvas | undefined,
): {
  readonly canvas: OffscreenCanvas;
  readonly colorBuffer: OffscreenCanvas;
  readonly mixedCanvas: OffscreenCanvas;
} {
  const buffer =
    colorBuffer ??
    createColorBuffer(tipCanvas.width, tipCanvas.height, baseColor);
  const bufferCtx = getCached2dContext(buffer, "mixed brush color buffer");
  const workCanvas = mixedCanvas ?? createMixedWorkCanvas(tipCanvas);
  const workCtx = getCached2dContext(workCanvas, "mixed brush work canvas");

  bufferCtx.globalCompositeOperation = "source-over";
  if (mixing.pickup > 0) {
    bufferCtx.globalAlpha = mixing.pickup;
    bufferCtx.drawImage(
      sourceLayer.canvas,
      x - stampSize / 2,
      y - stampSize / 2,
      stampSize,
      stampSize,
      0,
      0,
      buffer.width,
      buffer.height,
    );
  }
  if (mixing.restore > 0) {
    bufferCtx.globalAlpha = mixing.restore;
    bufferCtx.fillStyle = colorToStyle(baseColor);
    bufferCtx.fillRect(0, 0, buffer.width, buffer.height);
  }
  bufferCtx.globalAlpha = 1;

  workCtx.globalCompositeOperation = "copy";
  workCtx.globalAlpha = 1;
  workCtx.drawImage(buffer, 0, 0);
  workCtx.globalCompositeOperation = "destination-in";
  workCtx.drawImage(tipCanvas, 0, 0);
  workCtx.globalCompositeOperation = "source-over";
  workCtx.globalAlpha = 1;

  return {
    canvas: workCanvas,
    colorBuffer: buffer,
    mixedCanvas: workCanvas,
  };
}

function createColorBuffer(
  width: number,
  height: number,
  color: Color,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = getCached2dContext(canvas, "brush color buffer");
  ctx.fillStyle = colorToStyle(color);
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

function createMixedWorkCanvas(tipCanvas: OffscreenCanvas): OffscreenCanvas {
  const canvas = new OffscreenCanvas(tipCanvas.width, tipCanvas.height);
  getCached2dContext(canvas, "mixed brush work canvas");
  return canvas;
}

function getCached2dContext(
  canvas: OffscreenCanvas,
  label: string,
): OffscreenCanvasRenderingContext2D {
  const cached = CONTEXT_CACHE.get(canvas);
  if (cached) return cached;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`Failed to get 2d context for ${label}`);
  CONTEXT_CACHE.set(canvas, ctx);
  return ctx;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
