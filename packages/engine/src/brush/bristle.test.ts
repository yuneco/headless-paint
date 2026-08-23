import { describe, expect, it } from "vitest";
import { renderBrushStroke } from ".";
import { createLayer } from "../layer";
import type {
  BristleBrushConfig,
  BrushRenderState,
  StrokePoint,
  StrokeStyle,
} from "../types";
import {
  DEFAULT_BRISTLE_DYNAMICS,
  DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
} from "../types";

function makeBrush(
  overrides?: Partial<BristleBrushConfig["dynamics"]>,
): BristleBrushConfig {
  return {
    type: "bristle",
    dynamics: {
      ...DEFAULT_BRISTLE_DYNAMICS,
      surfaceGrain: {
        ...DEFAULT_BRISTLE_DYNAMICS.surfaceGrain,
        amount: 0,
      },
      ...overrides,
    },
    pressureDynamics: DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
  };
}

function makeStyle(brush = makeBrush()): StrokeStyle {
  return {
    color: { r: 37, g: 83, b: 104, a: 255 },
    lineWidth: 40,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush,
  };
}

function initialState(seed = 7): BrushRenderState {
  return {
    tipCanvas: null,
    seed,
    branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
  };
}

function line(pressure: number): readonly StrokePoint[] {
  return [
    { x: 20, y: 60, pressure },
    { x: 60, y: 60, pressure },
    { x: 100, y: 60, pressure },
    { x: 140, y: 60, pressure },
    { x: 180, y: 60, pressure },
  ];
}

function longLine(pressure: number): readonly StrokePoint[] {
  return [20, 210, 400, 590, 780].map((x) => ({ x, y: 60, pressure }));
}

function curve(): readonly StrokePoint[] {
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    return {
      x: 20 + t * 160,
      y: 60 + Math.sin(t * Math.PI * 2) * 30,
      pressure: 0.2 + 0.8 * Math.sin(t * Math.PI) ** 2,
    };
  });
}

function alphaStats(layer: ReturnType<typeof createLayer>): {
  readonly pixels: number;
  readonly sum: number;
  readonly minY: number;
  readonly maxY: number;
} {
  const image = layer.ctx.getImageData(
    0,
    0,
    layer.canvas.width,
    layer.canvas.height,
  );
  let pixels = 0;
  let sum = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const alpha = image.data[(y * image.width + x) * 4 + 3] ?? 0;
      if (alpha === 0) continue;
      pixels++;
      sum += alpha;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { pixels, sum, minY, maxY };
}

describe("bristle brush", () => {
  it("連続sweepで長いストロークを列方向に分断しない", () => {
    const layer = createLayer(200, 120);
    renderBrushStroke(layer, line(1), makeStyle(), 0, initialState());
    const image = layer.ctx.getImageData(0, 0, 200, 120);

    for (let x = 30; x <= 170; x++) {
      let columnHasPaint = false;
      for (let y = 35; y <= 85; y++) {
        if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > 0) {
          columnHasPaint = true;
          break;
        }
      }
      expect(columnHasPaint, `x=${x}`).toBe(true);
    }
  });

  it("筆圧は外形幅をほぼ維持したまま着彩面積を増やす", () => {
    // 面掠れは確率場なので、短い区間だけでは偶然edge側に着彩cellがない
    // seedもあり得る。dropoutLengthを十分に跨ぐ代表区間で、名目上の外形を
    // 縮めずに着彩面積だけが変わることを確認する。
    const low = createLayer(800, 120);
    const high = createLayer(800, 120);
    renderBrushStroke(low, longLine(0.12), makeStyle(), 0, initialState());
    renderBrushStroke(high, longLine(1), makeStyle(), 0, initialState());
    const lowStats = alphaStats(low);
    const highStats = alphaStats(high);

    expect(highStats.sum).toBeGreaterThan(lowStats.sum * 1.35);
    const lowHeight = lowStats.maxY - lowStats.minY;
    const highHeight = highStats.maxY - highStats.minY;
    expect(
      Math.abs(highHeight - lowHeight),
      JSON.stringify({ lowStats, highStats }),
    ).toBeLessThanOrEqual(4);
  });

  it("同じ入力とseedから同じ描画結果を得る", () => {
    const first = createLayer(200, 120);
    const second = createLayer(200, 120);
    renderBrushStroke(first, line(0.55), makeStyle(), 0, initialState(31));
    renderBrushStroke(second, line(0.55), makeStyle(), 0, initialState(31));

    expect(first.ctx.getImageData(0, 0, 200, 120).data).toEqual(
      second.ctx.getImageData(0, 0, 200, 120).data,
    );
  });

  it("incremental chunkとfull replayのcoverageを近似一致させる", () => {
    const points = curve();
    const style = makeStyle();
    const full = createLayer(200, 120);
    renderBrushStroke(full, points, style, 0, initialState(19));

    const incremental = createLayer(200, 120);
    let state = renderBrushStroke(
      incremental,
      points.slice(0, 9),
      style,
      0,
      initialState(19),
    );
    state = renderBrushStroke(
      incremental,
      points.slice(6, 17),
      style,
      3,
      state,
    );
    renderBrushStroke(incremental, points.slice(14), style, 3, state);

    const fullAlpha = full.ctx.getImageData(0, 0, 200, 120).data;
    const incrementalAlpha = incremental.ctx.getImageData(0, 0, 200, 120).data;
    let absoluteError = 0;
    let compared = 0;
    for (let index = 3; index < fullAlpha.length; index += 4) {
      absoluteError += Math.abs(
        (fullAlpha[index] ?? 0) - (incrementalAlpha[index] ?? 0),
      );
      compared++;
    }
    expect(absoluteError / compared).toBeLessThan(6);
  });

  it("反復接触で同じgrainの低着彩部が段階的に埋まる", () => {
    const layer = createLayer(200, 120);
    const brush = makeBrush();
    renderBrushStroke(layer, line(0.5), makeStyle(brush), 0, initialState(23));
    const once = alphaStats(layer).sum;
    renderBrushStroke(layer, line(0.5), makeStyle(brush), 0, initialState(24));
    const twice = alphaStats(layer).sum;

    expect(twice).toBeGreaterThan(once * 1.03);
  });

  it("mixing有効時は描画先と異なるstroke開始snapshotを要求する", () => {
    const layer = createLayer(200, 120);
    const style = makeStyle({
      ...makeBrush(),
      mixing: { ...DEFAULT_BRUSH_MIXING, enabled: true },
    });

    expect(() =>
      renderBrushStroke(layer, line(1), style, 0, initialState()),
    ).toThrow("Bristle mixing requires");
    expect(() =>
      renderBrushStroke(layer, line(1), style, 0, initialState(), layer),
    ).toThrow("Bristle mixing requires");
  });

  it("mixing状態を更新し同一strokeの次区間へ引き継ぐ", () => {
    const source = createLayer(220, 120);
    source.ctx.fillStyle = "rgb(210, 45, 35)";
    source.ctx.fillRect(85, 0, 30, 120);
    const target = createLayer(220, 120);
    target.ctx.drawImage(source.canvas, 0, 0);
    const brush: BristleBrushConfig = {
      ...makeBrush(),
      mixing: {
        ...DEFAULT_BRUSH_MIXING,
        enabled: true,
        updateDistancePx: 10,
        checkpointDistancePx: 20,
      },
    };
    const result = renderBrushStroke(
      target,
      line(1),
      makeStyle(brush),
      0,
      initialState(),
      source,
    );

    const mixing = result.branches[0]?.mixing;
    expect(mixing).toBeDefined();
    expect(mixing?.lastUpdateDistance).toBeGreaterThan(0);
    expect(mixing?.checkpointCanvas).toBeDefined();
  });
});
