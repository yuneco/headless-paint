import type { BristleDynamics } from "../types";

export interface BristleMaskSample {
  readonly pressure: number;
  readonly distance: number;
}

const CONTEXT_CACHE = new WeakMap<
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D
>();
const GRAIN_CACHE_LIMIT = 16;
const GRAIN_TILE_SIZE = 128;
const grainCache = new Map<string, OffscreenCanvas>();

export function createBristleMaskAtlas(
  samples: readonly BristleMaskSample[],
  brushSize: number,
  dynamics: BristleDynamics,
  pressureCoverageResponse: number,
  seed: number,
): OffscreenCanvas {
  const width = Math.max(1, samples.length);
  const bands = Math.max(
    30,
    Math.ceil(brushSize / Math.max(0.25, dynamics.transverseMaskCellPx)),
  );
  const canvas = new OffscreenCanvas(width, bands);
  const ctx = getContext(canvas, "bristle mask atlas");
  const image = ctx.createImageData(width, bands);
  const data = image.data;
  const coverageResponse = clamp(pressureCoverageResponse, 0, 1);

  for (let band = 0; band < bands; band++) {
    const crossPx = (-0.5 + (band + 0.5) / bands) * brushSize;
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      if (!sample) continue;
      const broad = valueNoise2d(
        sample.distance / Math.max(4, dynamics.dropoutLengthPx),
        crossPx / Math.max(0.5, dynamics.dropoutWidthPx),
        seed ^ 0x510e527f,
      );
      const detail = valueNoise2d(
        sample.distance / Math.max(2, dynamics.dropoutLengthPx * 0.46),
        crossPx / Math.max(0.35, dynamics.dropoutWidthPx * 0.58),
        seed ^ 0x1f83d9ab,
      );
      const pressure = clamp(sample.pressure, 0, 1);
      const effectivePressure = 0.5 + (pressure - 0.5) * coverageResponse;
      const threshold = 0.5 + (0.5 - effectivePressure) * 0.98;
      let signal = broad * 0.78 + detail * 0.22;
      if (dynamics.edgeTextureAmount > 0) {
        const micro = valueNoise2d(
          sample.distance / Math.max(2, dynamics.edgeTextureLengthPx),
          crossPx / Math.max(0.5, dynamics.dropoutWidthPx * 0.2),
          seed ^ 0x5be0cd19,
        );
        const envelope = 1 - smoothstep(Math.abs(signal - threshold) / 0.34);
        signal +=
          (micro * 2 - 1) *
          0.32 *
          clamp(dynamics.edgeTextureAmount, 0, 1) *
          envelope;
      }
      const activation = activationFromDistance(
        signal - threshold,
        dynamics.depositHardness,
      );
      const repeatFloor = clamp(dynamics.repeatStrength, 0, 1) * 0.06;
      const alpha = Math.round(
        Math.max(activation, activation <= 0.001 ? repeatFloor : 0) * 255,
      );
      const offset = (band * width + index) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function applyDocumentGrain(
  ctx: OffscreenCanvasRenderingContext2D,
  localOriginX: number,
  localOriginY: number,
  width: number,
  height: number,
  dynamics: BristleDynamics,
): void {
  if (dynamics.surfaceGrain.amount <= 0) return;
  const tile = getGrainTile(dynamics);
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern)
    throw new Error("Failed to create bristle surface grain pattern");
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.translate(-localOriginX, -localOriginY);
  ctx.fillStyle = pattern;
  ctx.fillRect(localOriginX, localOriginY, width, height);
  ctx.restore();
}

function getGrainTile(dynamics: BristleDynamics): OffscreenCanvas {
  const grain = dynamics.surfaceGrain;
  const key = [
    grain.seed,
    grain.scalePx,
    grain.amount,
    grain.hardness,
    dynamics.repeatStrength,
  ].join(":");
  const cached = grainCache.get(key);
  if (cached) return cached;

  const canvas = new OffscreenCanvas(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
  const ctx = getContext(canvas, "bristle surface grain");
  const image = ctx.createImageData(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
  const data = image.data;
  const amount = clamp(grain.amount, 0, 1);
  const transition = 0.03 + (1 - clamp(grain.hardness, 0, 1)) * 0.3;
  const valleyFloor = clamp(dynamics.repeatStrength, 0, 1) * 0.08;
  const scale = Math.max(0.5, grain.scalePx);
  for (let y = 0; y < GRAIN_TILE_SIZE; y++) {
    for (let x = 0; x < GRAIN_TILE_SIZE; x++) {
      const base = valueNoise2d(x / scale, y / scale, grain.seed);
      const fibers = valueNoise2d(
        x / (scale * 0.45),
        y / (scale * 1.9),
        grain.seed ^ 0x9e3779b9,
      );
      const contact = smoothstep(
        (base * 0.75 + fibers * 0.25 - 0.42) / transition,
      );
      const textured = valleyFloor + (1 - valleyFloor) * contact;
      const alpha = Math.round((1 - amount + amount * textured) * 255);
      const offset = (y * GRAIN_TILE_SIZE + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  grainCache.set(key, canvas);
  if (grainCache.size > GRAIN_CACHE_LIMIT) {
    const oldest = grainCache.keys().next().value;
    if (oldest !== undefined) grainCache.delete(oldest);
  }
  return canvas;
}

function activationFromDistance(distance: number, hardness: number): number {
  const transition = 0.018 + 0.282 * (1 - clamp(hardness, 0, 1)) ** 2;
  return smoothstep((distance + transition / 2) / transition);
}

function valueNoise2d(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const top =
    hashUnit2d(seed, x0, y0) * (1 - tx) + hashUnit2d(seed, x0 + 1, y0) * tx;
  const bottom =
    hashUnit2d(seed, x0, y0 + 1) * (1 - tx) +
    hashUnit2d(seed, x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function hashUnit2d(seed: number, x: number, y: number): number {
  let value = seed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 13), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

function smoothstep(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getContext(
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
