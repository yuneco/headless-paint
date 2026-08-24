import { describe, expect, it } from "vitest";
import { renderBrushStroke } from ".";
import { createLayer } from "../layer";
import type {
  BrushRenderState,
  Color,
  StrokePoint,
  StrokeStyle,
} from "../types";
import {
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  ROUND_PEN,
} from "../types";
import { generateBrushTip } from "./tip";

const BLACK: Color = { r: 0, g: 0, b: 0, a: 255 };

function makeStyle(overrides?: Partial<StrokeStyle>): StrokeStyle {
  return {
    color: BLACK,
    lineWidth: 8,
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

function primaryBranch(state: BrushRenderState) {
  return state.branches[0];
}

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
        tipCanvas: null,
        seed: 0,
        branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
      });
    });

    it("round-pen で渡した state がそのまま返される", () => {
      const layer = createLayer(100, 100);
      const points = makeLine(10, 50, 90, 50, 5);
      const style = makeStyle();
      const inputState: BrushRenderState = {
        tipCanvas: null,
        seed: 123,
        branches: [{ accumulatedDistance: 42, emissionCount: 0 }],
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
          pressureDynamics: { size: 0, flow: 0 },
        },
      });
    }

    function makeInitialState(style: StrokeStyle): BrushRenderState {
      const brush = style.brush as {
        type: "stamp";
        tip: { type: "circle"; hardness: number };
      };
      return {
        tipCanvas: generateBrushTip(
          brush.tip,
          Math.ceil(style.lineWidth * 2),
          style.color,
        ),
        seed: 42,
        branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
      };
    }

    it("スタンプブラシで描画すると accumulatedDistance が更新される", () => {
      const layer = createLayer(200, 200);
      const points = makeLine(10, 100, 190, 100, 10);
      const style = makeStampStyle();
      const state = makeInitialState(style);

      const result = renderBrushStroke(layer, points, style, 0, state);
      expect(primaryBranch(result).accumulatedDistance).toBeGreaterThan(0);
      expect(result.tipCanvas).toBe(state.tipCanvas);
      expect(result.seed).toBe(42);
    });

    it("低筆圧では実効tip径へのspacing追従により点線化を抑える", () => {
      const points: StrokePoint[] = [
        { x: 10, y: 50, pressure: 0.1 },
        { x: 90, y: 50, pressure: 0.1 },
      ];
      const fixedStyle = makeStyle({
        lineWidth: 20,
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1 },
          dynamics: {
            ...DEFAULT_BRUSH_DYNAMICS,
            spacing: 0.25,
            spacingSizeCoupling: 0,
          },
          pressureDynamics: { size: 1, flow: 0 },
        },
      });
      if (fixedStyle.brush.type !== "stamp") {
        throw new Error("Expected stamp brush");
      }
      const coupledStyle = makeStyle({
        ...fixedStyle,
        brush: {
          ...fixedStyle.brush,
          dynamics: {
            ...fixedStyle.brush.dynamics,
            spacingSizeCoupling: 1,
          },
        },
      });

      const fixed = renderBrushStroke(
        createLayer(100, 100),
        points,
        fixedStyle,
        0,
        makeInitialState(fixedStyle),
      );
      const coupled = renderBrushStroke(
        createLayer(100, 100),
        points,
        coupledStyle,
        0,
        makeInitialState(coupledStyle),
      );

      expect(primaryBranch(coupled).emissionCount).toBeGreaterThan(
        primaryBranch(fixed).emissionCount,
      );
      expect(primaryBranch(coupled).distanceEmissionProgress).toBeDefined();
    });

    it("tipCanvas が null の場合は描画をスキップする", () => {
      const layer = createLayer(100, 100);
      const points = makeLine(10, 50, 90, 50, 5);
      const style = makeStampStyle();
      const state: BrushRenderState = {
        tipCanvas: null,
        seed: 0,
        branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
      };

      const result = renderBrushStroke(layer, points, style, 0, state);
      expect(primaryBranch(result).accumulatedDistance).toBe(0); // unchanged
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

      expect(primaryBranch(state2).accumulatedDistance).toBeGreaterThan(
        primaryBranch(state1).accumulatedDistance,
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

      expect(primaryBranch(result1).accumulatedDistance).toBe(
        primaryBranch(result2).accumulatedDistance,
      );
      expect(pixels1).toEqual(pixels2);
    });

    it("吹きつけ有効時は同一座標でも時間経過で描画が濃くなる", () => {
      const holdPoints: StrokePoint[] = [
        { x: 50, y: 50, pressure: 0.5, timestamp: 0 },
        { x: 50, y: 50, pressure: 0.5, timestamp: 200 },
      ];
      const makeHoldStyle = (emissionsPerSecond?: number) =>
        makeStyle({
          brush: {
            type: "stamp",
            tip: { type: "circle", hardness: 1.0 },
            dynamics: {
              ...DEFAULT_BRUSH_DYNAMICS,
              spacing: 0.25,
              flow: 0.2,
              emissionsPerSecond,
            },
            pressureDynamics: { size: 0, flow: 0 },
          },
        });

      // 吹きつけOFF: 開始 emission のみ
      const styleOff = makeHoldStyle(undefined);
      const layerOff = createLayer(100, 100);
      renderBrushStroke(
        layerOff,
        holdPoints,
        styleOff,
        0,
        makeInitialState(styleOff),
      );
      const alphaOff = layerOff.ctx.getImageData(50, 50, 1, 1).data[3];

      // 吹きつけON: 開始 + 時間 emission が同座標に重なる
      const styleOn = makeHoldStyle(40);
      const layerOn = createLayer(100, 100);
      const resultOn = renderBrushStroke(
        layerOn,
        holdPoints,
        styleOn,
        0,
        makeInitialState(styleOn),
      );
      const alphaOn = layerOn.ctx.getImageData(50, 50, 1, 1).data[3];

      expect(alphaOff).toBeGreaterThan(0);
      expect(alphaOn).toBeGreaterThan(alphaOff);
      // 40/sec（25ms間隔）× 200ms = 8 emissions + 開始1
      expect(primaryBranch(resultOn).emissionCount).toBe(9);
      expect(primaryBranch(resultOn).accumulatedDistance).toBe(0);
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

    it("1点だけのスタンプストロークでも開始点に描画する", () => {
      const layer = createLayer(100, 100);
      const style = makeStampStyle();
      const state = makeInitialState(style);

      const result = renderBrushStroke(
        layer,
        [{ x: 50, y: 50, pressure: 1 }],
        style,
        0,
        state,
      );

      const pixel = layer.ctx.getImageData(50, 50, 1, 1).data;
      expect(pixel[3]).toBeGreaterThan(0);
      expect(primaryBranch(result).emissionCount).toBe(1);
      expect(primaryBranch(result).accumulatedDistance).toBe(0);
    });

    it("overlap 文脈だけの単一点では重複スタンプを打たない", () => {
      const layer = createLayer(100, 100);
      const style = makeStampStyle();
      const state = {
        ...makeInitialState(style),
        branches: [{ accumulatedDistance: 10, emissionCount: 4 }],
      };

      const result = renderBrushStroke(
        layer,
        [{ x: 50, y: 50, pressure: 1 }],
        style,
        1,
        state,
      );

      const pixel = layer.ctx.getImageData(50, 50, 1, 1).data;
      expect(pixel[3]).toBe(0);
      expect(result).toEqual(state);
    });

    it("jitter パラメータが描画結果に影響する", () => {
      const points = makeLine(10, 100, 190, 100, 20);

      // jitter なし
      const style1 = makeStyle({
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1.0 },
          dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.25 },
          pressureDynamics: { size: 0, flow: 0 },
        },
      });
      const layer1 = createLayer(200, 200);
      renderBrushStroke(layer1, points, style1, 0, {
        tipCanvas: generateBrushTip(
          { type: "circle", hardness: 1.0 },
          16,
          BLACK,
        ),
        seed: 42,
        branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
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
          pressureDynamics: { size: 0, flow: 0 },
        },
      });
      const layer2 = createLayer(200, 200);
      renderBrushStroke(layer2, points, style2, 0, {
        tipCanvas: generateBrushTip(
          { type: "circle", hardness: 1.0 },
          16,
          BLACK,
        ),
        seed: 42,
        branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
      });

      const pixels1 = layer1.ctx.getImageData(0, 0, 200, 200).data;
      const pixels2 = layer2.ctx.getImageData(0, 0, 200, 200).data;
      expect(pixels1).not.toEqual(pixels2);
    });

    it("pressureDynamics.flow でスタンプの不透明度が変わる", () => {
      const points: StrokePoint[] = [{ x: 50, y: 50, pressure: 0.5 }];
      const baseBrush = {
        type: "stamp" as const,
        tip: { type: "circle" as const, hardness: 1.0 },
        dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 1, flow: 1 },
      };

      const uniformStyle = makeStyle({
        lineWidth: 20,
        brush: {
          ...baseBrush,
          pressureDynamics: { size: 0, flow: 0 },
        },
      });
      const pressureFlowStyle = makeStyle({
        lineWidth: 20,
        brush: {
          ...baseBrush,
          pressureDynamics: { size: 0, flow: 1 },
        },
      });

      const uniformLayer = createLayer(100, 100);
      renderBrushStroke(
        uniformLayer,
        points,
        uniformStyle,
        0,
        makeInitialState(uniformStyle),
      );

      const pressureFlowLayer = createLayer(100, 100);
      renderBrushStroke(
        pressureFlowLayer,
        points,
        pressureFlowStyle,
        0,
        makeInitialState(pressureFlowStyle),
      );

      const uniformAlpha = uniformLayer.ctx.getImageData(50, 50, 1, 1).data[3];
      const pressureFlowAlpha = pressureFlowLayer.ctx.getImageData(50, 50, 1, 1)
        .data[3];

      expect(pressureFlowAlpha).toBeLessThan(uniformAlpha);
      expect(pressureFlowAlpha).toBeGreaterThan(0);
    });

    it("incremental（overlap 付き）と replay で emissionCount が一致する", () => {
      const style = makeStampStyle();
      // 曲線的なポイント列（直線より差が出やすい）
      const allPoints: StrokePoint[] = [];
      for (let i = 0; i < 30; i++) {
        allPoints.push({
          x: 10 + i * 6,
          y: 100 + Math.sin(i * 0.4) * 30,
          pressure: 0.5 + Math.sin(i * 0.2) * 0.3,
        });
      }

      const initialState = makeInitialState(style);

      // incremental: 3チャンクに分割（overlap=3）
      const layer1 = createLayer(200, 200);
      const chunk1 = allPoints.slice(0, 12);
      const state1 = renderBrushStroke(layer1, chunk1, style, 0, initialState);

      const chunk2 = allPoints.slice(9, 22); // overlap=3
      const state2 = renderBrushStroke(layer1, chunk2, style, 3, state1);

      const chunk3 = allPoints.slice(19, 30); // overlap=3
      const state3 = renderBrushStroke(layer1, chunk3, style, 3, state2);

      // replay: 一括
      const layer2 = createLayer(200, 200);
      const replayResult = renderBrushStroke(
        layer2,
        allPoints,
        style,
        0,
        initialState,
      );

      // emissionCount が一致すること（= emission index PRNG の jitter が一致）
      expect(primaryBranch(state3).emissionCount).toBe(
        primaryBranch(replayResult).emissionCount,
      );

      // accumulatedDistance は Catmull-Rom のチャンク境界クランプにより
      // 微小な差が生じる（round-pen も同じ）。誤差 1% 以内を確認
      const distDiff = Math.abs(
        primaryBranch(state3).accumulatedDistance -
          primaryBranch(replayResult).accumulatedDistance,
      );
      const relError =
        distDiff / primaryBranch(replayResult).accumulatedDistance;
      expect(relError).toBeLessThan(0.01);
    });

    it("筆圧平滑化状態はincrementalとreplayで一致する", () => {
      const style = makeStyle({
        lineWidth: 20,
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1 },
          dynamics: {
            ...DEFAULT_BRUSH_DYNAMICS,
            spacing: 0.1,
          },
          pressureDynamics: { size: 1, flow: 0.5, smoothingMs: 50 },
        },
      });
      const points: StrokePoint[] = Array.from({ length: 25 }, (_, index) => ({
        x: 20 + index * 5,
        y: 60,
        pressure: 0.45 + Math.sin(index * 0.7) * 0.25,
        timestamp: index * 4,
      }));

      const incrementalLayer = createLayer(160, 120);
      const first = renderBrushStroke(
        incrementalLayer,
        points.slice(0, 14),
        style,
        0,
        makeInitialState(style),
      );
      const incremental = renderBrushStroke(
        incrementalLayer,
        points.slice(11),
        style,
        3,
        first,
      );

      const replayLayer = createLayer(160, 120);
      const replay = renderBrushStroke(
        replayLayer,
        points,
        style,
        0,
        makeInitialState(style),
      );

      expect(primaryBranch(incremental).pressure?.value).toBeCloseTo(
        primaryBranch(replay).pressure?.value ?? 0,
        6,
      );
      expect(primaryBranch(incremental).pressure?.timestamp).toBeCloseTo(
        primaryBranch(replay).pressure?.timestamp ?? 0,
        6,
      );
      expect(incrementalLayer.ctx.getImageData(0, 0, 160, 120).data).toEqual(
        replayLayer.ctx.getImageData(0, 0, 160, 120).data,
      );
    });

    it("混色は現在dabを元色でdepositし、次位置用fieldへ局所色差を保持する", () => {
      const source = createLayer(100, 100);
      source.ctx.fillStyle = "rgb(255, 0, 0)";
      source.ctx.fillRect(0, 0, 50, 100);
      source.ctx.fillStyle = "rgb(0, 0, 255)";
      source.ctx.fillRect(50, 0, 50, 100);

      const target = createLayer(100, 100);
      const style = makeStyle({
        color: { r: 0, g: 180, b: 40, a: 255 },
        lineWidth: 20,
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1.0 },
          dynamics: {
            ...DEFAULT_BRUSH_DYNAMICS,
            spacing: 1,
            flow: 1,
          },
          mixing: {
            ...DEFAULT_BRUSH_MIXING,
            enabled: true,
            pickupRatePerPx: 10,
            restoreRatePerPx: 0,
            diffusionRatePerPx: 0,
          },
          pressureDynamics: { size: 0, flow: 0 },
        },
      });
      const state = makeInitialState(style);

      const result = renderBrushStroke(
        target,
        [{ x: 50, y: 50, pressure: 1 }],
        style,
        0,
        state,
        source,
      );

      const deposit = target.ctx.getImageData(50, 50, 1, 1).data;
      expect(deposit[1]).toBeGreaterThan(deposit[0]);
      expect(deposit[1]).toBeGreaterThan(deposit[2]);

      const field = result.branches[0].mixing?.field;
      expect(field).toBeInstanceOf(Float32Array);
      if (!field) throw new Error("Expected mixing field");
      const leftOffset = 4 * 4;
      const rightOffset = 4 * 13;
      expect(field[leftOffset]).toBeGreaterThan(field[leftOffset + 2]);
      expect(field[rightOffset + 2]).toBeGreaterThan(field[rightOffset]);
    });

    it("混色には描画先と独立したstroke-start sourceLayerを要求する", () => {
      const layer = createLayer(100, 100);
      const style = makeStyle({
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1 },
          dynamics: DEFAULT_BRUSH_DYNAMICS,
          pressureDynamics: { size: 0, flow: 0 },
          mixing: { ...DEFAULT_BRUSH_MIXING, enabled: true },
        },
      });

      expect(() =>
        renderBrushStroke(
          layer,
          [{ x: 50, y: 50, pressure: 1 }],
          style,
          0,
          makeInitialState(style),
        ),
      ).toThrow(/distinct stroke-start sourceLayer snapshot/);
      expect(() =>
        renderBrushStroke(
          layer,
          [{ x: 50, y: 50, pressure: 1 }],
          style,
          0,
          makeInitialState(style),
          layer,
        ),
      ).toThrow(/distinct stroke-start sourceLayer snapshot/);
    });

    it("局所色を接触前方へ漏らさず進行方向の後方へ引く", () => {
      const source = createLayer(120, 60);
      source.ctx.fillStyle = "rgb(255, 0, 0)";
      source.ctx.fillRect(48, 0, 8, 60);
      const target = createLayer(120, 60);
      const style = makeStyle({
        color: { r: 0, g: 40, b: 255, a: 255 },
        lineWidth: 12,
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1 },
          dynamics: {
            ...DEFAULT_BRUSH_DYNAMICS,
            spacing: 0.08,
            flow: 1,
          },
          pressureDynamics: { size: 0, flow: 0 },
          mixing: {
            ...DEFAULT_BRUSH_MIXING,
            enabled: true,
            pickupRatePerPx: 2,
            restoreRatePerPx: 0,
            diffusionRatePerPx: 0.2,
            updateDistancePx: 1,
            checkpointDistancePx: 200,
          },
        },
      });

      renderBrushStroke(
        target,
        makeLine(18, 30, 100, 30, 42),
        style,
        0,
        makeInitialState(style),
        source,
      );

      const before = target.ctx.getImageData(28, 30, 1, 1).data;
      const after = target.ctx.getImageData(70, 30, 1, 1).data;
      expect(before[2]).toBeGreaterThan(before[0]);
      expect(after[0]).toBeGreaterThan(after[2]);
    });

    it("描画済み色の再取得checkpointはlayer全体ではなく有限tileを保持する", () => {
      const source = createLayer(600, 400);
      const target = createLayer(600, 400);
      const style = makeStyle({
        lineWidth: 20,
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1 },
          dynamics: {
            ...DEFAULT_BRUSH_DYNAMICS,
            spacing: 0.1,
            flow: 1,
          },
          pressureDynamics: { size: 0, flow: 0 },
          mixing: {
            ...DEFAULT_BRUSH_MIXING,
            enabled: true,
            updateDistancePx: 2,
            checkpointDistancePx: 10,
          },
        },
      });

      const result = renderBrushStroke(
        target,
        makeLine(50, 200, 300, 200, 40),
        style,
        0,
        makeInitialState(style),
        source,
      );
      const checkpoint = result.branches[0]?.mixing?.checkpointCanvas;
      const checkpointPixels = result.branches[0]?.mixing?.checkpointPixels;

      expect(checkpoint).toBeDefined();
      expect(checkpointPixels).toBeDefined();
      expect(checkpointPixels?.width).toBe(checkpoint?.width);
      expect(checkpointPixels?.height).toBe(checkpoint?.height);
      expect(checkpoint?.width).toBeLessThan(source.width);
      expect(checkpoint?.height).toBeLessThan(source.height);
    });

    it("混色更新はupdateDistanceごとに次のdabへ反映される", () => {
      const style = makeStyle({
        color: { r: 0, g: 180, b: 40, a: 255 },
        lineWidth: 10,
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1.0 },
          dynamics: {
            ...DEFAULT_BRUSH_DYNAMICS,
            spacing: 0.1,
            flow: 1,
          },
          mixing: {
            ...DEFAULT_BRUSH_MIXING,
            enabled: true,
            pickupRatePerPx: 10,
            restoreRatePerPx: 0,
            diffusionRatePerPx: 0,
          },
          pressureDynamics: { size: 0, flow: 0 },
        },
      });

      function renderEndPixel(updateDistancePx: number) {
        const source = createLayer(100, 100);
        source.ctx.fillStyle = "rgb(255, 0, 0)";
        source.ctx.fillRect(0, 0, 50, 100);
        source.ctx.fillStyle = "rgb(0, 0, 255)";
        source.ctx.fillRect(50, 0, 50, 100);

        const target = createLayer(100, 100);
        const brush = style.brush;
        if (brush.type !== "stamp") throw new Error("Expected stamp brush");
        const nextStyle = makeStyle({
          ...style,
          brush: {
            ...brush,
            mixing: {
              ...DEFAULT_BRUSH_MIXING,
              enabled: true,
              pickupRatePerPx: 10,
              restoreRatePerPx: 0,
              diffusionRatePerPx: 0,
              updateDistancePx,
            },
          },
        });
        renderBrushStroke(
          target,
          makeLine(25, 50, 75, 50, 20),
          nextStyle,
          0,
          makeInitialState(nextStyle),
          source,
        );
        const pixels = target.ctx.getImageData(60, 45, 16, 11).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          red += pixels[offset] ?? 0;
          green += pixels[offset + 1] ?? 0;
          blue += pixels[offset + 2] ?? 0;
        }
        return { red, green, blue };
      }

      const frequent = renderEndPixel(1);
      const sparse = renderEndPixel(100);

      expect(frequent.blue).toBeGreaterThan(frequent.red);
      expect(sparse.red).toBeGreaterThan(sparse.blue);
    });
  });
});
