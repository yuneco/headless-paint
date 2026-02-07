import { describe, expect, it } from "vitest";
import { createLayer, getPixel, setPixel } from "./layer";
import { wrapShiftLayer } from "./wrap-shift";

describe("wrapShiftLayer", () => {
  it("should be no-op when dx and dy are zero", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    wrapShiftLayer(layer, 0, 0);

    expect(getPixel(layer, 0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("should be no-op when shift is a multiple of layer size", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 1, 1, { r: 0, g: 255, b: 0, a: 255 });

    wrapShiftLayer(layer, 4, 8);

    expect(getPixel(layer, 1, 1)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
  });

  it("should shift pixel right by dx", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    wrapShiftLayer(layer, 2, 0);

    expect(getPixel(layer, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(getPixel(layer, 2, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("should shift pixel down by dy", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    wrapShiftLayer(layer, 0, 3);

    expect(getPixel(layer, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(getPixel(layer, 0, 3)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("should wrap pixel around horizontally", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 3, 0, { r: 255, g: 0, b: 0, a: 255 });

    wrapShiftLayer(layer, 2, 0);

    // 3 + 2 = 5, wrapped to 5 % 4 = 1
    expect(getPixel(layer, 1, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(getPixel(layer, 3, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("should wrap pixel around vertically", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 0, 3, { r: 0, g: 255, b: 0, a: 255 });

    wrapShiftLayer(layer, 0, 2);

    // 3 + 2 = 5, wrapped to 5 % 4 = 1
    expect(getPixel(layer, 0, 1)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect(getPixel(layer, 0, 3)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("should handle negative shifts", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 1, 1, { r: 255, g: 0, b: 0, a: 255 });

    wrapShiftLayer(layer, -2, -1);

    // x: 1 - 2 = -1, wrapped to (-1 % 4 + 4) % 4 = 3
    // y: 1 - 1 = 0
    expect(getPixel(layer, 3, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(getPixel(layer, 1, 1)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("should be reversible: shift(+dx) then shift(-dx) = identity", () => {
    const layer = createLayer(8, 8);
    // 複数ピクセルを設定
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });
    setPixel(layer, 3, 5, { r: 0, g: 255, b: 0, a: 255 });
    setPixel(layer, 7, 7, { r: 0, g: 0, b: 255, a: 255 });

    const temp = new OffscreenCanvas(8, 8);

    wrapShiftLayer(layer, 3, 5, temp);
    wrapShiftLayer(layer, -3, -5, temp);

    expect(getPixel(layer, 0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(getPixel(layer, 3, 5)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect(getPixel(layer, 7, 7)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });

  it("should support cumulative shifts", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    wrapShiftLayer(layer, 1, 0);
    wrapShiftLayer(layer, 1, 0);
    wrapShiftLayer(layer, 1, 0);

    // 0 + 3 = 3
    expect(getPixel(layer, 3, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("should reuse provided temp canvas", () => {
    const layer = createLayer(4, 4);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    const temp = new OffscreenCanvas(4, 4);

    wrapShiftLayer(layer, 2, 1, temp);

    expect(getPixel(layer, 2, 1)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("should resize temp canvas if size does not match", () => {
    const layer = createLayer(8, 8);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    const temp = new OffscreenCanvas(2, 2);

    wrapShiftLayer(layer, 3, 3, temp);

    expect(getPixel(layer, 3, 3)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(temp.width).toBe(8);
    expect(temp.height).toBe(8);
  });
});
