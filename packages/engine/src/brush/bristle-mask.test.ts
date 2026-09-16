import { describe, expect, it } from "vitest";
import { DEFAULT_BRISTLE_DYNAMICS } from "../types";
import {
  createSimpleBristleMaskEvaluator,
  createSurfaceContactRaster,
  getFineToothHeightTile,
  hasSurfaceContact,
  rasterizeBristleMask,
  resolveBristleToothMap,
} from "./bristle-mask";
import { hashSeed } from "./prng";

describe("simple bristle mask evaluator", () => {
  it("is deterministic for the same samples and seed", () => {
    const samples = [
      { pressure: 0.2, distance: 0 },
      { pressure: 0.6, distance: 12 },
      { pressure: 0.9, distance: 25 },
    ];
    const first = createSimpleBristleMaskEvaluator(
      samples,
      40,
      DEFAULT_BRISTLE_DYNAMICS,
      0.75,
      17,
    );
    const second = createSimpleBristleMaskEvaluator(
      samples,
      40,
      DEFAULT_BRISTLE_DYNAMICS,
      0.75,
      17,
    );

    for (const u of [0, 0.23, 1.61, 2]) {
      for (const v of [0, 7.42, first.height - 1]) {
        expect(first.evaluate(u, v)).toBe(second.evaluate(u, v));
      }
    }
  });

  it("maps fractional sample indices and both sweep edges to GPU coordinates", () => {
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
    // u=1.5 gives distance=20 (noise x=5), pressure=0.8, threshold=0.15.
    // v=0/last gives crossPx=-4/+4 (noise y=-2/+2).
    for (const [v, noiseY] of [
      [0, -2],
      [evaluator.height - 1, 2],
    ]) {
      const broad =
        hashSeed(hashSeed(17 ^ 0x510e527f, 5), noiseY) / 0x100000000;
      expect(evaluator.evaluate(1.5, v)).toBeCloseTo(broad - 0.15, 12);
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

  it("clamps pressure after interpolation", () => {
    const evaluator = createSimpleBristleMaskEvaluator(
      [
        { distance: 0, pressure: -1 },
        { distance: 8, pressure: 1 },
      ],
      8,
      { ...DEFAULT_BRISTLE_DYNAMICS, dropoutLengthPx: 4, dropoutWidthPx: 2 },
      1,
      17,
    );
    const broad = hashSeed(hashSeed(17 ^ 0x510e527f, 1), -2) / 0x100000000;
    expect(evaluator.evaluate(0.5, 0)).toBeCloseTo(broad - 1, 12);
    expect(evaluator.evaluate(1, 0)).toBe(1);
  });

  it.each([0, 0.5, 1])(
    "dropout=0 is fully active for every pixel at pressure=%s",
    (pressure) => {
      const evaluator = createSimpleBristleMaskEvaluator(
        [
          { distance: 0, pressure },
          { distance: 512, pressure },
        ],
        80,
        DEFAULT_BRISTLE_DYNAMICS,
        0,
        17,
      );
      for (let x = 0; x < 512; x++) {
        for (let y = 0; y < 80; y++) {
          // Distance 1 maps to alpha 1 for every depositHardness, including 0.
          expect(
            evaluator.evaluate(x / 512, (y / 80) * (evaluator.height - 1)),
          ).toBe(1);
        }
      }
    },
  );

  it("dropout=1 loses strictly less paint as pressure rises, with none lost at 1", () => {
    const dropoutRates = [0, 0.5, 1].map((pressure) => {
      const evaluator = createSimpleBristleMaskEvaluator(
        [
          { distance: 0, pressure },
          { distance: 512, pressure },
        ],
        80,
        DEFAULT_BRISTLE_DYNAMICS,
        1,
        17,
      );
      let missing = 0;
      for (let x = 0; x < 512; x++) {
        for (let y = 0; y < 80; y++) {
          if (
            evaluator.evaluate(x / 512, (y / 80) * (evaluator.height - 1)) <= 0
          )
            missing++;
        }
      }
      return missing / (512 * 80);
    });
    expect(dropoutRates[0]).toBeGreaterThan(dropoutRates[1]);
    expect(dropoutRates[1]).toBeGreaterThan(dropoutRates[2]);
    expect(dropoutRates[2]).toBe(0);
  });

  it("dropout=1 at pressure=0.5 preserves the old coverage=1 threshold of 0.5", () => {
    const evaluator = createSimpleBristleMaskEvaluator(
      [{ distance: 20, pressure: 0.5 }],
      8,
      { ...DEFAULT_BRISTLE_DYNAMICS, dropoutLengthPx: 4, dropoutWidthPx: 2 },
      1,
      17,
    );
    const broad = hashSeed(hashSeed(17 ^ 0x510e527f, 5), -2) / 0x100000000;
    expect(evaluator.evaluate(0, 0)).toBeCloseTo(broad - 0.5, 12);
  });
});

describe("bristle height map sampling", () => {
  const grain = DEFAULT_BRISTLE_DYNAMICS.surfaceGrain;
  const heightMap = {
    width: 3,
    height: 2,
    heights: new Float32Array([0, 0.25, 1, 0.75, 0.5, 0.125]),
  };

  it.each([1, 2])(
    "tiles document coordinates, including negatives, with scale=%s",
    (scalePx) => {
      const resolved = resolveBristleToothMap({ ...grain, scalePx }, heightMap);
      expect(resolved.map).toBe(heightMap);
      expect(resolved.scalePx).toBe(scalePx);
      for (const [texelX, texelY, expectedHeight] of [
        [0, 0, 0],
        [1, 0, 0.25],
        [2, 0, 1],
        [0, 1, 0.75],
        [1, 1, 0.5],
        [2, 1, 0.125],
      ]) {
        for (const repeat of [-3, -1, 0, 2]) {
          for (let offset = 0; offset < scalePx; offset++) {
            const documentX = (texelX + repeat * 3) * scalePx + offset;
            const documentY = (texelY + repeat * 2) * scalePx + offset;
            for (const pressure of [0.1, 0.4, 0.8]) {
              const surface = createSurfaceContactRaster(
                {
                  ...DEFAULT_BRISTLE_DYNAMICS,
                  surfaceGrain: { ...grain, amount: 1, scalePx },
                },
                17,
                -23,
                -19,
                heightMap,
              );
              if (!surface) throw new Error("Expected contact raster");
              // A 1x1 map isolates the expected texel while retaining document hashes.
              const expected = {
                ...surface,
                map: {
                  width: 1,
                  height: 1,
                  heights: new Float32Array([expectedHeight]),
                },
              };
              expect(
                hasSurfaceContact(
                  surface,
                  documentX + 23,
                  documentY + 19,
                  pressure,
                  3,
                ),
              ).toBe(
                hasSurfaceContact(
                  expected,
                  documentX + 23,
                  documentY + 19,
                  pressure,
                  3,
                ),
              );
            }
          }
        }
      }
    },
  );

  it.each([0.5, 1, 2, 4, 7.5])(
    "preserves the exact legacy procedural heights at scale=%s",
    (scalePx) => {
      const resolved = resolveBristleToothMap({ ...grain, scalePx }, null);
      const legacy = getFineToothHeightTile(grain.seed, scalePx);
      expect(resolved.map.heights).toBe(legacy);
      expect(resolved.scalePx).toBe(1);
      expect(resolved.map.width).toBe(128);
      expect(resolved.map.height).toBe(128);
      expect(resolveBristleToothMap({ ...grain, scalePx }, null).map).toBe(
        resolved.map,
      );
      for (let y = -129; y <= 129; y++) {
        for (let x = -129; x <= 129; x++) {
          const oldX = ((x % 128) + 128) % 128;
          const oldY = ((y % 128) + 128) % 128;
          const newX =
            ((Math.floor(x / resolved.scalePx) % resolved.map.width) +
              resolved.map.width) %
            resolved.map.width;
          const newY =
            ((Math.floor(y / resolved.scalePx) % resolved.map.height) +
              resolved.map.height) %
            resolved.map.height;
          if (
            resolved.map.heights[newY * resolved.map.width + newX] !==
            legacy[oldY * 128 + oldX]
          ) {
            throw new Error(`Procedural height changed at ${x},${y}`);
          }
        }
      }
    },
  );

  it.each([0, -1, 1.5, 2049, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid map dimensions: %s",
    (dimension) => {
      for (const map of [
        { ...heightMap, width: dimension },
        { ...heightMap, height: dimension },
      ]) {
        expect(() => resolveBristleToothMap(grain, map)).toThrow(RangeError);
        expect(() =>
          createSurfaceContactRaster(
            {
              ...DEFAULT_BRISTLE_DYNAMICS,
              surfaceGrain: { ...grain, amount: 0 },
            },
            1,
            0,
            0,
            map,
          ),
        ).toThrow(RangeError);
      }
    },
  );

  it.each([5, 7])("rejects mismatched heights length: %s", (length) => {
    expect(() =>
      resolveBristleToothMap(grain, {
        ...heightMap,
        heights: new Float32Array(length),
      }),
    ).toThrow(RangeError);
  });

  it.each([1, 2048])("accepts boundary dimensions: %s", (width) => {
    const map = {
      width,
      height: width,
      heights: new Float32Array(width * width),
    };
    expect(resolveBristleToothMap(grain, map).map).toBe(map);
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
