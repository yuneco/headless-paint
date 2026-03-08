import { describe, expect, it } from "vitest";
import { getContentBounds } from "./content-bounds";
import { createLayer, setPixel } from "./layer";

describe("getContentBounds", () => {
  it("should return null for an empty layer", () => {
    const layer = createLayer(8, 8);
    expect(getContentBounds(layer)).toBeNull();
  });

  it("should return bounds for a single pixel", () => {
    const layer = createLayer(8, 8);
    setPixel(layer, 3, 5, { r: 255, g: 0, b: 0, a: 255 });

    expect(getContentBounds(layer)).toEqual({
      x: 3,
      y: 5,
      width: 1,
      height: 1,
    });
  });

  it("should return bounds for pixel at top-left corner", () => {
    const layer = createLayer(8, 8);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    expect(getContentBounds(layer)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it("should return bounds for pixel at bottom-right corner", () => {
    const layer = createLayer(8, 8);
    setPixel(layer, 7, 7, { r: 255, g: 0, b: 0, a: 255 });

    expect(getContentBounds(layer)).toEqual({
      x: 7,
      y: 7,
      width: 1,
      height: 1,
    });
  });

  it("should return full bounds for fully filled layer", () => {
    const layer = createLayer(4, 4);
    layer.ctx.fillStyle = "rgba(255, 0, 0, 1)";
    layer.ctx.fillRect(0, 0, 4, 4);

    expect(getContentBounds(layer)).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    });
  });

  it("should return tight bounds for multiple pixels", () => {
    const layer = createLayer(8, 8);
    setPixel(layer, 2, 1, { r: 255, g: 0, b: 0, a: 255 });
    setPixel(layer, 5, 6, { r: 0, g: 255, b: 0, a: 255 });

    expect(getContentBounds(layer)).toEqual({
      x: 2,
      y: 1,
      width: 4, // 5 - 2 + 1
      height: 6, // 6 - 1 + 1
    });
  });

  it("should detect pixels with any non-zero RGBA component", () => {
    const layer = createLayer(4, 4);
    // Semi-transparent pixel
    setPixel(layer, 1, 1, { r: 0, g: 0, b: 0, a: 1 });

    expect(getContentBounds(layer)).toEqual({
      x: 1,
      y: 1,
      width: 1,
      height: 1,
    });
  });

  it("should handle a horizontal line of pixels", () => {
    const layer = createLayer(8, 8);
    for (let x = 2; x <= 5; x++) {
      setPixel(layer, x, 3, { r: 255, g: 0, b: 0, a: 255 });
    }

    expect(getContentBounds(layer)).toEqual({
      x: 2,
      y: 3,
      width: 4,
      height: 1,
    });
  });

  it("should handle a vertical line of pixels", () => {
    const layer = createLayer(8, 8);
    for (let y = 1; y <= 6; y++) {
      setPixel(layer, 4, y, { r: 0, g: 255, b: 0, a: 255 });
    }

    expect(getContentBounds(layer)).toEqual({
      x: 4,
      y: 1,
      width: 1,
      height: 6,
    });
  });
});
