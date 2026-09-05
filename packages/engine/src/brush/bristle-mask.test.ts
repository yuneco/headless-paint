import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRISTLE_DYNAMICS } from "../types";
import {
  createSimpleBristleMaskEvaluator,
  rasterizeBristleMask,
} from "./bristle-mask";
import { hashSeed } from "./prng";

describe("simple bristle mask evaluator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is deterministic and omits edge micro texture", () => {
    const samples = [
      { pressure: 0.2, distance: 0 },
      { pressure: 0.6, distance: 12 },
      { pressure: 0.9, distance: 25 },
    ];
    const withEdgeTexture = createSimpleBristleMaskEvaluator(
      samples,
      40,
      { ...DEFAULT_BRISTLE_DYNAMICS, edgeTextureAmount: 1 },
      0.75,
      17,
    );
    const withoutEdgeTexture = createSimpleBristleMaskEvaluator(
      samples,
      40,
      { ...DEFAULT_BRISTLE_DYNAMICS, edgeTextureAmount: 0 },
      0.75,
      17,
    );

    for (const u of [0, 0.23, 1.61, 2]) {
      for (const v of [0, 7.42, withEdgeTexture.height - 1]) {
        expect(withEdgeTexture.evaluate(u, v)).toBe(
          withoutEdgeTexture.evaluate(u, v),
        );
      }
    }
  });

  it("maps fractional sample indices and both sweep edges to GPU coordinates", () => {
    vi.stubGlobal("__headlessPaintBristleLowPressureGain", 0.9);
    const evaluator = createSimpleBristleMaskEvaluator(
      [
        { distance: 0, pressure: 0.2 },
        { distance: 8, pressure: 0.6 },
        { distance: 32, pressure: 1 },
      ],
      8,
      { ...DEFAULT_BRISTLE_DYNAMICS, dropoutLengthPx: 4, dropoutWidthPx: 2 },
      0.75,
      17,
    );
    // u=1.5 gives distance=20 (noise x=5), pressure=0.8, threshold=0.2975.
    // v=0/last gives crossPx=-4/+4 (noise y=-2/+2).
    for (const [v, noiseY] of [
      [0, -2],
      [evaluator.height - 1, 2],
    ]) {
      const broad =
        hashSeed(hashSeed(17 ^ 0x510e527f, 5), noiseY) / 0x100000000;
      expect(evaluator.evaluate(1.5, v)).toBeCloseTo(broad - 0.2975, 12);
    }
  });

  it("does not depend on sample subdivision or transverse grid resolution", () => {
    const coarse = createSimpleBristleMaskEvaluator(
      [
        { distance: 3, pressure: 0.2 },
        { distance: 83, pressure: 0.8 },
      ],
      40,
      { ...DEFAULT_BRISTLE_DYNAMICS, transverseMaskCellPx: 10 },
      0.75,
      17,
    );
    const dense = createSimpleBristleMaskEvaluator(
      [
        { distance: 3, pressure: 0.2 },
        { distance: 23, pressure: 0.35 },
        { distance: 83, pressure: 0.8 },
      ],
      40,
      { ...DEFAULT_BRISTLE_DYNAMICS, transverseMaskCellPx: 0.25 },
      0.75,
      17,
    );
    for (const progress of [0.13, 0.4, 0.73, 0.91]) {
      const denseU =
        progress < 0.25 ? progress / 0.25 : 1 + (progress - 0.25) / 0.75;
      for (const cross of [0, 0.13, 0.5, 0.87, 1]) {
        expect(
          coarse.evaluate(progress, cross * (coarse.height - 1)),
        ).toBeCloseTo(dense.evaluate(denseU, cross * (dense.height - 1)), 12);
      }
    }
  });

  it("applies the low-pressure gain flag and clamps pressure after interpolation", () => {
    const samples = [
      { distance: 0, pressure: -1 },
      { distance: 8, pressure: 1 },
    ];
    vi.stubGlobal("__headlessPaintBristleLowPressureGain", 0.4);
    const evaluator = createSimpleBristleMaskEvaluator(
      samples,
      8,
      DEFAULT_BRISTLE_DYNAMICS,
      1,
      17,
    );
    vi.stubGlobal("__headlessPaintBristleLowPressureGain", 0);
    const neutral = createSimpleBristleMaskEvaluator(
      samples,
      8,
      DEFAULT_BRISTLE_DYNAMICS,
      1,
      17,
    );
    // At u=0.5, interpolated pressure is 0, so the threshold rises by 0.2.
    expect(
      evaluator.evaluate(0.5, 7.3) - neutral.evaluate(0.5, 7.3),
    ).toBeCloseTo(-0.2, 12);
    expect(evaluator.evaluate(1, 7.3) - neutral.evaluate(1, 7.3)).toBeCloseTo(
      0.2,
      12,
    );
  });
});

describe("bristle surface grain", () => {
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
