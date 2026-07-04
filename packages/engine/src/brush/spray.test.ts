import { describe, expect, it } from "vitest";
import { renderBrushStroke } from ".";
import { compileExpand } from "../expand";
import {
  appendToCommittedLayer,
  renderPendingLayer,
} from "../incremental-render";
import { createLayer } from "../layer";
import type {
  BrushRenderState,
  Color,
  SprayBrushConfig,
  StrokePoint,
  StrokeStyle,
} from "../types";
import {
  DEFAULT_PRESSURE_CURVE,
  DEFAULT_RADIAL_DISTRIBUTION,
  DEFAULT_SPRAY_DYNAMICS,
  DEFAULT_SPRAY_PRESSURE_DYNAMICS,
  ROUND_PEN,
  SPRAY_MAX_PARTICLES_PER_EMISSION,
} from "../types";
import { generateBrushTip } from "./tip";

const BLACK: Color = { r: 0, g: 0, b: 0, a: 255 };

function makeSprayBrush(
  overrides?: Partial<SprayBrushConfig["dynamics"]>,
  pressureOverrides?: Partial<SprayBrushConfig["pressureDynamics"]>,
): SprayBrushConfig {
  return {
    type: "spray",
    particle: { type: "circle", hardness: 1 },
    dynamics: {
      ...DEFAULT_SPRAY_DYNAMICS,
      spacing: 1,
      density: 8,
      particleSize: 2,
      flow: 1,
      radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
      ...overrides,
    },
    pressureDynamics: {
      ...DEFAULT_SPRAY_PRESSURE_DYNAMICS,
      size: 0,
      flow: 0,
      density: 0,
      ...pressureOverrides,
    },
  };
}

function makeStyle(
  brush = makeSprayBrush(),
  overrides?: Partial<StrokeStyle>,
): StrokeStyle {
  return {
    color: BLACK,
    lineWidth: 64,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush,
    ...overrides,
  };
}

function makeInitialState(style: StrokeStyle, seed = 42): BrushRenderState {
  if (style.brush.type !== "spray") {
    return { tipCanvas: null, seed, branches: [] };
  }
  const tipScale = style.brush.dynamics.sizeJitterMode === "lognormal" ? 4 : 1;
  return {
    tipCanvas: generateBrushTip(
      style.brush.particle,
      Math.ceil(style.brush.dynamics.particleSize * tipScale),
      style.color,
    ),
    seed,
    branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
  };
}

function makeLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  count: number,
  pressure = 0.5,
): StrokePoint[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    return {
      x: x1 + (x2 - x1) * t,
      y: y1 + (y2 - y1) * t,
      pressure,
    };
  });
}

function alphaPixels(layer: ReturnType<typeof createLayer>): number {
  const data = layer.ctx.getImageData(0, 0, layer.width, layer.height).data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) count++;
  }
  return count;
}

function pixels(layer: ReturnType<typeof createLayer>): Uint8ClampedArray {
  return layer.ctx.getImageData(0, 0, layer.width, layer.height).data;
}

function countDrawImages(
  layer: ReturnType<typeof createLayer>,
  onDraw?: (x: number, y: number) => void,
): () => number {
  let count = 0;
  const original = layer.ctx.drawImage.bind(layer.ctx);
  (
    layer.ctx as OffscreenCanvasRenderingContext2D & {
      drawImage: OffscreenCanvasRenderingContext2D["drawImage"];
    }
  ).drawImage = ((...args: unknown[]) => {
    count++;
    if (
      typeof args[1] === "number" &&
      typeof args[2] === "number" &&
      typeof args[3] === "number" &&
      typeof args[4] === "number"
    ) {
      onDraw?.(args[1] + args[3] / 2, args[2] + args[4] / 2);
    }
    original(
      ...(args as Parameters<OffscreenCanvasRenderingContext2D["drawImage"]>),
    );
  }) as OffscreenCanvasRenderingContext2D["drawImage"];
  return () => count;
}

function countCentersInCircle(
  centers: readonly { readonly x: number; readonly y: number }[],
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
): number {
  const inner2 = innerRadius * innerRadius;
  const outer2 = outerRadius * outerRadius;
  let count = 0;
  for (const center of centers) {
    const dx = center.x - cx;
    const dy = center.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= inner2 && d2 < outer2) count++;
  }
  return count;
}

describe("spray brush", () => {
  it("決定論性: チャンク分割描画と一括描画のピクセルが一致する", () => {
    const brush = makeSprayBrush({ spacing: 0.25, density: 6 });
    const style = makeStyle(brush, { lineWidth: 48 });
    const points = makeLine(30, 100, 170, 100, 5);

    const fullLayer = createLayer(220, 200);
    renderBrushStroke(fullLayer, points, style, 0, makeInitialState(style));

    const chunkLayer = createLayer(220, 200);
    let state = makeInitialState(style);
    state = renderBrushStroke(chunkLayer, points.slice(0, 3), style, 0, state);
    renderBrushStroke(chunkLayer, points.slice(2), style, 1, state);

    expect(pixels(chunkLayer)).toEqual(pixels(fullLayer));
  });

  it("粒子数が散布半径の面積におおむね比例する", () => {
    const brush = makeSprayBrush({
      density: 10,
      particleSize: 1,
      particleSizeJitter: 0,
      opacityJitter: 0,
    });
    const smallStyle = makeStyle(brush, { lineWidth: 40 });
    const largeStyle = makeStyle(brush, { lineWidth: 80 });
    const point = [{ x: 120, y: 120, pressure: 0.5 }];

    const smallLayer = createLayer(240, 240);
    renderBrushStroke(
      smallLayer,
      point,
      smallStyle,
      0,
      makeInitialState(smallStyle),
    );

    const largeLayer = createLayer(240, 240);
    renderBrushStroke(
      largeLayer,
      point,
      largeStyle,
      0,
      makeInitialState(largeStyle),
    );

    const ratio = alphaPixels(largeLayer) / alphaPixels(smallLayer);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5);
  });

  it("pressureDynamics.density = 1 では低筆圧の粒子数が減る", () => {
    const brush = makeSprayBrush(
      {
        density: 20,
        particleSize: 1,
        particleSizeJitter: 0,
        opacityJitter: 0,
      },
      { density: 1 },
    );
    const style = makeStyle(brush, { lineWidth: 70 });

    const lowLayer = createLayer(220, 220);
    renderBrushStroke(
      lowLayer,
      [{ x: 110, y: 110, pressure: 0.25 }],
      style,
      0,
      makeInitialState(style),
    );

    const highLayer = createLayer(220, 220);
    renderBrushStroke(
      highLayer,
      [{ x: 110, y: 110, pressure: 1 }],
      style,
      0,
      makeInitialState(style),
    );

    expect(alphaPixels(lowLayer)).toBeLessThan(alphaPixels(highLayer) * 0.45);
  });

  it("radialDistribution の恒等カーブは面積あたり密度をほぼ一様にする", () => {
    const brush = makeSprayBrush({
      density: 20,
      particleSize: 1,
      particleSizeJitter: 0,
      opacityJitter: 0,
      radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
    });
    const style = makeStyle(brush, { lineWidth: 180 });
    const layer = createLayer(240, 240);
    const centers: { x: number; y: number }[] = [];
    countDrawImages(layer, (x, y) => {
      centers.push({ x, y });
    });

    renderBrushStroke(
      layer,
      [{ x: 120, y: 120, pressure: 0.5 }],
      style,
      0,
      makeInitialState(style),
    );

    const inner = countCentersInCircle(centers, 120, 120, 0, 45);
    const outer = countCentersInCircle(centers, 120, 120, 45, 90);
    const innerDensity = inner / (Math.PI * 45 * 45);
    const outerDensity = outer / (Math.PI * (90 * 90 - 45 * 45));

    expect(innerDensity / outerDensity).toBeGreaterThan(0.6);
    expect(innerDensity / outerDensity).toBeLessThan(1.6);
  });

  it("radialDistribution の中央寄せ密度プロファイルは中心密度を上げる", () => {
    const brush = makeSprayBrush({
      density: 20,
      particleSize: 1,
      particleSizeJitter: 0,
      opacityJitter: 0,
      radialDistribution: {
        startY: 1,
        control1: { x: 0.2, y: 1 },
        control2: { x: 0.8, y: 0 },
        endY: 0,
      },
    });
    const style = makeStyle(brush, { lineWidth: 180 });
    const layer = createLayer(240, 240);
    const centers: { x: number; y: number }[] = [];
    countDrawImages(layer, (x, y) => {
      centers.push({ x, y });
    });

    renderBrushStroke(
      layer,
      [{ x: 120, y: 120, pressure: 0.5 }],
      style,
      0,
      makeInitialState(style),
    );

    const inner = countCentersInCircle(centers, 120, 120, 0, 45);
    const outer = countCentersInCircle(centers, 120, 120, 45, 90);
    const innerDensity = inner / (Math.PI * 45 * 45);
    const outerDensity = outer / (Math.PI * (90 * 90 - 45 * 45));

    expect(innerDensity / outerDensity).toBeGreaterThan(1.5);
  });

  it("radialDistribution のリング状密度プロファイルは中間リングを最密にする", () => {
    const brush = makeSprayBrush({
      density: 20,
      particleSize: 1,
      particleSizeJitter: 0,
      opacityJitter: 0,
      radialDistribution: {
        startY: 0,
        control1: { x: 0.35, y: 1 },
        control2: { x: 0.65, y: 1 },
        endY: 0,
      },
    });
    const style = makeStyle(brush, { lineWidth: 180 });
    const layer = createLayer(240, 240);
    const centers: { x: number; y: number }[] = [];
    countDrawImages(layer, (x, y) => {
      centers.push({ x, y });
    });

    renderBrushStroke(
      layer,
      [{ x: 120, y: 120, pressure: 0.5 }],
      style,
      0,
      makeInitialState(style),
    );

    const inner = countCentersInCircle(centers, 120, 120, 0, 30);
    const middle = countCentersInCircle(centers, 120, 120, 30, 60);
    const outer = countCentersInCircle(centers, 120, 120, 60, 90);
    const innerDensity = inner / (Math.PI * 30 * 30);
    const middleDensity = middle / (Math.PI * (60 * 60 - 30 * 30));
    const outerDensity = outer / (Math.PI * (90 * 90 - 60 * 60));

    expect(middleDensity).toBeGreaterThan(innerDensity * 1.3);
    expect(middleDensity).toBeGreaterThan(outerDensity * 1.3);
  });

  it("radialDistribution の全ゼロ密度は一様円盤へフォールバックする", () => {
    const brush = makeSprayBrush({
      density: 20,
      particleSize: 1,
      particleSizeJitter: 0,
      opacityJitter: 0,
      radialDistribution: {
        startY: 0,
        control1: { x: 1 / 3, y: 0 },
        control2: { x: 2 / 3, y: 0 },
        endY: 0,
      },
    });
    const style = makeStyle(brush, { lineWidth: 180 });
    const layer = createLayer(240, 240);
    const centers: { x: number; y: number }[] = [];
    countDrawImages(layer, (x, y) => {
      centers.push({ x, y });
    });

    renderBrushStroke(
      layer,
      [{ x: 120, y: 120, pressure: 0.5 }],
      style,
      0,
      makeInitialState(style),
    );

    const inner = countCentersInCircle(centers, 120, 120, 0, 45);
    const outer = countCentersInCircle(centers, 120, 120, 45, 90);
    const innerDensity = inner / (Math.PI * 45 * 45);
    const outerDensity = outer / (Math.PI * (90 * 90 - 45 * 45));

    expect(innerDensity / outerDensity).toBeGreaterThan(0.6);
    expect(innerDensity / outerDensity).toBeLessThan(1.6);
  });

  it.each(["lognormal", "bimodal"] as const)(
    "sizeJitterMode=%s は同seedで決定論性を保つ",
    (sizeJitterMode) => {
      const brush = makeSprayBrush({
        density: 10,
        particleSize: 2,
        particleSizeJitter: 0.8,
        sizeJitterMode,
        opacityJitter: 0.4,
      });
      const style = makeStyle(brush, { lineWidth: 90 });
      const points = makeLine(40, 100, 160, 100, 5);

      const firstLayer = createLayer(220, 200);
      renderBrushStroke(
        firstLayer,
        points,
        style,
        0,
        makeInitialState(style, 123),
      );

      const secondLayer = createLayer(220, 200);
      renderBrushStroke(
        secondLayer,
        points,
        style,
        0,
        makeInitialState(style, 123),
      );

      expect(pixels(secondLayer)).toEqual(pixels(firstLayer));
    },
  );

  it("極端なパラメータでは粒子数を SPRAY_MAX_PARTICLES_PER_EMISSION にクランプする", () => {
    const brush = makeSprayBrush({ density: 10000, particleSize: 1 });
    const style = makeStyle(brush, { lineWidth: 200 });
    const layer = createLayer(300, 300);
    const getDrawCount = countDrawImages(layer);

    renderBrushStroke(
      layer,
      [{ x: 150, y: 150, pressure: 1 }],
      style,
      0,
      makeInitialState(style),
    );

    expect(getDrawCount()).toBe(SPRAY_MAX_PARTICLES_PER_EMISSION);
  });

  it("同じ state から pending を2回再描画しても結果が二重化しない", () => {
    const brush = makeSprayBrush({ spacing: 0.25, density: 8 });
    const style = makeStyle(brush, { lineWidth: 48 });
    const committedLayer = createLayer(220, 180);
    const pendingLayer = createLayer(220, 180);
    const compiled = compileExpand({
      levels: [
        { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 2 },
      ],
    });
    const initialState = makeInitialState(style);
    const committedState = appendToCommittedLayer(
      committedLayer,
      makeLine(20, 90, 80, 90, 3),
      style,
      compiled,
      0,
      initialState,
    );
    const pendingPoints = makeLine(80, 90, 180, 90, 4);

    renderPendingLayer(
      pendingLayer,
      pendingPoints,
      style,
      compiled,
      committedState,
    );
    const once = pixels(pendingLayer).slice();
    renderPendingLayer(
      pendingLayer,
      pendingPoints,
      style,
      compiled,
      committedState,
    );

    expect(pixels(pendingLayer)).toEqual(once);
  });

  it("radial Expand の branch ごとに同数の粒子を描画する", () => {
    const lineWidth = 40;
    const radius = lineWidth / 2;
    const targetParticles = 100;
    const density = (targetParticles * 1000) / (Math.PI * radius * radius);
    const brush = makeSprayBrush({
      density,
      particleSize: 1,
      particleSizeJitter: 0,
      opacityJitter: 0,
    });
    const style = makeStyle(brush, { lineWidth });
    const layer = createLayer(220, 220);
    const branchCounts = [0, 0, 0, 0];
    const centers = [
      { x: 160, y: 110 },
      { x: 110, y: 160 },
      { x: 60, y: 110 },
      { x: 110, y: 60 },
    ];
    countDrawImages(layer, (x, y) => {
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < centers.length; i++) {
        const dx = x - centers[i].x;
        const dy = y - centers[i].y;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }
      branchCounts[nearestIndex]++;
    });

    appendToCommittedLayer(
      layer,
      [{ x: 160, y: 110, pressure: 0.5 }],
      style,
      compileExpand({
        levels: [
          {
            mode: "radial",
            offset: { x: 110, y: 110 },
            angle: 0,
            divisions: 4,
          },
        ],
      }),
      0,
      makeInitialState(style),
    );

    expect(branchCounts).toEqual([
      targetParticles,
      targetParticles,
      targetParticles,
      targetParticles,
    ]);
  });

  it("round-pen では spray state を要求しない", () => {
    const layer = createLayer(50, 50);
    const result = renderBrushStroke(
      layer,
      [{ x: 10, y: 10, pressure: 0.5 }],
      makeStyle(makeSprayBrush(), { brush: ROUND_PEN }),
    );
    expect(result.tipCanvas).toBeNull();
  });
});
