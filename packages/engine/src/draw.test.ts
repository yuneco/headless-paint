import { describe, expect, it } from "vitest";
import {
  applyPressureCurve,
  calculateRadius,
  drawCircle,
  drawLine,
  drawPath,
  interpolateStrokePoints,
} from "./draw";
import { createLayer, getImageData, getPixel } from "./layer";
import type { Color, Layer, PressureCurve, StrokePoint } from "./types";
import { DEFAULT_PRESSURE_CURVE } from "./types";

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

describe("applyPressureCurve", () => {
  it("should be linear with default curve (y1=1/3, y2=2/3)", () => {
    const curve = DEFAULT_PRESSURE_CURVE;
    expect(applyPressureCurve(0, curve)).toBeCloseTo(0);
    expect(applyPressureCurve(0.25, curve)).toBeCloseTo(0.25);
    expect(applyPressureCurve(0.5, curve)).toBeCloseTo(0.5);
    expect(applyPressureCurve(0.75, curve)).toBeCloseTo(0.75);
    expect(applyPressureCurve(1, curve)).toBeCloseTo(1);
  });

  it("should produce soft curve with y1=1, y2=1", () => {
    const soft: PressureCurve = { y1: 1, y2: 1 };
    // 低い入力でも高い出力になる
    const result = applyPressureCurve(0.3, soft);
    expect(result).toBeGreaterThan(0.5);
  });

  it("should produce hard curve with y1=0, y2=1/3", () => {
    const hard: PressureCurve = { y1: 0, y2: 1 / 3 };
    // 低い入力は更に低い出力になる
    const result = applyPressureCurve(0.3, hard);
    expect(result).toBeLessThan(0.15);
  });

  it("should always return 0 for input 0", () => {
    expect(applyPressureCurve(0, { y1: 0, y2: 0 })).toBe(0);
    expect(applyPressureCurve(0, { y1: 1, y2: 1 })).toBe(0);
    expect(applyPressureCurve(0, { y1: 0.5, y2: 0.8 })).toBe(0);
  });

  it("should always return 1 for input 1", () => {
    expect(applyPressureCurve(1, { y1: 0, y2: 0 })).toBe(1);
    expect(applyPressureCurve(1, { y1: 1, y2: 1 })).toBe(1);
    expect(applyPressureCurve(1, { y1: 0.5, y2: 0.8 })).toBe(1);
  });
});

describe("interpolateStrokePoints with overlapCount", () => {
  const mkPoint = (x: number, y: number): StrokePoint => ({
    x,
    y,
    pressure: 0.5,
  });

  it("overlapCount=0 should produce same output as no overlapCount", () => {
    const points = [mkPoint(0, 0), mkPoint(10, 0), mkPoint(20, 0)];
    const withoutOverlap = interpolateStrokePoints(points);
    const withOverlap = interpolateStrokePoints(points, 0);
    expect(withOverlap).toEqual(withoutOverlap);
  });

  it("overlapCount=3 with 4 points should skip first 2 segments and output from bridge", () => {
    const points = [
      mkPoint(0, 0),
      mkPoint(10, 0),
      mkPoint(20, 0),
      mkPoint(30, 0),
    ];
    const result = interpolateStrokePoints(points, 3);
    // skipSegments = max(0, 3 - 1) = 2
    // Points at index 0, 1 are skipped; index 2 (last overlap) is output
    // Bridge segment (index 2 → 3) and point at index 3 are output
    expect(result[0].x).toBe(20); // last overlap point
    expect(result[result.length - 1].x).toBe(30); // new point
  });

  it("overlapCount >= points.length should output only last point", () => {
    const points = [mkPoint(0, 0), mkPoint(10, 0), mkPoint(20, 0)];
    const result = interpolateStrokePoints(points, 3);
    // skipSegments = max(0, 3 - 1) = 2
    // Only index 2 point is output, no segments after it
    expect(result.length).toBe(1);
    expect(result[0].x).toBe(20);
  });

  it("1-point input should be unchanged regardless of overlapCount", () => {
    const points = [mkPoint(5, 5)];
    const result = interpolateStrokePoints(points, 1);
    expect(result).toEqual([{ x: 5, y: 5, pressure: 0.5 }]);
  });
});

describe("calculateRadius with pressureCurve", () => {
  it("should apply pressure curve before calculating radius", () => {
    const soft: PressureCurve = { y1: 1, y2: 1 };
    const baseLineWidth = 10;
    const sensitivity = 1;
    const pressure = 0.3;

    const radiusWithoutCurve = calculateRadius(
      pressure,
      baseLineWidth,
      sensitivity,
    );
    const radiusWithCurve = calculateRadius(
      pressure,
      baseLineWidth,
      sensitivity,
      soft,
    );

    // soft curve makes low pressure produce larger radius
    expect(radiusWithCurve).toBeGreaterThan(radiusWithoutCurve);
  });

  it("should not change radius when using default curve", () => {
    const baseLineWidth = 10;
    const sensitivity = 1;
    const pressure = 0.5;

    const radiusWithout = calculateRadius(pressure, baseLineWidth, sensitivity);
    const radiusWith = calculateRadius(
      pressure,
      baseLineWidth,
      sensitivity,
      DEFAULT_PRESSURE_CURVE,
    );

    expect(radiusWith).toBeCloseTo(radiusWithout);
  });
});
