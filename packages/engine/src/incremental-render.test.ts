import { describe, expect, it } from "vitest";
import { compileExpand } from "./expand";
import {
  appendToCommittedLayer,
  composeLayers,
  renderPendingLayer,
} from "./incremental-render";
import { clearLayer, createLayer, getPixel } from "./layer";
import type { ExpandConfig, PendingOverlay, Point, StrokeStyle } from "./types";
import { DEFAULT_PRESSURE_CURVE, ROUND_PEN } from "./types";

const createTestStyle = (): StrokeStyle => ({
  color: { r: 255, g: 0, b: 0, a: 255 },
  lineWidth: 2,
  pressureSensitivity: 0,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  compositeOperation: "source-over",
  brush: ROUND_PEN,
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
      pressureSensitivity: 0,
      pressureCurve: DEFAULT_PRESSURE_CURVE,
      compositeOperation: "source-over",
      brush: ROUND_PEN,
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

  it("should apply pendingOverlay with pre-composite for opacity < 1", () => {
    const committed = createLayer(100, 100, {
      name: "Committed",
      opacity: 0.5,
    });
    const pending = createLayer(100, 100, { name: "Pending" });
    const workLayer = createLayer(100, 100, { name: "Work" });

    const style = createTestStyle();
    const compiled = createNoneExpand();

    // Draw on committed
    appendToCommittedLayer(
      committed,
      [
        { x: 10, y: 50 },
        { x: 90, y: 50 },
      ],
      style,
      compiled,
    );

    // Draw on pending (overlapping area)
    appendToCommittedLayer(
      pending,
      [
        { x: 10, y: 50 },
        { x: 90, y: 50 },
      ],
      style,
      compiled,
    );

    const overlay: PendingOverlay = {
      layer: pending,
      targetLayerId: committed.id,
      workLayer,
    };

    const targetCanvas = new OffscreenCanvas(100, 100);
    const targetCtx = targetCanvas.getContext("2d");
    if (!targetCtx) throw new Error("Failed to get context");

    // With pre-composite: committed + pending merged first, then 50% opacity applied once
    composeLayers(
      targetCtx as unknown as CanvasRenderingContext2D,
      [committed],
      undefined,
      overlay,
    );
    const withPreComposite = targetCtx.getImageData(50, 50, 1, 1).data;

    // Without pre-composite (flat): committed at 50% + pending at 50% = double opacity
    targetCtx.clearRect(0, 0, 100, 100);
    composeLayers(targetCtx as unknown as CanvasRenderingContext2D, [
      committed,
      pending,
    ]);
    const withFlat = targetCtx.getImageData(50, 50, 1, 1).data;

    // Pre-composite should produce lower alpha than flat (no double-application)
    expect(withPreComposite[3]).toBeGreaterThan(0);
    expect(withPreComposite[3]).toBeLessThanOrEqual(withFlat[3]);
  });

  it("should apply pendingOverlay with eraser (destination-out)", () => {
    const committed = createLayer(100, 100, { name: "Committed" });
    const pending = createLayer(100, 100, {
      name: "Pending",
      compositeOperation: "destination-out",
    });
    const workLayer = createLayer(100, 100, { name: "Work" });

    const style = createTestStyle();
    const compiled = createNoneExpand();

    // Draw on committed
    appendToCommittedLayer(
      committed,
      [
        { x: 10, y: 50 },
        { x: 90, y: 50 },
      ],
      style,
      compiled,
    );

    // Draw on pending (eraser stroke over same area)
    appendToCommittedLayer(
      pending,
      [
        { x: 40, y: 50 },
        { x: 60, y: 50 },
      ],
      style,
      compiled,
    );

    const overlay: PendingOverlay = {
      layer: pending,
      targetLayerId: committed.id,
      workLayer,
    };

    const targetCanvas = new OffscreenCanvas(100, 100);
    const targetCtx = targetCanvas.getContext("2d");
    if (!targetCtx) throw new Error("Failed to get context");

    composeLayers(
      targetCtx as unknown as CanvasRenderingContext2D,
      [committed],
      undefined,
      overlay,
    );

    // Erased area should have lower alpha
    const erasedData = targetCtx.getImageData(50, 50, 1, 1).data;
    // Non-erased area should still have pixels
    const unerasedData = targetCtx.getImageData(20, 50, 1, 1).data;

    expect(unerasedData[3]).toBeGreaterThan(0);
    expect(erasedData[3]).toBeLessThan(unerasedData[3]);
  });

  it("should skip pre-composite when all settings are normal", () => {
    // opacity=1, compositeOperation=undefined, pending compositeOperation=undefined
    const committed = createLayer(100, 100, { name: "Committed" });
    const pending = createLayer(100, 100, { name: "Pending" });
    const workLayer = createLayer(100, 100, { name: "Work" });

    const style = createTestStyle();
    const compiled = createNoneExpand();

    appendToCommittedLayer(
      committed,
      [
        { x: 10, y: 50 },
        { x: 90, y: 50 },
      ],
      style,
      compiled,
    );
    appendToCommittedLayer(
      pending,
      [
        { x: 10, y: 50 },
        { x: 90, y: 50 },
      ],
      style,
      compiled,
    );

    const overlay: PendingOverlay = {
      layer: pending,
      targetLayerId: committed.id,
      workLayer,
    };

    const targetCanvas = new OffscreenCanvas(100, 100);
    const targetCtx = targetCanvas.getContext("2d");
    if (!targetCtx) throw new Error("Failed to get context");

    // With overlay (flat path since all normal)
    composeLayers(
      targetCtx as unknown as CanvasRenderingContext2D,
      [committed],
      undefined,
      overlay,
    );
    const withOverlay = targetCtx.getImageData(50, 50, 1, 1).data;

    // Without overlay, manual flat
    targetCtx.clearRect(0, 0, 100, 100);
    composeLayers(targetCtx as unknown as CanvasRenderingContext2D, [
      committed,
      pending,
    ]);
    const withFlat = targetCtx.getImageData(50, 50, 1, 1).data;

    // Results should be identical (both flat)
    expect(withOverlay[0]).toBe(withFlat[0]);
    expect(withOverlay[1]).toBe(withFlat[1]);
    expect(withOverlay[2]).toBe(withFlat[2]);
    expect(withOverlay[3]).toBe(withFlat[3]);
  });

  it("should apply blend mode with pre-composite", () => {
    const committed = createLayer(100, 100, {
      name: "Committed",
      compositeOperation: "multiply",
    });
    const pending = createLayer(100, 100, { name: "Pending" });
    const workLayer = createLayer(100, 100, { name: "Work" });

    const style = createTestStyle();
    const compiled = createNoneExpand();

    appendToCommittedLayer(
      committed,
      [
        { x: 10, y: 50 },
        { x: 90, y: 50 },
      ],
      style,
      compiled,
    );

    const overlay: PendingOverlay = {
      layer: pending,
      targetLayerId: committed.id,
      workLayer,
    };

    const targetCanvas = new OffscreenCanvas(100, 100);
    const targetCtx = targetCanvas.getContext("2d");
    if (!targetCtx) throw new Error("Failed to get context");

    // Should not throw and should produce visible output
    composeLayers(
      targetCtx as unknown as CanvasRenderingContext2D,
      [committed],
      undefined,
      overlay,
    );

    const data = targetCtx.getImageData(50, 50, 1, 1).data;
    expect(data[3]).toBeGreaterThan(0);
  });
});
