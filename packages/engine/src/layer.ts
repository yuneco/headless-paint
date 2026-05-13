import type { Color, Layer, LayerMeta } from "./types";

const DEFAULT_META: LayerMeta = {
  name: "Layer",
  visible: true,
  opacity: 1,
  alphaLocked: false,
};

let layerIdCounter = 0;

function generateLayerId(): string {
  return `layer_${Date.now()}_${++layerIdCounter}`;
}

export function createLayer(
  width: number,
  height: number,
  meta?: Partial<LayerMeta>,
): Layer {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2d context from OffscreenCanvas");
  }

  return {
    id: generateLayerId(),
    width,
    height,
    canvas,
    ctx,
    meta: { ...DEFAULT_META, ...meta },
  };
}

export function clearLayer(layer: Layer): void {
  layer.ctx.clearRect(0, 0, layer.width, layer.height);
}

export interface CloneLayerOptions {
  readonly id?: string;
  readonly meta?: Partial<LayerMeta>;
  readonly copyPixels?: boolean;
}

export function cloneLayer(source: Layer, options?: CloneLayerOptions): Layer {
  const layer = createLayer(source.width, source.height, {
    ...source.meta,
    ...options?.meta,
  });
  if (options?.id) {
    (layer as { id: string }).id = options.id;
  }
  if (options?.copyPixels !== false) {
    copyLayerPixels(source, layer);
  }
  return layer;
}

export function copyLayerPixels(source: Layer, target: Layer): void {
  clearLayer(target);
  target.ctx.save();
  target.ctx.globalAlpha = 1;
  target.ctx.globalCompositeOperation = "source-over";
  target.ctx.drawImage(source.canvas, 0, 0);
  target.ctx.restore();
}

export function getImageData(layer: Layer): ImageData {
  return layer.ctx.getImageData(0, 0, layer.width, layer.height);
}

export function getPixel(layer: Layer, x: number, y: number): Color {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || ix >= layer.width || iy < 0 || iy >= layer.height) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const data = layer.ctx.getImageData(ix, iy, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

export function setPixel(
  layer: Layer,
  x: number,
  y: number,
  color: Color,
): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || ix >= layer.width || iy < 0 || iy >= layer.height) {
    return;
  }
  layer.ctx.fillStyle = colorToStyle(color);
  layer.ctx.fillRect(ix, iy, 1, 1);
}

export function colorToStyle(color: Color): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}
