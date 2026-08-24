import type { BristleDynamics } from "../types";
import { mulberry32 } from "./prng";

interface BristleLane {
  readonly offset: number;
  readonly width: number;
}

const PROFILE_CACHE_LIMIT = 32;
const PROFILE_WIDTH = 2;
const profileCache = new Map<string, OffscreenCanvas>();
const profileRasterCache = new Map<string, BristleProfileRaster>();

export interface BristleProfileRaster {
  readonly height: number;
  readonly values: Float32Array<ArrayBuffer>;
}

export function getBristleProfileAtlas(
  brushSize: number,
  dynamics: BristleDynamics,
  seed: number,
): OffscreenCanvas {
  const height = Math.max(8, Math.ceil(brushSize * 2));
  const key = profileKey(height, dynamics, seed);
  const cached = profileCache.get(key);
  if (cached) return cached;

  const atlas = new OffscreenCanvas(PROFILE_WIDTH, height);
  const ctx = atlas.getContext("2d");
  if (!ctx) throw new Error("Bristle profile requires Canvas2D");
  ctx.fillStyle = "white";
  for (const lane of createBristleProfile(dynamics, seed)) {
    const top = (lane.offset - lane.width / 2 + 0.5) * height;
    ctx.fillRect(0, top, PROFILE_WIDTH, Math.max(1, lane.width * height));
  }

  profileCache.set(key, atlas);
  if (profileCache.size > PROFILE_CACHE_LIMIT) {
    const oldest = profileCache.keys().next().value;
    if (oldest !== undefined) profileCache.delete(oldest);
  }
  return atlas;
}

export function getBristleProfileRaster(
  brushSize: number,
  dynamics: BristleDynamics,
  seed: number,
): BristleProfileRaster {
  const height = Math.max(8, Math.ceil(brushSize * 2));
  const key = profileKey(height, dynamics, seed);
  const cached = profileRasterCache.get(key);
  if (cached) return cached;

  const values = new Float32Array(height);
  for (const lane of createBristleProfile(dynamics, seed)) {
    const top = (lane.offset - lane.width / 2 + 0.5) * height;
    const bottom = top + Math.max(1, lane.width * height);
    const firstRow = Math.max(0, Math.floor(top));
    const lastRow = Math.min(height - 1, Math.ceil(bottom) - 1);
    for (let row = firstRow; row <= lastRow; row++) {
      const coverage = clamp(
        Math.min(row + 1, bottom) - Math.max(row, top),
        0,
        1,
      );
      const existing = values[row] ?? 0;
      values[row] = existing + coverage * (1 - existing);
    }
  }

  const raster = { height, values };
  profileRasterCache.set(key, raster);
  if (profileRasterCache.size > PROFILE_CACHE_LIMIT) {
    const oldest = profileRasterCache.keys().next().value;
    if (oldest !== undefined) profileRasterCache.delete(oldest);
  }
  return raster;
}

function profileKey(
  height: number,
  dynamics: BristleDynamics,
  seed: number,
): string {
  return [
    height,
    seed,
    dynamics.bristleCount,
    dynamics.bristleFill,
    dynamics.bristleWidthVariation,
    dynamics.bristleSpacingVariation,
  ].join(":");
}

function createBristleProfile(
  dynamics: BristleDynamics,
  seed: number,
): readonly BristleLane[] {
  const random = mulberry32(seed);
  const laneCount = clampInteger(dynamics.bristleCount, 1, 128);
  const pitch = 0.94 / laneCount;
  const meanFill = clamp(dynamics.bristleFill, 0.1, 2.4);
  const sizeVariation = clamp(dynamics.bristleWidthVariation, 0, 1);
  const spacingVariation = clamp(dynamics.bristleSpacingVariation, 0, 1);
  const drafts = Array.from({ length: laneCount }, () => ({
    spacingWeight: 2 ** ((random() * 2 - 1) * 3 * spacingVariation),
    width:
      pitch *
      clamp(
        meanFill * 2 ** ((random() * 2 - 1) * 2.2 * sizeVariation),
        0.05,
        2.4,
      ),
  }));
  const totalWeight = drafts.reduce(
    (sum, draft) => sum + draft.spacingWeight,
    0,
  );
  let cursor = -0.47;
  return drafts.map((draft) => {
    const cellWidth = (0.94 * draft.spacingWeight) / totalWeight;
    const offset = cursor + cellWidth / 2;
    cursor += cellWidth;
    return { offset, width: draft.width };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
