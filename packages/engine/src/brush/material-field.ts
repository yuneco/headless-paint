import type { Color } from "../types";

export interface MaterialFieldUpdate {
  readonly pickupRatePerPx: number;
  readonly restoreRatePerPx: number;
  readonly diffusionRatePerPx: number;
  readonly distancePx: number;
}

export function createMaterialField(
  columns: number,
  rows: number,
  color: Color,
): Float32Array {
  const length = sanitizeDimension(columns) * sanitizeDimension(rows) * 4;
  const field = new Float32Array(length);
  for (let offset = 0; offset < length; offset += 4) {
    field[offset] = color.r;
    field[offset + 1] = color.g;
    field[offset + 2] = color.b;
    field[offset + 3] = color.a;
  }
  return field;
}

/**
 * 連続したtip-local色面を距離正規化して更新する。
 * 入力fieldは変更せず、新しいfieldを返す。
 */
export function advanceMaterialField(
  field: Float32Array,
  sampled: Uint8ClampedArray,
  columns: number,
  rows: number,
  baseColor: Color,
  update: MaterialFieldUpdate,
): Float32Array {
  const width = sanitizeDimension(columns);
  const height = sanitizeDimension(rows);
  const expectedLength = width * height * 4;
  if (field.length !== expectedLength || sampled.length !== expectedLength) {
    throw new Error("Material field dimensions do not match its buffers");
  }

  const distance = sanitizeNonNegative(update.distancePx);
  const pickup = distanceCoefficient(update.pickupRatePerPx, distance);
  const restore = distanceCoefficient(update.restoreRatePerPx, distance);
  const combined = new Float32Array(expectedLength);

  for (let offset = 0; offset < expectedLength; offset += 4) {
    const sampleAlpha = sampled[offset + 3] / 255;
    const pickupAmount = pickup * sampleAlpha;
    combined[offset] = restoreChannel(
      mixChannel(field[offset], sampled[offset], pickupAmount),
      baseColor.r,
      restore,
    );
    combined[offset + 1] = restoreChannel(
      mixChannel(field[offset + 1], sampled[offset + 1], pickupAmount),
      baseColor.g,
      restore,
    );
    combined[offset + 2] = restoreChannel(
      mixChannel(field[offset + 2], sampled[offset + 2], pickupAmount),
      baseColor.b,
      restore,
    );
    combined[offset + 3] = restoreChannel(
      field[offset + 3],
      baseColor.a,
      restore,
    );
  }

  let source = combined;
  let passAmount = sanitizeRate(update.diffusionRatePerPx) * distance;
  while (passAmount > 1e-6) {
    const strength = Math.min(1, passAmount);
    const target = new Float32Array(expectedLength);
    diffuseMaterialField(source, target, width, height, strength);
    source = target;
    passAmount -= strength;
  }
  return source;
}

export function writeMaterialFieldPixels(
  field: Float32Array,
  pixels: Uint8ClampedArray,
): void {
  if (field.length !== pixels.length) {
    throw new Error("Material field and pixel buffer lengths do not match");
  }
  for (let i = 0; i < field.length; i++) {
    pixels[i] = Math.round(clamp255(field[i]));
  }
}

function diffuseMaterialField(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  strength: number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        let sum = source[offset + channel];
        let count = 1;
        if (x > 0) {
          sum += source[offset - 4 + channel];
          count++;
        }
        if (x + 1 < width) {
          sum += source[offset + 4 + channel];
          count++;
        }
        if (y > 0) {
          sum += source[offset - width * 4 + channel];
          count++;
        }
        if (y + 1 < height) {
          sum += source[offset + width * 4 + channel];
          count++;
        }
        const average = sum / count;
        target[offset + channel] =
          source[offset + channel] +
          (average - source[offset + channel]) * strength;
      }
    }
  }
}

function distanceCoefficient(ratePerPx: number, distancePx: number): number {
  return 1 - Math.exp(-sanitizeRate(ratePerPx) * distancePx);
}

function mixChannel(current: number, sample: number, amount: number): number {
  return current + (sample - current) * amount;
}

function restoreChannel(current: number, base: number, amount: number): number {
  return current + (base - current) * amount;
}

function sanitizeDimension(value: number): number {
  return Math.max(1, Math.round(Number.isFinite(value) ? value : 1));
}

function sanitizeNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sanitizeRate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, value));
}
