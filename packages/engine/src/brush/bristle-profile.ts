import type { BristleDynamics } from "../types";
import { mulberry32 } from "./prng";

interface BristleLane {
  readonly offset: number;
  readonly width: number;
}

const PROFILE_CACHE_LIMIT = 32;
const PROFILE_WIDTH = 2;
const profileCache = new Map<string, OffscreenCanvas>();

export function getBristleProfileAtlas(
  brushSize: number,
  dynamics: BristleDynamics,
  seed: number,
): OffscreenCanvas {
  const height = Math.max(8, Math.ceil(brushSize * 2));
  const key = [
    height,
    seed,
    dynamics.bristleCount,
    dynamics.bristleFill,
    dynamics.bristleWidthVariation,
    dynamics.bristleSpacingVariation,
  ].join(":");
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
