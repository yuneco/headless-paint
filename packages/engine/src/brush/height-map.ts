import type { BristleHeightMap } from "../types";

export interface HeightMapFromImageOptions {
  readonly invert?: boolean;
  readonly normalize?: boolean;
  readonly contrast?: number;
}

/** Convert Rec.601 luminance to paper heights without using runtime DOM APIs. */
export function createHeightMapFromImageData(
  image: ImageData,
  options?: HeightMapFromImageOptions,
): BristleHeightMap {
  const { width, height, data } = image;
  validateHeightMapDimensions(width, height);
  const invert = options?.invert ?? false;
  const normalize = options?.normalize ?? true;
  const contrast = options?.contrast ?? 1;
  const heights = new Float32Array(width * height);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < heights.length; index++) {
    const offset = index * 4;
    const luminance =
      (0.299 * data[offset] +
        0.587 * data[offset + 1] +
        0.114 * data[offset + 2]) /
      255;
    const value = Math.fround(invert ? 1 - luminance : luminance);
    heights[index] = value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const range = maximum - minimum;
  for (let index = 0; index < heights.length; index++) {
    let value = heights[index];
    if (normalize) value = range > 0 ? (value - minimum) / range : 0;
    heights[index] = Math.max(0, Math.min(1, 0.5 + (value - 0.5) * contrast));
  }
  return { width, height, heights };
}

/** Internal validation shared by asset registration and drawing. */
export function validateHeightMap(map: BristleHeightMap): void {
  validateHeightMapDimensions(map.width, map.height);
  if (map.heights.length !== map.width * map.height) {
    throw new RangeError(
      "Bristle height map heights length must equal width * height",
    );
  }
}

/** Internal validation shared by image conversion, registration and drawing. */
export function validateHeightMapDimensions(
  width: number,
  height: number,
): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 2048 ||
    height > 2048
  ) {
    throw new RangeError(
      "Bristle height map dimensions must be integers in 1..2048",
    );
  }
}
