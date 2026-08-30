import type { BristleDynamics } from "../types";
import {
  brushPerfDebug,
  perfElapsed,
  perfSample,
  perfStage,
} from "./perf-debug";
import { hashSeed } from "./prng";

export interface BristleMaskSample {
  readonly pressure: number;
  readonly distance: number;
}

export interface BristleMaskSweepSample extends BristleMaskSample {
  readonly x: number;
  readonly y: number;
  readonly frameX: number;
  readonly frameY: number;
  readonly breakBefore?: boolean;
}

export interface BristleMaskField {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array<ArrayBuffer>;
}

interface RasterVertex {
  readonly x: number;
  readonly y: number;
  readonly u: number;
  readonly v: number;
}

const CONTEXT_CACHE = new WeakMap<
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D
>();
const GRAIN_HEIGHT_CACHE_LIMIT = 8;
const GRAIN_TILE_SIZE = 128;
const REPEAT_CONTACT_STRENGTH = 0.75;
const REPEAT_CONTACT_REACH = 0.18;
const REPEAT_CONTACT_EXPOSURE_PER_PASS = 0.24;
const FIXED_CONTACT_HASH_SALT = 0x243f6a88;
const REPEAT_CONTACT_HASH_SALT = 0x85a308d3;
const grainHeightCache = new Map<string, Float32Array<ArrayBuffer>>();
const nullRasterCache = new Map<string, ImageData>();

interface SurfaceContactRaster {
  readonly amount: number;
  readonly softness: number;
  readonly grainSeed: number;
  readonly strokeSeed: number;
  readonly heights: Float32Array<ArrayBuffer>;
  readonly originX: number;
  readonly originY: number;
}

/**
 * LabのCOMB実験と同じ順序で、stroke-spaceの符号付きpaint fieldを
 * swept quadへ補間してから最終pixelのalphaへ変換する。
 *
 * atlasを先にalpha化してCanvasで重ねると、区間境界のsource-overにより
 * 低筆圧の未着彩部へ薄いalphaが蓄積するため、このmaskはsoftware rasterで
 * 1枚に確定する。Fine toothとのpixel-local contactも同じ走査内で0/1判定し、
 * 重複区間はcanonical trialごとの再接触を評価してmax(alpha)で結合する。
 */
export function rasterizeBristleMask(
  samples: readonly BristleMaskSweepSample[],
  brushSize: number,
  dynamics: BristleDynamics,
  pressureCoverageResponse: number,
  seed: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
): OffscreenCanvas {
  const canvas = perfStage(
    "canvasAlloc",
    () => new OffscreenCanvas(width, height),
  );
  const ctx = getContext(canvas, "bristle swept mask");
  if (samples.length < 2) return canvas;

  const field = createBristleMaskField(
    samples,
    brushSize,
    dynamics,
    pressureCoverageResponse,
    seed,
  );
  const uploadCreateStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
  const target = brushPerfDebug.nullStages.nullRaster
    ? getNullRasterImageData(ctx, width, height)
    : ctx.createImageData(width, height);
  let uploadElapsed = brushPerfDebug.enabled
    ? performance.now() - uploadCreateStartedAt
    : 0;
  const halfWidth = brushSize / 2;
  const maxV = field.height - 1;
  perfStage("maskRaster", () => {
    const surface = createSurfaceContactRaster(
      dynamics,
      seed,
      originX,
      originY,
    );
    if (brushPerfDebug.nullStages.nullRaster) return;
    for (let index = 1; index < samples.length; index++) {
      const from = samples[index - 1];
      const to = samples[index];
      if (!from || !to || to.breakBefore) continue;
      if (Math.hypot(to.x - from.x, to.y - from.y) < 0.001) continue;
      const trialId = Math.round(
        ((from.distance + to.distance) * 0.5) /
          Math.max(0.5, dynamics.geometryStepPx),
      );

      const fromLeft: RasterVertex = {
        x: from.x + from.frameY * halfWidth - originX,
        y: from.y - from.frameX * halfWidth - originY,
        u: index - 1,
        v: 0,
      };
      const fromRight: RasterVertex = {
        x: from.x - from.frameY * halfWidth - originX,
        y: from.y + from.frameX * halfWidth - originY,
        u: index - 1,
        v: maxV,
      };
      const toLeft: RasterVertex = {
        x: to.x + to.frameY * halfWidth - originX,
        y: to.y - to.frameX * halfWidth - originY,
        u: index,
        v: 0,
      };
      const toRight: RasterVertex = {
        x: to.x - to.frameY * halfWidth - originX,
        y: to.y + to.frameX * halfWidth - originY,
        u: index,
        v: maxV,
      };
      rasterizeTriangle(
        field,
        target,
        fromLeft,
        fromRight,
        toRight,
        dynamics.depositHardness,
        samples,
        surface,
        trialId,
      );
      rasterizeTriangle(
        field,
        target,
        fromLeft,
        toRight,
        toLeft,
        dynamics.depositHardness,
        samples,
        surface,
        trialId,
      );
    }
  });
  const uploadPutStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
  ctx.putImageData(target, 0, 0);
  if (brushPerfDebug.enabled) {
    uploadElapsed += performance.now() - uploadPutStartedAt;
    perfElapsed("maskUpload", uploadElapsed);
  }
  return canvas;
}

export function createBristleMaskField(
  samples: readonly BristleMaskSample[],
  brushSize: number,
  dynamics: BristleDynamics,
  pressureCoverageResponse: number,
  seed: number,
): BristleMaskField {
  return perfStage("maskField", () =>
    createBristleMaskFieldUnmeasured(
      samples,
      brushSize,
      dynamics,
      pressureCoverageResponse,
      seed,
    ),
  );
}

function createBristleMaskFieldUnmeasured(
  samples: readonly BristleMaskSample[],
  brushSize: number,
  dynamics: BristleDynamics,
  pressureCoverageResponse: number,
  seed: number,
): BristleMaskField {
  const width = Math.max(1, samples.length);
  const bands = Math.max(
    30,
    Math.ceil(brushSize / Math.max(0.25, dynamics.transverseMaskCellPx)),
  );
  const values = new Float32Array(width * bands);
  const coverageResponse = clamp(pressureCoverageResponse, 0, 1);

  if (brushPerfDebug.nullStages.nullField) {
    values.fill(1);
    perfSample("fieldCells", values.length);
    return { width, height: bands, values };
  }

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
          crossPx / Math.max(2, dynamics.dropoutWidthPx * 0.2),
          seed ^ 0x5be0cd19,
        );
        const envelope = 1 - smoothstep(Math.abs(signal - threshold) / 0.34);
        signal +=
          (micro * 2 - 1) *
          0.32 *
          clamp(dynamics.edgeTextureAmount, 0, 1) *
          envelope;
      }
      values[band * width + index] = signal - threshold;
    }
  }
  perfSample("fieldCells", values.length);
  return { width, height: bands, values };
}

function sampleFieldDistance(
  field: BristleMaskField,
  u: number,
  v: number,
): number {
  const clampedU = clamp(u, 0, field.width - 1);
  const clampedV = clamp(v, 0, field.height - 1);
  const u0 = Math.floor(clampedU);
  const v0 = Math.floor(clampedV);
  const u1 = Math.min(field.width - 1, u0 + 1);
  const v1 = Math.min(field.height - 1, v0 + 1);
  const fu = clampedU - u0;
  const fv = clampedV - v0;
  const top =
    (field.values[v0 * field.width + u0] ?? -1) * (1 - fu) +
    (field.values[v0 * field.width + u1] ?? -1) * fu;
  const bottom =
    (field.values[v1 * field.width + u0] ?? -1) * (1 - fu) +
    (field.values[v1 * field.width + u1] ?? -1) * fu;
  return top * (1 - fv) + bottom * fv;
}

function rasterizeTriangle(
  field: BristleMaskField,
  target: ImageData,
  a: RasterVertex,
  b: RasterVertex,
  c: RasterVertex,
  hardness: number,
  samples: readonly BristleMaskSample[],
  surface: SurfaceContactRaster | undefined,
  trialId: number,
): void {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 0.00001) return;
  const inverseDenominator = 1 / denominator;
  const weightADx = (b.y - c.y) * inverseDenominator;
  const weightADy = (c.x - b.x) * inverseDenominator;
  const weightBDx = (c.y - a.y) * inverseDenominator;
  const weightBDy = (a.x - c.x) * inverseDenominator;
  const uDx = weightADx * (a.u - c.u) + weightBDx * (b.u - c.u);
  const vDx = weightADx * (a.v - c.v) + weightBDx * (b.v - c.v);
  const vertices = [a, b, c, a] as const;
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(target.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  for (let y = minY; y <= maxY; y++) {
    const sampleY = y + 0.5;
    let fromX = Number.POSITIVE_INFINITY;
    let toX = Number.NEGATIVE_INFINITY;
    let intersectionCount = 0;
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
      const from = vertices[edgeIndex];
      const to = vertices[edgeIndex + 1];
      if (!from || !to) continue;
      const edgeMinY = Math.min(from.y, to.y);
      const edgeMaxY = Math.max(from.y, to.y);
      if (sampleY < edgeMinY || sampleY >= edgeMaxY) continue;
      const progress = (sampleY - from.y) / (to.y - from.y);
      const intersection = from.x + (to.x - from.x) * progress;
      fromX = Math.min(fromX, intersection);
      toX = Math.max(toX, intersection);
      intersectionCount++;
    }
    if (intersectionCount < 2) continue;
    const minX = Math.max(0, Math.ceil(fromX - 0.5));
    const maxX = Math.min(target.width - 1, Math.floor(toX - 0.5));
    const firstSampleX = minX + 0.5;
    const weightA =
      weightADx * (firstSampleX - c.x) + weightADy * (sampleY - c.y);
    const weightB =
      weightBDx * (firstSampleX - c.x) + weightBDy * (sampleY - c.y);
    let u = c.u + weightA * (a.u - c.u) + weightB * (b.u - c.u);
    let v = c.v + weightA * (a.v - c.v) + weightB * (b.v - c.v);
    for (let x = minX; x <= maxX; x++) {
      let alpha = Math.round(
        activationFromDistance(sampleFieldDistance(field, u, v), hardness) *
          255,
      );
      const offset = (y * target.width + x) * 4;
      if (
        alpha > (target.data[offset + 3] ?? 0) &&
        surface &&
        !hasSurfaceContact(surface, x, y, samplePressure(samples, u), trialId)
      ) {
        alpha = 0;
      }
      if (alpha > (target.data[offset + 3] ?? 0)) {
        target.data[offset] = 255;
        target.data[offset + 1] = 255;
        target.data[offset + 2] = 255;
        target.data[offset + 3] = alpha;
      }
      u += uDx;
      v += vDx;
    }
  }
}

function createSurfaceContactRaster(
  dynamics: BristleDynamics,
  strokeSeed: number,
  originX: number,
  originY: number,
): SurfaceContactRaster | undefined {
  const grain = dynamics.surfaceGrain;
  const amount = clamp(grain.amount, 0, 1);
  if (amount <= 0) return undefined;
  return {
    amount,
    softness: 0.01 + (1 - clamp(grain.hardness, 0, 1)) * 0.24,
    grainSeed: grain.seed,
    strokeSeed,
    heights: getFineToothHeightTile(grain.seed, grain.scalePx),
    originX,
    originY,
  };
}

function hasSurfaceContact(
  surface: SurfaceContactRaster,
  localX: number,
  localY: number,
  pressure: number,
  trialId: number,
): boolean {
  if (brushPerfDebug.nullStages.nullContact) return true;
  const documentX = surface.originX + localX;
  const documentY = surface.originY + localY;
  const tileX = positiveModulo(documentX, GRAIN_TILE_SIZE);
  const tileY = positiveModulo(documentY, GRAIN_TILE_SIZE);
  const height = surface.heights[tileY * GRAIN_TILE_SIZE + tileX] ?? 0;
  const contact = clamp(pressure, 0, 1);
  const directCoverage = smoothstep(
    (contact - height + surface.softness) / (surface.softness * 2),
  );
  const directProbability =
    1 - surface.amount + surface.amount * directCoverage;
  if (
    documentHashUnit(
      surface.grainSeed ^ FIXED_CONTACT_HASH_SALT,
      documentX,
      documentY,
    ) < directProbability
  ) {
    return true;
  }

  const gap = Math.max(0, height - contact);
  const rate =
    surface.amount *
    REPEAT_CONTACT_STRENGTH *
    Math.exp(-gap / REPEAT_CONTACT_REACH);
  const probability = 1 - Math.exp(-rate * REPEAT_CONTACT_EXPOSURE_PER_PASS);
  return (
    documentHashUnit(
      hashSeed(surface.strokeSeed ^ REPEAT_CONTACT_HASH_SALT, trialId),
      documentX,
      documentY,
    ) < probability
  );
}

function getNullRasterImageData(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): ImageData {
  const key = `${width}x${height}`;
  const cached = nullRasterCache.get(key);
  if (cached) return cached;
  const image = ctx.createImageData(width, height);
  nullRasterCache.set(key, image);
  return image;
}

function samplePressure(
  samples: readonly BristleMaskSample[],
  u: number,
): number {
  const clampedU = clamp(u, 0, samples.length - 1);
  const fromIndex = Math.floor(clampedU);
  const toIndex = Math.min(samples.length - 1, fromIndex + 1);
  const progress = clampedU - fromIndex;
  const from = samples[fromIndex]?.pressure ?? 0;
  const to = samples[toIndex]?.pressure ?? from;
  return from + (to - from) * progress;
}

function documentHashUnit(seed: number, x: number, y: number): number {
  return hashSeed(hashSeed(seed, x), y) / 0x100000000;
}

function positiveModulo(value: number, modulus: number): number {
  const remainder = value % modulus;
  return remainder < 0 ? remainder + modulus : remainder;
}

export function getFineToothHeightTile(
  seed: number,
  scalePx: number,
): Float32Array<ArrayBuffer> {
  const scale = Math.max(0.5, scalePx);
  const key = `${seed}:${scale}`;
  const cached = grainHeightCache.get(key);
  if (cached) return cached;

  const heights = new Float32Array(GRAIN_TILE_SIZE * GRAIN_TILE_SIZE);
  for (let y = 0; y < GRAIN_TILE_SIZE; y++) {
    for (let x = 0; x < GRAIN_TILE_SIZE; x++) {
      const sx = x / scale;
      const sy = y / scale;
      heights[y * GRAIN_TILE_SIZE + x] = clamp(
        fineToothNoise2d(sx, sy, seed) * 0.68 +
          fineToothNoise2d(sx * 2.3, sy * 2.3, seed + 17) * 0.32,
        0,
        1,
      );
    }
  }
  grainHeightCache.set(key, heights);
  if (grainHeightCache.size > GRAIN_HEIGHT_CACHE_LIMIT) {
    const oldest = grainHeightCache.keys().next().value;
    if (oldest !== undefined) grainHeightCache.delete(oldest);
  }
  return heights;
}

function fineToothNoise2d(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const top =
    fineToothHash(seed, x0, y0) * (1 - tx) +
    fineToothHash(seed, x0 + 1, y0) * tx;
  const bottom =
    fineToothHash(seed, x0, y0 + 1) * (1 - tx) +
    fineToothHash(seed, x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function fineToothHash(seed: number, x: number, y: number): number {
  return hashSeed(hashSeed(seed, x), y) / 0x100000000;
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
  return hashSeed(hashSeed(seed, x), y) / 0x100000000;
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
