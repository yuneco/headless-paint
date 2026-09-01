import { describe, expect, it } from "vitest";
import { DEFAULT_BRISTLE_DYNAMICS } from "../types";
import {
  createSimpleBristleMaskField,
  rasterizeBristleMask,
} from "./bristle-mask";

describe("bristle surface grain", () => {
  it("simple field is deterministic and omits edge micro texture", () => {
    const samples = [
      { pressure: 0.2, distance: 0 },
      { pressure: 0.6, distance: 12 },
      { pressure: 0.9, distance: 25 },
    ];
    const withEdgeTexture = createSimpleBristleMaskField(
      samples,
      40,
      { ...DEFAULT_BRISTLE_DYNAMICS, edgeTextureAmount: 1 },
      0.75,
      17,
    );
    const withoutEdgeTexture = createSimpleBristleMaskField(
      samples,
      40,
      { ...DEFAULT_BRISTLE_DYNAMICS, edgeTextureAmount: 0 },
      0.75,
      17,
    );

    expect(withEdgeTexture).toEqual(withoutEdgeTexture);
  });

  it("初回の未着彩cellへalpha floorを加えない", () => {
    const mask = rasterizeBristleMask(
      [
        {
          x: 10,
          y: 30,
          pressure: 0.5,
          distance: 0,
          frameX: 1,
          frameY: 0,
        },
        {
          x: 110,
          y: 30,
          pressure: 0.5,
          distance: 100,
          frameX: 1,
          frameY: 0,
        },
      ],
      40,
      DEFAULT_BRISTLE_DYNAMICS,
      1,
      1,
      0,
      0,
      120,
      60,
    );
    const data = pixels(mask);
    const alpha: number[] = [];
    for (let y = 10; y < 50; y++) {
      for (let x = 20; x < 100; x++) {
        alpha.push(data[(y * mask.width + x) * 4 + 3] ?? 0);
      }
    }

    expect(alpha).toContain(0);
    expect(alpha.some((value) => value > 0)).toBe(true);
  });

  it("uses pixel-local pressure as contact against the Fine tooth height field", () => {
    const low = straightMask(0.2, 7, 0);
    const high = straightMask(0.9, 7, 0);

    expect(alphaCoverage(high)).toBeGreaterThan(alphaCoverage(low) * 1.5);
  });

  it("is deterministic for the same document origin, seed, and pressure", () => {
    const first = straightMask(0.55, 11, 12);
    const second = straightMask(0.55, 11, 12);

    expect(pixels(second)).toEqual(pixels(first));
  });

  it("adds opaque contact opportunities when one stroke revisits a surface", () => {
    const once = straightMask(0.28, 13, 0);
    const repeated = rasterizeBristleMask(
      [
        sample(10, 30, 0, 0.28),
        sample(110, 30, 100, 0.28),
        { ...sample(110, 30, 101, 0.28), breakBefore: true },
        sample(10, 30, 201, 0.28),
      ],
      40,
      DEFAULT_BRISTLE_DYNAMICS,
      1,
      13,
      0,
      0,
      120,
      60,
    );

    expect(alphaCoverage(repeated)).toBeGreaterThan(alphaCoverage(once) * 1.03);
  });
});

function straightMask(
  pressure: number,
  seed: number,
  originX: number,
): OffscreenCanvas {
  return rasterizeBristleMask(
    [sample(10, 30, 0, pressure), sample(110, 30, 100, pressure)],
    40,
    DEFAULT_BRISTLE_DYNAMICS,
    1,
    seed,
    originX,
    7,
    120,
    60,
  );
}

function sample(x: number, y: number, distance: number, pressure: number) {
  return {
    x,
    y,
    pressure,
    distance,
    frameX: 1,
    frameY: 0,
  } as const;
}

function pixels(canvas: OffscreenCanvas): number[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

function alphaCoverage(canvas: OffscreenCanvas): number {
  const data = pixels(canvas);
  let coverage = 0;
  for (let index = 3; index < data.length; index += 4) {
    coverage += data[index] ?? 0;
  }
  return coverage;
}
