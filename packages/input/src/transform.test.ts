import { describe, expect, it } from "vitest";
import { screenToLayer } from "./coordinate";
import {
  applyDpr,
  computeSimilarityTransform,
  createViewTransform,
  decomposeTransform,
  fitToView,
  pan,
  zoom,
} from "./transform";

describe("fitToView", () => {
  it("should fit a square layer to a square view at 1:1 scale", () => {
    const t = fitToView(500, 500, 500, 500);
    const components = decomposeTransform(t);

    expect(components.scaleX).toBeCloseTo(1);
    expect(components.translateX).toBeCloseTo(0);
    expect(components.translateY).toBeCloseTo(0);
  });

  it("should fit a wide layer to a square view (letterbox vertical)", () => {
    // 1000x500 layer into 500x500 view → scale = 0.5, centered vertically
    const t = fitToView(500, 500, 1000, 500);
    const components = decomposeTransform(t);

    expect(components.scaleX).toBeCloseTo(0.5);
    // Layer height after scaling: 500 * 0.5 = 250, offset = (500 - 250) / 2 = 125
    expect(components.translateY).toBeCloseTo(125);
    expect(components.translateX).toBeCloseTo(0);
  });

  it("should fit a tall layer to a square view (letterbox horizontal)", () => {
    // 500x1000 layer into 500x500 view → scale = 0.5, centered horizontally
    const t = fitToView(500, 500, 500, 1000);
    const components = decomposeTransform(t);

    expect(components.scaleX).toBeCloseTo(0.5);
    // Layer width after scaling: 500 * 0.5 = 250, offset = (500 - 250) / 2 = 125
    expect(components.translateX).toBeCloseTo(125);
    expect(components.translateY).toBeCloseTo(0);
  });

  it("should map layer origin to correct screen position", () => {
    // 1000x500 layer into 800x600 view → scale=0.8, letterbox vertical
    const t = fitToView(800, 600, 1000, 500);

    // Layer origin (0,0) should map to screen position via the transform
    const topLeft = screenToLayer({ x: 0, y: 0 }, t);
    expect(topLeft).not.toBeNull();
    // Screen (0,0) should map to negative layer y (layer is vertically centered)
    if (topLeft) {
      expect(topLeft.x).toBeCloseTo(0);
      expect(topLeft.y).toBeLessThan(0);
    }
  });

  it("should map layer corners symmetrically", () => {
    const t = fitToView(800, 600, 400, 300);
    const components = decomposeTransform(t);

    // scale = min(800/400, 600/300) = 2
    expect(components.scaleX).toBeCloseTo(2);
    // Layer fits exactly, both offsets should be 0
    expect(components.translateX).toBeCloseTo(0);
    expect(components.translateY).toBeCloseTo(0);
  });
});

describe("applyDpr", () => {
  it("should scale identity transform by dpr", () => {
    const identity = createViewTransform();
    const result = applyDpr(identity, 2);

    // Scale components doubled
    expect(result[0]).toBeCloseTo(2); // a
    expect(result[4]).toBeCloseTo(2); // d
    // Translate components doubled (0 * 2 = 0)
    expect(result[6]).toBeCloseTo(0); // tx
    expect(result[7]).toBeCloseTo(0); // ty
  });

  it("should scale an existing transform by dpr", () => {
    let t = createViewTransform();
    t = zoom(t, 2, 0, 0); // scale by 2
    t = pan(t, 100, 50); // translate

    const result = applyDpr(t, 3);

    // Scale: 2 * 3 = 6
    expect(result[0]).toBeCloseTo(6); // a
    expect(result[4]).toBeCloseTo(6); // d
    // Translate: 100 * 3 = 300, 50 * 3 = 150
    expect(result[6]).toBeCloseTo(300); // tx
    expect(result[7]).toBeCloseTo(150); // ty
  });

  it("should not mutate the original transform", () => {
    const original = createViewTransform();
    const originalClone = new Float32Array(original);

    applyDpr(original, 2);

    // Every element should remain unchanged
    for (let i = 0; i < 9; i++) {
      expect(original[i]).toBe(originalClone[i]);
    }
  });

  it("should handle dpr=1 as no-op", () => {
    let t = createViewTransform();
    t = zoom(t, 1.5, 100, 100);
    t = pan(t, 50, 25);

    const result = applyDpr(t, 1);

    for (let i = 0; i < 9; i++) {
      expect(result[i]).toBeCloseTo(t[i]);
    }
  });
});

describe("computeSimilarityTransform", () => {
  it("should return identity for matching points", () => {
    // Layer (0,0)→Screen (0,0), Layer (100,0)→Screen (100,0) → 恒等変換
    const result = computeSimilarityTransform(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result[0]).toBeCloseTo(1); // a
      expect(result[1]).toBeCloseTo(0); // b
      expect(result[3]).toBeCloseTo(0); // -b
      expect(result[4]).toBeCloseTo(1); // a
      expect(result[6]).toBeCloseTo(0); // tx
      expect(result[7]).toBeCloseTo(0); // ty
    }
  });

  it("should compute pure translation", () => {
    // Layer (0,0)→Screen (50,30), Layer (100,0)→Screen (150,30)
    const result = computeSimilarityTransform(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 30 },
      { x: 150, y: 30 },
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result[0]).toBeCloseTo(1);
      expect(result[1]).toBeCloseTo(0);
      expect(result[6]).toBeCloseTo(50);
      expect(result[7]).toBeCloseTo(30);
    }
  });

  it("should compute pure zoom (2x)", () => {
    // Layer (0,0)→Screen (0,0), Layer (100,0)→Screen (200,0)
    const result = computeSimilarityTransform(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result[0]).toBeCloseTo(2); // scale
      expect(result[1]).toBeCloseTo(0);
      expect(result[6]).toBeCloseTo(0);
      expect(result[7]).toBeCloseTo(0);
    }
  });

  it("should compute 90 degree rotation", () => {
    // Layer (0,0)→Screen (0,0), Layer (100,0)→Screen (0,100)
    const result = computeSimilarityTransform(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result[0]).toBeCloseTo(0); // a = cos(90°)
      expect(result[1]).toBeCloseTo(1); // b = sin(90°)
      expect(result[3]).toBeCloseTo(-1); // -b
      expect(result[4]).toBeCloseTo(0); // a
    }
  });

  it("should preserve point mapping (composite transform)", () => {
    const lP1 = { x: 50, y: 100 };
    const lP2 = { x: 200, y: 150 };
    const sP1 = { x: 300, y: 400 };
    const sP2 = { x: 100, y: 500 };

    const result = computeSimilarityTransform(lP1, lP2, sP1, sP2);
    expect(result).not.toBeNull();
    if (result) {
      // L1 → S1 が保存される
      const mappedS1x = result[0] * lP1.x + result[3] * lP1.y + result[6];
      const mappedS1y = result[1] * lP1.x + result[4] * lP1.y + result[7];
      expect(mappedS1x).toBeCloseTo(sP1.x);
      expect(mappedS1y).toBeCloseTo(sP1.y);

      // L2 → S2 が保存される
      const mappedS2x = result[0] * lP2.x + result[3] * lP2.y + result[6];
      const mappedS2y = result[1] * lP2.x + result[4] * lP2.y + result[7];
      expect(mappedS2x).toBeCloseTo(sP2.x);
      expect(mappedS2y).toBeCloseTo(sP2.y);
    }
  });

  it("should return null for degenerate case (identical layer points)", () => {
    const result = computeSimilarityTransform(
      { x: 100, y: 100 },
      { x: 100, y: 100 },
      { x: 0, y: 0 },
      { x: 200, y: 200 },
    );
    expect(result).toBeNull();
  });
});
