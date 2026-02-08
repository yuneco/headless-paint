import type { Color, Layer, LayerMeta } from "./types";

const DEFAULT_META: LayerMeta = {
  name: "Layer",
  visible: true,
  opacity: 1,
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
