import { describe, expect, it } from "vitest";
import { hashSeed, mulberry32, renderBrushStroke } from "./brush-render";
import { generateBrushTip } from "./brush-tip";
import { createLayer } from "./layer";
import type {
  BrushRenderState,
  Color,
  StrokePoint,
  StrokeStyle,
} from "./types";
import {
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_PRESSURE_CURVE,
  ROUND_PEN,
} from "./types";

const BLACK: Color = { r: 0, g: 0, b: 0, a: 255 };

function makeStyle(overrides?: Partial<StrokeStyle>): StrokeStyle {
  return {
    color: BLACK,
    lineWidth: 8,
    pressureSensitivity: 0,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush: ROUND_PEN,
    ...overrides,
  };
}

function makeLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  count: number,
): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push({
      x: x1 + (x2 - x1) * t,
      y: y1 + (y2 - y1) * t,
      pressure: 0.5,
    });
  }
  return points;
}

// ============================================================
// PRNG tests
// ============================================================

describe("mulberry32", () => {
  it("同じシードから同じ乱数列を生成する", () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    for (let i = 0; i < 10; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("異なるシードから異なる乱数列を生成する", () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(54321);
    const values1 = Array.from({ length: 5 }, () => rng1());
    const values2 = Array.from({ length: 5 }, () => rng2());
    expect(values1).not.toEqual(values2);
  });

  it("[0, 1) の範囲の値を返す", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hashSeed", () => {
  it("同じ入力から同じシードを生成する", () => {
    expect(hashSeed(100, 50.0)).toBe(hashSeed(100, 50.0));
  });

  it("距離の量子化: 近い距離値は同じシードを返す", () => {
    // round(50.004 * 100) = 5000, round(50.006 * 100) = 5001
    expect(hashSeed(100, 50.004)).toBe(hashSeed(100, 50.004));
  });

  it("異なる距離は異なるシードを返す", () => {
    expect(hashSeed(100, 10.0)).not.toBe(hashSeed(100, 20.0));
  });

  it("異なるグローバルシードは異なるシードを返す", () => {
    expect(hashSeed(100, 50.0)).not.toBe(hashSeed(200, 50.0));
  });
});

// ============================================================
// renderBrushStroke tests
// ============================================================

describe("renderBrushStroke", () => {
  describe("round-pen", () => {
    it("round-pen で描画すると BrushRenderState を返す", () => {
      const layer = createLayer(100, 100);
      const points = makeLine(10, 50, 90, 50, 5);
      const style = makeStyle();
      const result = renderBrushStroke(layer, points, style);
      expect(result).toEqual({
        accumulatedDistance: 0,
        tipCanvas: null,
        seed: 0,
      });
    });

    it("round-pen で渡した state がそのまま返される", () => {
      const layer = createLayer(100, 100);
      const points = makeLine(10, 50, 90, 50, 5);
      const style = makeStyle();
      const inputState: BrushRenderState = {
        accumulatedDistance: 42,
        tipCanvas: null,
        seed: 123,
      };
      const result = renderBrushStroke(layer, points, style, 0, inputState);
      expect(result).toBe(inputState);
    });
  });

  describe("stamp brush", () => {
    function makeStampStyle(): StrokeStyle {
      return makeStyle({
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1.0 },
          dynamics: {
            ...DEFAULT_BRUSH_DYNAMICS,
            spacing: 0.25,
          },
        },
      });
    }

    function makeInitialState(style: StrokeStyle): BrushRenderState {
      const brush = style.brush as {
        type: "stamp";
        tip: { type: "circle"; hardness: number };
      };
      return {
        accumulatedDistance: 0,
        tipCanvas: generateBrushTip(
          brush.tip,
          Math.ceil(style.lineWidth * 2),
          style.color,
        ),
        seed: 42,
      };
    }

    it("スタンプブラシで描画すると accumulatedDistance が更新される", () => {
      const layer = createLayer(200, 200);
      const points = makeLine(10, 100, 190, 100, 10);
      const style = makeStampStyle();
      const state = makeInitialState(style);

      const result = renderBrushStroke(layer, points, style, 0, state);
      expect(result.accumulatedDistance).toBeGreaterThan(0);
      expect(result.tipCanvas).toBe(state.tipCanvas);
      expect(result.seed).toBe(42);
    });

    it("tipCanvas が null の場合は描画をスキップする", () => {
      const layer = createLayer(100, 100);
      const points = makeLine(10, 50, 90, 50, 5);
      const style = makeStampStyle();
      const state: BrushRenderState = {
        accumulatedDistance: 0,
        tipCanvas: null,
        seed: 0,
      };

      const result = renderBrushStroke(layer, points, style, 0, state);
      expect(result.accumulatedDistance).toBe(0); // unchanged
    });

    it("連続呼び出しで accumulatedDistance が累積する", () => {
      const layer = createLayer(200, 200);
      const style = makeStampStyle();
      const initialState = makeInitialState(style);

      // 第1バッチ
      const points1 = makeLine(10, 100, 50, 100, 5);
      const state1 = renderBrushStroke(layer, points1, style, 0, initialState);

      // 第2バッチ（前回の状態から継続）
      const points2 = makeLine(50, 100, 100, 100, 5);
      const state2 = renderBrushStroke(layer, points2, style, 0, state1);

      expect(state2.accumulatedDistance).toBeGreaterThan(
        state1.accumulatedDistance,
      );
    });

    it("決定論性: 同じ入力から同じ描画結果が得られる", () => {
      const style = makeStampStyle();
      const points = makeLine(10, 100, 190, 100, 10);

      // 1回目
      const layer1 = createLayer(200, 200);
      const state1 = makeInitialState(style);
      const result1 = renderBrushStroke(layer1, points, style, 0, state1);
      const pixels1 = layer1.ctx.getImageData(0, 0, 200, 200).data;

      // 2回目（同じ入力）
      const layer2 = createLayer(200, 200);
      const state2 = makeInitialState(style);
      const result2 = renderBrushStroke(layer2, points, style, 0, state2);
      const pixels2 = layer2.ctx.getImageData(0, 0, 200, 200).data;

      expect(result1.accumulatedDistance).toBe(result2.accumulatedDistance);
      expect(pixels1).toEqual(pixels2);
    });

    it("スタンプがキャンバスに実際に描画されている", () => {
      const layer = createLayer(200, 200);
      const points = makeLine(10, 100, 190, 100, 10);
      const style = makeStampStyle();
      const state = makeInitialState(style);

      renderBrushStroke(layer, points, style, 0, state);

      // 描画されたピクセルを確認
      const imageData = layer.ctx.getImageData(0, 0, 200, 200).data;
      let hasNonZero = false;
      for (let i = 3; i < imageData.length; i += 4) {
        if (imageData[i] > 0) {
          hasNonZero = true;
          break;
        }
      }
      expect(hasNonZero).toBe(true);
    });

    it("jitter パラメータが描画結果に影響する", () => {
      const points = makeLine(10, 100, 190, 100, 20);

      // jitter なし
      const style1 = makeStyle({
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1.0 },
          dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.25 },
        },
      });
      const layer1 = createLayer(200, 200);
      renderBrushStroke(layer1, points, style1, 0, {
        accumulatedDistance: 0,
        tipCanvas: generateBrushTip(
          { type: "circle", hardness: 1.0 },
          16,
          BLACK,
        ),
        seed: 42,
      });

      // jitter あり
      const style2 = makeStyle({
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1.0 },
          dynamics: {
            ...DEFAULT_BRUSH_DYNAMICS,
            spacing: 0.25,
            sizeJitter: 0.5,
            opacityJitter: 0.3,
            scatter: 0.5,
          },
        },
      });
      const layer2 = createLayer(200, 200);
      renderBrushStroke(layer2, points, style2, 0, {
        accumulatedDistance: 0,
        tipCanvas: generateBrushTip(
          { type: "circle", hardness: 1.0 },
          16,
          BLACK,
        ),
        seed: 42,
      });

      const pixels1 = layer1.ctx.getImageData(0, 0, 200, 200).data;
      const pixels2 = layer2.ctx.getImageData(0, 0, 200, 200).data;
      expect(pixels1).not.toEqual(pixels2);
    });
  });
});
