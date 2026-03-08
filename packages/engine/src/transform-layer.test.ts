import { mat3 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import { createLayer, getPixel, setPixel } from "./layer";
import { transformLayer } from "./transform-layer";

describe("transformLayer", () => {
  it("should be no-op with identity matrix", () => {
    const layer = createLayer(8, 8);
    setPixel(layer, 2, 3, { r: 255, g: 0, b: 0, a: 255 });

    transformLayer(layer, mat3.create());

    expect(getPixel(layer, 2, 3)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("should translate pixel by (dx, dy)", () => {
    const layer = createLayer(8, 8);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    const m = mat3.fromTranslation(mat3.create(), [3, 2]);
    transformLayer(layer, m);

    expect(getPixel(layer, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(getPixel(layer, 3, 2)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("should clip content that moves outside layer bounds", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 3, 3, { r: 255, g: 0, b: 0, a: 255 });

    // Translate pixel beyond right edge
    const m = mat3.fromTranslation(mat3.create(), [2, 0]);
    transformLayer(layer, m);

    // Original position should be empty
    expect(getPixel(layer, 3, 3)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    // Target position (5, 3) is outside bounds, so pixel is clipped
    // No visible pixel anywhere
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(getPixel(layer, x, y).a).toBe(0);
      }
    }
  });

  it("should scale layer content", () => {
    const layer = createLayer(16, 16);
    // Fill a 2x2 block for more robust scale test
    layer.ctx.fillStyle = "rgba(255, 0, 0, 1)";
    layer.ctx.fillRect(1, 1, 2, 2);

    const m = mat3.fromScaling(mat3.create(), [2, 2]);
    transformLayer(layer, m);

    // (1,1)-(2,2) block scaled by 2 → (2,2)-(5,5) area
    // Center of scaled area should definitely have red pixels
    expect(getPixel(layer, 3, 3).a).toBeGreaterThan(0);
    expect(getPixel(layer, 4, 4).a).toBeGreaterThan(0);
    // Original area should be empty (unless overlapped by scaled content)
    expect(getPixel(layer, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("should reuse provided temp canvas", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    const temp = new OffscreenCanvas(4, 4);
    const m = mat3.fromTranslation(mat3.create(), [1, 1]);
    transformLayer(layer, m, temp);

    expect(getPixel(layer, 1, 1)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("should resize temp canvas if size does not match", () => {
    const layer = createLayer(8, 8);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    const temp = new OffscreenCanvas(2, 2);
    const m = mat3.fromTranslation(mat3.create(), [3, 3]);
    transformLayer(layer, m, temp);

    expect(getPixel(layer, 3, 3)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(temp.width).toBe(8);
    expect(temp.height).toBe(8);
  });

  it("should handle multiple pixels translation", () => {
    const layer = createLayer(8, 8);
    setPixel(layer, 1, 1, { r: 255, g: 0, b: 0, a: 255 });
    setPixel(layer, 4, 4, { r: 0, g: 255, b: 0, a: 255 });

    const m = mat3.fromTranslation(mat3.create(), [2, 1]);
    transformLayer(layer, m);

    expect(getPixel(layer, 3, 2)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(getPixel(layer, 6, 5)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
  });
});
