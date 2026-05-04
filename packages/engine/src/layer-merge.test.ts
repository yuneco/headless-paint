import { describe, expect, it } from "vitest";
import { createLayer, getPixel, setPixel } from "./layer";
import { mergeLayerDown } from "./layer-merge";

describe("mergeLayerDown", () => {
  it("should burn source into target and normalize target meta", () => {
    const target = createLayer(4, 4, {
      name: "Target",
      visible: false,
      opacity: 1,
      compositeOperation: "source-over",
    });
    const source = createLayer(4, 4, {
      name: "Source",
      visible: true,
      opacity: 1,
      compositeOperation: "source-over",
    });
    setPixel(target, 1, 1, { r: 255, g: 0, b: 0, a: 255 });
    setPixel(source, 2, 2, { r: 0, g: 0, b: 255, a: 255 });

    mergeLayerDown(target, source);

    expect(getPixel(target, 1, 1)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(getPixel(target, 2, 2)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    expect(target.meta).toEqual({
      name: "Target",
      visible: false,
      opacity: 1,
      compositeOperation: "source-over",
    });
  });

  it("should apply opacity while burning hidden source pixels", () => {
    const target = createLayer(4, 4);
    const source = createLayer(4, 4, { visible: false, opacity: 0.5 });
    setPixel(source, 1, 1, { r: 255, g: 0, b: 0, a: 255 });

    mergeLayerDown(target, source);

    const pixel = getPixel(target, 1, 1);
    expect(pixel.r).toBe(255);
    expect(pixel.a).toBeGreaterThanOrEqual(127);
    expect(pixel.a).toBeLessThanOrEqual(128);
  });
});
