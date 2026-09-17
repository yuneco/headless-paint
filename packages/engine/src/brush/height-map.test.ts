import { describe, expect, it } from "vitest";
import { createHeightMapFromImageData } from "./height-map";

// Deliberately use only ImageData's data/width/height: no DOM globals in Node.
function image(pixels: readonly number[][]): ImageData {
  return {
    width: pixels.length,
    height: 1,
    data: new Uint8ClampedArray(pixels.flat()),
  } as ImageData;
}

function grayscale(values: readonly number[]): ImageData {
  return image(values.map((value) => [value, value, value, 255]));
}

describe("createHeightMapFromImageData", () => {
  it("uses Rec.601 luminance and ignores alpha", () => {
    const source = image([
      [255, 0, 0, 0],
      [0, 255, 0, 127],
      [0, 0, 255, 255],
      [40, 80, 120, 0],
      [40, 80, 120, 255],
    ]);
    const before = source.data.slice();
    const map = createHeightMapFromImageData(source, { normalize: false });
    expect(map.width).toBe(5);
    expect(map.height).toBe(1);
    for (const [index, value] of [0.299, 0.587, 0.114].entries()) {
      expect(map.heights[index]).toBeCloseTo(value, 6);
    }
    expect(map.heights[3]).toBeCloseTo(
      (0.299 * 40 + 0.587 * 80 + 0.114 * 120) / 255,
      6,
    );
    expect(map.heights[4]).toBe(map.heights[3]);
    expect(source.data).toEqual(before);
  });

  it("normalizes min to 0 and max to 1 by default", () => {
    const map = createHeightMapFromImageData(grayscale([50, 100, 150]));
    expect(map.heights[0]).toBe(0);
    expect(map.heights[1]).toBeCloseTo(0.5, 6);
    expect(map.heights[2]).toBe(1);
  });

  it("inverts luminance before normalization", () => {
    const source = grayscale([50, 100, 150]);
    const raw = createHeightMapFromImageData(source, {
      invert: true,
      normalize: false,
    });
    expect(raw.heights[0]).toBeCloseTo(1 - 50 / 255, 6);
    const normalized = createHeightMapFromImageData(source, { invert: true });
    expect(normalized.heights[0]).toBe(1);
    expect(normalized.heights[1]).toBeCloseTo(0.5, 6);
    expect(normalized.heights[2]).toBe(0);
  });

  it("applies contrast=2 after normalization and clamps 0.25/0.75 to 0/1", () => {
    const map = createHeightMapFromImageData(grayscale([0, 50, 150, 200]), {
      contrast: 2,
    });
    expect(Array.from(map.heights)).toEqual([0, 0, 1, 1]);
  });

  it.each([false, true])(
    "normalizes a constant image to all zero (invert=%s)",
    (invert) => {
      const map = createHeightMapFromImageData(grayscale([90, 90, 90]), {
        invert,
      });
      expect(Array.from(map.heights)).toEqual([0, 0, 0]);
    },
  );

  it.each([0, -1, 1.5, 2049, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid image dimensions: %s",
    (dimension) => {
      const source = grayscale([0]);
      expect(() =>
        createHeightMapFromImageData({ ...source, width: dimension }),
      ).toThrow(RangeError);
      expect(() =>
        createHeightMapFromImageData({ ...source, height: dimension }),
      ).toThrow(RangeError);
    },
  );
});
