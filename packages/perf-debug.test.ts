import { afterEach, describe, expect, it } from "vitest";
import { rasterizeBristleMask } from "./engine/src/brush/bristle-mask";
import { renderBrushStroke } from "./engine/src/brush/index";
import { advanceMaterialField } from "./engine/src/brush/material-field";
import { prepareMixingState } from "./engine/src/brush/mixing";
import { brushPerfDebug } from "./engine/src/brush/perf-debug";
import { generateBrushTip } from "./engine/src/brush/tip";
import { createLayer } from "./engine/src/layer";
import type { BrushRenderState, StrokeStyle } from "./engine/src/types";
import {
  DEFAULT_BRISTLE_DYNAMICS,
  DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
} from "./engine/src/types";
import { createIncrementalStrokeRenderer } from "./stroke/src/incremental-stroke";

afterEach(() => {
  brushPerfDebug.enabled = false;
  brushPerfDebug.experiments.fusedInk = false;
  for (const name of Object.keys(brushPerfDebug.nullStages) as Array<
    keyof typeof brushPerfDebug.nullStages
  >) {
    brushPerfDebug.nullStages[name] = false;
  }
  brushPerfDebug.reset();
});

describe("brush perf null stages", () => {
  it("Rough の field / contact / raster / drawSweep を独立に置換する", () => {
    brushPerfDebug.enabled = true;
    const baselineField = maskCoverage();
    brushPerfDebug.nullStages.nullField = true;
    const nullField = maskCoverage();
    expect(nullField).toBeGreaterThan(baselineField);

    brushPerfDebug.nullStages.nullField = true;
    const baselineContact = maskCoverage(true);
    brushPerfDebug.nullStages.nullContact = true;
    const nullContact = maskCoverage(true);
    expect(nullContact).toBeGreaterThan(baselineContact);

    brushPerfDebug.nullStages.nullRaster = true;
    expect(maskCoverage(true)).toBe(0);

    brushPerfDebug.nullStages.nullRaster = false;
    brushPerfDebug.nullStages.nullContact = true;
    const normalSweep = renderBristleCoverage(false);
    const nullSweep = renderBristleCoverage(true);
    expect(nullSweep).toBeGreaterThan(normalSweep);
    expect(brushPerfDebug.snapshot().stages.drawSweep.count).toBe(2);
  });

  it("Acrylic の checkpoint / field advance / upload を置換する", () => {
    brushPerfDebug.enabled = true;
    const style = acrylicStyle();
    const source = createLayer(100, 60);
    source.ctx.fillStyle = "rgb(0, 255, 0)";
    source.ctx.fillRect(0, 0, source.width, source.height);

    const baseline = renderAcrylicField(style, source);
    brushPerfDebug.nullStages.nullCheckpoint = true;
    const nullCheckpoint = renderAcrylicField(style, source);
    expect(sumChannel(baseline, 1)).toBeGreaterThan(
      sumChannel(nullCheckpoint, 1),
    );

    const field = new Float32Array([10, 20, 30, 255]);
    const sampled = new Uint8ClampedArray([200, 180, 160, 255]);
    brushPerfDebug.nullStages.nullCheckpoint = false;
    const advanced = advanceMaterialField(
      field,
      sampled,
      1,
      1,
      { r: 10, g: 20, b: 30, a: 255 },
      {
        pickupRatePerPx: 1,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        distancePx: 1,
      },
    );
    brushPerfDebug.nullStages.nullFieldAdvance = true;
    expect(
      advanceMaterialField(
        field,
        sampled,
        1,
        1,
        { r: 10, g: 20, b: 30, a: 255 },
        {
          pickupRatePerPx: 1,
          restoreRatePerPx: 0,
          diffusionRatePerPx: 0,
          distancePx: 1,
        },
      ),
    ).toBe(field);
    expect(advanced).not.toEqual(field);

    const tip = generateBrushTip(
      { type: "circle", hardness: 1 },
      20,
      style.color,
    );
    brushPerfDebug.nullStages.nullFieldAdvance = false;
    const uploaded = prepareMixingState(
      tip,
      style.color,
      style.brush.type === "stamp" && style.brush.mixing
        ? style.brush.mixing
        : DEFAULT_BRUSH_MIXING,
      undefined,
    );
    brushPerfDebug.nullStages.nullMaterialUpload = true;
    const skipped = prepareMixingState(
      tip,
      style.color,
      style.brush.type === "stamp" && style.brush.mixing
        ? style.brush.mixing
        : DEFAULT_BRUSH_MIXING,
      undefined,
    );
    expect(centerAlpha(uploaded.renderCanvas)).toBeGreaterThan(0);
    expect(centerAlpha(skipped.renderCanvas)).toBe(0);
  });

  it("nullFullCopy は sampling copy を 0 pixel にして same-canvas を局所 bypass する", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.nullStages.nullFullCopy = true;
    const layer = createLayer(100, 60);
    const style = acrylicStyle();
    const renderer = createIncrementalStrokeRenderer({
      layer,
      style,
      filterPipeline: { filters: [{ type: "causal-adaptive", config: {} }] },
      expand: {
        levels: [
          {
            mode: "none",
            offset: { x: 50, y: 30 },
            angle: 0,
            divisions: 1,
          },
        ],
      },
      brushSeed: 7,
      alphaLocked: false,
    });
    expect(brushPerfDebug.snapshot().samples.samplingCopyPixels).toEqual([0]);
    expect(() => {
      renderer.feedMany([
        { x: 20, y: 30, pressure: 0.6, timestamp: 0 },
        { x: 50, y: 30, pressure: 0.6, timestamp: 16 },
        { x: 80, y: 30, pressure: 0.6, timestamp: 32 },
      ]);
      renderer.finalize();
    }).not.toThrow();
  });
});

function maskCoverage(withSurfaceGrain = false): number {
  const dynamics = {
    ...DEFAULT_BRISTLE_DYNAMICS,
    surfaceGrain: {
      ...DEFAULT_BRISTLE_DYNAMICS.surfaceGrain,
      amount: withSurfaceGrain ? 1 : 0,
      hardness: 1,
    },
  };
  const mask = rasterizeBristleMask(
    [
      {
        x: 10,
        y: 30,
        pressure: withSurfaceGrain ? 0.05 : 0.5,
        distance: 0,
        frameX: 1,
        frameY: 0,
      },
      {
        x: 110,
        y: 30,
        pressure: withSurfaceGrain ? 0.05 : 0.5,
        distance: 100,
        frameX: 1,
        frameY: 0,
      },
    ],
    40,
    dynamics,
    1,
    11,
    0,
    0,
    120,
    60,
  );
  return alphaCoverage(mask);
}

function renderBristleCoverage(nullDrawSweep: boolean): number {
  brushPerfDebug.nullStages.nullDrawSweep = nullDrawSweep;
  const layer = createLayer(160, 80);
  const style: StrokeStyle = {
    color: { r: 30, g: 60, b: 90, a: 255 },
    lineWidth: 30,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush: {
      type: "bristle",
      dynamics: {
        ...DEFAULT_BRISTLE_DYNAMICS,
        surfaceGrain: { ...DEFAULT_BRISTLE_DYNAMICS.surfaceGrain, amount: 0 },
      },
      pressureDynamics: DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
    },
  };
  renderBrushStroke(
    layer,
    [
      { x: 20, y: 40, pressure: 0.6 },
      { x: 80, y: 40, pressure: 0.6 },
      { x: 140, y: 40, pressure: 0.6 },
    ],
    style,
    0,
    initialBristleState(),
  );
  return alphaCoverage(layer.canvas);
}

function acrylicStyle(): StrokeStyle {
  return {
    color: { r: 10, g: 20, b: 200, a: 255 },
    lineWidth: 16,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush: {
      type: "stamp",
      tip: { type: "circle", hardness: 1 },
      dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.1 },
      pressureDynamics: { size: 0, flow: 0 },
      mixing: {
        ...DEFAULT_BRUSH_MIXING,
        enabled: true,
        pickupRatePerPx: 10,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        updateDistancePx: 1,
        checkpointDistancePx: 20,
      },
    },
  };
}

function renderAcrylicField(
  style: StrokeStyle,
  source: ReturnType<typeof createLayer>,
): Float32Array {
  const target = createLayer(source.width, source.height);
  const tip = generateBrushTip(
    { type: "circle", hardness: 1 },
    Math.ceil(style.lineWidth * 2),
    style.color,
  );
  const state: BrushRenderState = {
    tipCanvas: tip,
    seed: 7,
    branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
  };
  const result = renderBrushStroke(
    target,
    Array.from({ length: 20 }, (_, index) => ({
      x: 20 + index * 3,
      y: 30,
      pressure: 0.7,
    })),
    style,
    0,
    state,
    source,
  );
  const field = result.branches[0]?.mixing?.field;
  if (!field) throw new Error("Expected an Acrylic material field");
  return field;
}

function initialBristleState(): BrushRenderState {
  return {
    tipCanvas: null,
    seed: 7,
    branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
  };
}

function alphaCoverage(canvas: OffscreenCanvas): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let total = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    total += pixels[offset] ?? 0;
  }
  return total;
}

function centerAlpha(canvas: OffscreenCanvas): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  return (
    ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3] ?? 0
  );
}

function sumChannel(field: Float32Array, channel: number): number {
  let sum = 0;
  for (let offset = channel; offset < field.length; offset += 4) {
    sum += field[offset] ?? 0;
  }
  return sum;
}
