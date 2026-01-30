import { describe, expect, it } from "vitest";
import { drawCircle, drawLine, drawPath } from "./draw";
import { createLayer, getImageData, getPixel } from "./layer";
import type { Color, Layer } from "./types";

const RED: Color = { r: 255, g: 0, b: 0, a: 255 };

function hasAnyPixels(layer: Layer): boolean {
  const data = getImageData(layer).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}

function countNonTransparentPixels(layer: Layer): number {
  const data = getImageData(layer).data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) count++;
  }
  return count;
}

describe("drawLine", () => {
  it("should draw something on the layer", () => {
    const layer = createLayer(100, 100);
    drawLine(layer, { x: 10, y: 10 }, { x: 90, y: 90 }, RED);
    expect(hasAnyPixels(layer)).toBe(true);
  });

  it("should draw a horizontal line", () => {
    const layer = createLayer(100, 100);
    drawLine(layer, { x: 10, y: 50 }, { x: 90, y: 50 }, RED);
    expect(hasAnyPixels(layer)).toBe(true);
  });

  it("should draw a vertical line", () => {
    const layer = createLayer(100, 100);
    drawLine(layer, { x: 50, y: 10 }, { x: 50, y: 90 }, RED);
    expect(hasAnyPixels(layer)).toBe(true);
  });

  it("should respect lineWidth parameter", () => {
    const layer1 = createLayer(100, 100);
    drawLine(layer1, { x: 10, y: 50 }, { x: 90, y: 50 }, RED, 1);
    const count1 = countNonTransparentPixels(layer1);

    const layer2 = createLayer(100, 100);
    drawLine(layer2, { x: 10, y: 50 }, { x: 90, y: 50 }, RED, 5);
    const count2 = countNonTransparentPixels(layer2);

    expect(count2).toBeGreaterThan(count1);
  });
});

describe("drawCircle", () => {
  it("should draw a filled circle", () => {
    const layer = createLayer(100, 100);
    drawCircle(layer, { x: 50, y: 50 }, 20, RED);
    expect(hasAnyPixels(layer)).toBe(true);
  });

  it("should draw at center", () => {
    const layer = createLayer(100, 100);
    drawCircle(layer, { x: 50, y: 50 }, 10, RED);
    const pixel = getPixel(layer, 50, 50);
    expect(pixel.a).toBeGreaterThan(0);
  });

  it("larger radius should fill more pixels", () => {
    const layer1 = createLayer(100, 100);
    drawCircle(layer1, { x: 50, y: 50 }, 5, RED);
    const count1 = countNonTransparentPixels(layer1);

    const layer2 = createLayer(100, 100);
    drawCircle(layer2, { x: 50, y: 50 }, 20, RED);
    const count2 = countNonTransparentPixels(layer2);

    expect(count2).toBeGreaterThan(count1);
  });
});

describe("drawPath", () => {
  it("should draw nothing for empty points", () => {
    const layer = createLayer(100, 100);
    drawPath(layer, [], RED);
    expect(hasAnyPixels(layer)).toBe(false);
  });

  it("should draw a path through points", () => {
    const layer = createLayer(100, 100);
    drawPath(
      layer,
      [
        { x: 10, y: 10 },
        { x: 50, y: 50 },
        { x: 90, y: 10 },
      ],
      RED,
    );
    expect(hasAnyPixels(layer)).toBe(true);
  });
});
