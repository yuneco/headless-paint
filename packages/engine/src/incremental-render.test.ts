import { describe, expect, it } from "vitest";
import { compileExpand } from "./expand";
import {
  appendToCommittedLayer,
  composeLayers,
  renderPendingLayer,
} from "./incremental-render";
import { clearLayer, createLayer, getPixel } from "./layer";
import type { ExpandConfig, Point, StrokeStyle } from "./types";

const createTestStyle = (): StrokeStyle => ({
  color: { r: 255, g: 0, b: 0, a: 255 },
  lineWidth: 2,
});

const createNoneExpand = (): ReturnType<typeof compileExpand> => {
  const config: ExpandConfig = {
    levels: [
      { mode: "none", offset: { x: 50, y: 50 }, angle: 0, divisions: 1 },
    ],
  };
  return compileExpand(config);
};

describe("appendToCommittedLayer", () => {
  it("should not modify layer when points are empty", () => {
    const layer = createLayer(100, 100);
    const style = createTestStyle();
    const compiled = createNoneExpand();

    appendToCommittedLayer(layer, [], style, compiled);

    const pixel = getPixel(layer, 50, 50);
    expect(pixel.a).toBe(0);
  });

  it("should draw path on layer", () => {
    const layer = createLayer(100, 100);
    const style = createTestStyle();
    const compiled = createNoneExpand();
    const points: Point[] = [
      { x: 10, y: 50 },
      { x: 90, y: 50 },
    ];

    appendToCommittedLayer(layer, points, style, compiled);

    const pixel = getPixel(layer, 50, 50);
    expect(pixel.r).toBe(255);
    expect(pixel.a).toBe(255);
  });

  it("should preserve existing drawing (append mode)", () => {
    const layer = createLayer(100, 100);
    const style = createTestStyle();
    const compiled = createNoneExpand();

    const points1: Point[] = [
      { x: 10, y: 30 },
      { x: 90, y: 30 },
    ];
    appendToCommittedLayer(layer, points1, style, compiled);

    const points2: Point[] = [
      { x: 10, y: 70 },
      { x: 90, y: 70 },
    ];
    appendToCommittedLayer(layer, points2, style, compiled);

    expect(getPixel(layer, 50, 30).a).toBe(255);
    expect(getPixel(layer, 50, 70).a).toBe(255);
  });

  it("should draw with overlapCount > 0 (bridge segment)", () => {
    const layer = createLayer(100, 100);
    const style = createTestStyle();
    const compiled = createNoneExpand();
    // 3 overlap points + 1 new point
    const points = [
      { x: 10, y: 50 },
      { x: 30, y: 50 },
      { x: 50, y: 50 },
      { x: 70, y: 50 },
    ];

    appendToCommittedLayer(layer, points, style, compiled, 3);

    // Bridge area (around x=50-70) should have pixels
    expect(getPixel(layer, 60, 50).a).toBeGreaterThan(0);
  });

  it("overlapCount=0 should behave identically to no overlapCount", () => {
    const layer1 = createLayer(100, 100);
    const layer2 = createLayer(100, 100);
    const style = createTestStyle();
    const compiled = createNoneExpand();
    const points = [
      { x: 10, y: 50 },
      { x: 90, y: 50 },
    ];

    appendToCommittedLayer(layer1, points, style, compiled);
    appendToCommittedLayer(layer2, points, style, compiled, 0);

    expect(getPixel(layer1, 50, 50)).toEqual(getPixel(layer2, 50, 50));
  });
});

describe("renderPendingLayer", () => {
  it("should clear and redraw", () => {
    const layer = createLayer(100, 100);
    const style = createTestStyle();
    const compiled = createNoneExpand();

    const points1: Point[] = [
      { x: 10, y: 30 },
      { x: 90, y: 30 },
    ];
    appendToCommittedLayer(layer, points1, style, compiled);

    const points2: Point[] = [
      { x: 10, y: 70 },
      { x: 90, y: 70 },
    ];
    renderPendingLayer(layer, points2, style, compiled);

    expect(getPixel(layer, 50, 30).a).toBe(0);
    expect(getPixel(layer, 50, 70).a).toBe(255);
  });

  it("should clear layer when points are empty", () => {
    const layer = createLayer(100, 100);
    const style = createTestStyle();
    const compiled = createNoneExpand();

    const points: Point[] = [
      { x: 10, y: 50 },
      { x: 90, y: 50 },
    ];
    appendToCommittedLayer(layer, points, style, compiled);

    renderPendingLayer(layer, [], style, compiled);

    expect(getPixel(layer, 50, 50).a).toBe(0);
  });
});

describe("composeLayers", () => {
  it("should compose visible layers", () => {
    const layer1 = createLayer(100, 100, { name: "Layer1" });
    const layer2 = createLayer(100, 100, { name: "Layer2" });

    const style = createTestStyle();
    const compiled = createNoneExpand();

    appendToCommittedLayer(
      layer1,
      [
        { x: 10, y: 50 },
        { x: 90, y: 50 },
      ],
      style,
      compiled,
    );

    const blueStyle: StrokeStyle = {
      color: { r: 0, g: 0, b: 255, a: 255 },
      lineWidth: 2,
    };
    appendToCommittedLayer(
      layer2,
      [
        { x: 50, y: 10 },
        { x: 50, y: 90 },
      ],
      blueStyle,
      compiled,
    );

    const targetCanvas = new OffscreenCanvas(100, 100);
    const targetCtx = targetCanvas.getContext("2d");
    if (!targetCtx) throw new Error("Failed to get context");

    composeLayers(targetCtx as unknown as CanvasRenderingContext2D, [
      layer1,
      layer2,
    ]);

    const data = targetCtx.getImageData(50, 50, 1, 1).data;
    expect(data[3]).toBeGreaterThan(0);
  });

  it("should skip invisible layers", () => {
    const layer1 = createLayer(100, 100, { name: "Layer1", visible: false });
    const style = createTestStyle();
    const compiled = createNoneExpand();

    appendToCommittedLayer(
      layer1,
      [
        { x: 10, y: 50 },
        { x: 90, y: 50 },
      ],
      style,
      compiled,
    );

    const targetCanvas = new OffscreenCanvas(100, 100);
    const targetCtx = targetCanvas.getContext("2d");
    if (!targetCtx) throw new Error("Failed to get context");

    composeLayers(targetCtx as unknown as CanvasRenderingContext2D, [layer1]);

    const data = targetCtx.getImageData(50, 50, 1, 1).data;
    expect(data[3]).toBe(0);
  });

  it("should apply view transform", () => {
    const layer = createLayer(100, 100);
    const style = createTestStyle();
    const compiled = createNoneExpand();

    appendToCommittedLayer(
      layer,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      style,
      compiled,
    );

    const targetCanvas = new OffscreenCanvas(200, 200);
    const targetCtx = targetCanvas.getContext("2d");
    if (!targetCtx) throw new Error("Failed to get context");

    composeLayers(targetCtx as unknown as CanvasRenderingContext2D, [layer], {
      scale: 2,
      offsetX: 50,
      offsetY: 50,
    });

    const data = targetCtx.getImageData(60, 50, 1, 1).data;
    expect(data[3]).toBeGreaterThan(0);
  });
});
