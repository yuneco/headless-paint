import type { ExpandConfig, Layer, StrokeStyle } from "@headless-paint/engine";
import {
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  ROUND_PEN,
  createLayer,
} from "@headless-paint/engine";
import type { FilterPipelineConfig, InputPoint } from "@headless-paint/input";
import { afterEach, describe, expect, it } from "vitest";
import { executeHistoryOp } from "./command-executor";
import {
  beginHistoryMutation,
  createHistoryState,
  pushCommand,
} from "./history";
import { createIncrementalStrokeRenderer } from "./incremental-stroke";
import { expectPixelEqual, simulateLiveStroke } from "./parity-helpers";

const WIDTH = 128;
const HEIGHT = 80;
const FILTER_PIPELINE: FilterPipelineConfig = {
  filters: [{ type: "causal-adaptive", config: {} }],
};
const EXPAND: ExpandConfig = {
  levels: [
    {
      mode: "none",
      offset: { x: WIDTH / 2, y: HEIGHT / 2 },
      angle: 0,
      divisions: 1,
    },
  ],
};
const GPU_STYLE: StrokeStyle = {
  color: { r: 245, g: 245, b: 245, a: 255 },
  lineWidth: 20,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  compositeOperation: "source-over",
  brush: {
    type: "stamp",
    tip: { type: "circle", hardness: 1 },
    dynamics: {
      ...DEFAULT_BRUSH_DYNAMICS,
      spacing: 0.25,
      flow: 1,
      emissionsPerSecond: 0,
    },
    pressureDynamics: { size: 0, flow: 0 },
    mixing: {
      ...DEFAULT_BRUSH_MIXING,
      enabled: true,
      pickupRatePerPx: 0.8,
      restoreRatePerPx: 0.02,
      diffusionRatePerPx: 0,
      updateDistancePx: 1,
      checkpointDistancePx: 8,
    },
  },
};
const CPU_STYLE: StrokeStyle = {
  color: { r: 20, g: 210, b: 90, a: 255 },
  lineWidth: 8,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  compositeOperation: "source-over",
  brush: ROUND_PEN,
};
const FIRST_GPU_POINTS: readonly InputPoint[] = [
  { x: 18, y: 24, pressure: 0.7, timestamp: 0 },
  { x: 48, y: 28, pressure: 0.7, timestamp: 16 },
  { x: 74, y: 22, pressure: 0.7, timestamp: 32 },
];
const SECOND_GPU_POINTS: readonly InputPoint[] = [
  { x: 54, y: 58, pressure: 0.8, timestamp: 100 },
  { x: 84, y: 52, pressure: 0.8, timestamp: 116 },
  { x: 112, y: 58, pressure: 0.8, timestamp: 132 },
];
const CPU_POINTS: readonly InputPoint[] = [
  { x: 20, y: 42, pressure: 0.6, timestamp: 50 },
  { x: 108, y: 42, pressure: 0.6, timestamp: 66 },
];

afterEach(() => {
  const perf = getPerf();
  perf.enabled = false;
  perf.experiments.gpuDab = "off";
  perf.experiments.gpuResident = true;
  perf.reset();
});

describe("GPU layer residency", () => {
  it("連続する2本目のGPU strokeでuploadを省略し、毎回uploadとpixel一致する", () => {
    const resident = renderSequence(true, false);
    const uploadEveryStroke = renderSequence(false, false);

    expect(resident.residencyHits).toEqual([0, 1]);
    expect(resident.gpuUploadCount).toBe(1);
    expect(resident.samplingCopyPixels).toEqual([WIDTH * HEIGHT]);
    expect(uploadEveryStroke.residencyHits).toEqual([0, 0]);
    expect(uploadEveryStroke.gpuUploadCount).toBe(2);
    expect(uploadEveryStroke.samplingCopyPixels).toEqual([
      WIDTH * HEIGHT,
      WIDTH * HEIGHT,
    ]);
    expectPixelEqual(
      resident.layer,
      uploadEveryStroke.layer,
      "resident vs upload-every-stroke",
    );
  });

  it("間のCPU strokeで無効化し、次のGPU strokeを再uploadしてpixel一致する", () => {
    const resident = renderSequence(true, true);
    const uploadEveryStroke = renderSequence(false, true);

    expect(resident.residencyHits).toEqual([0, 0]);
    expect(resident.gpuUploadCount).toBe(2);
    expectPixelEqual(
      resident.layer,
      uploadEveryStroke.layer,
      "CPU invalidation vs upload-every-stroke",
    );
  });

  it("Undoのhistory rebuild後は無効化され、次のGPU strokeでuploadする", () => {
    const perf = configurePerf(true);
    const layer = createTestLayer();
    let history = createHistoryState(WIDTH, HEIGHT, { layerCount: 1 });
    history = beginHistoryMutation(history, { affectedLayers: [layer] });
    const first = simulateLiveStroke({
      layer,
      inputPoints: FIRST_GPU_POINTS,
      style: GPU_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: 101,
      alphaLocked: false,
    });
    history = pushCommand(history, first.command, {
      afterLayer: layer,
      layerCount: 1,
    });
    history = beginHistoryMutation(history, { affectedLayers: [layer] });
    const second = simulateLiveStroke({
      layer,
      inputPoints: SECOND_GPU_POINTS,
      style: GPU_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: 202,
      alphaLocked: false,
    });
    history = pushCommand(history, second.command, {
      afterLayer: layer,
      layerCount: 1,
    });

    const undoResult = executeHistoryOp("undo", history, { layers: [layer] });
    expect(undoResult.ok).toBe(true);
    perf.reset();

    drawStroke(layer, GPU_STYLE, SECOND_GPU_POINTS, 303);
    const snapshot = perf.snapshot();
    expect(snapshot.samples.gpuResidencyHit).toEqual([0]);
    expect(snapshot.stages.gpuUpload.count).toBe(1);
  });
});

interface SequenceResult {
  readonly layer: Layer;
  readonly residencyHits: readonly number[];
  readonly gpuUploadCount: number;
  readonly samplingCopyPixels: readonly number[];
}

function renderSequence(
  gpuResident: boolean,
  includeCpuStroke: boolean,
): SequenceResult {
  const perf = configurePerf(gpuResident);
  const layer = createTestLayer();
  drawStroke(layer, GPU_STYLE, FIRST_GPU_POINTS, 101);
  if (includeCpuStroke) drawStroke(layer, CPU_STYLE, CPU_POINTS, 77);
  drawStroke(layer, GPU_STYLE, SECOND_GPU_POINTS, 202);
  const snapshot = perf.snapshot();
  return {
    layer,
    residencyHits: snapshot.samples.gpuResidencyHit,
    gpuUploadCount: snapshot.stages.gpuUpload.count,
    samplingCopyPixels: snapshot.samples.samplingCopyPixels,
  };
}

function drawStroke(
  layer: Layer,
  style: StrokeStyle,
  points: readonly InputPoint[],
  brushSeed: number,
): void {
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style,
    filterPipeline: FILTER_PIPELINE,
    expand: EXPAND,
    brushSeed,
    alphaLocked: false,
  });
  renderer.feedMany(points);
  renderer.finalize();
}

function createTestLayer(): Layer {
  const layer = createLayer(WIDTH, HEIGHT);
  layer.ctx.fillStyle = "rgb(225, 55, 45)";
  layer.ctx.fillRect(0, 0, WIDTH / 2, HEIGHT);
  layer.ctx.fillStyle = "rgb(35, 80, 225)";
  layer.ctx.fillRect(WIDTH / 2, 0, WIDTH / 2, HEIGHT);
  return layer;
}

function configurePerf(gpuResident: boolean): BrushPerfTestBridge {
  const perf = getPerf();
  perf.enabled = true;
  perf.reset();
  perf.experiments.gpuDab = "webgl2";
  perf.experiments.gpuResident = gpuResident;
  return perf;
}

interface BrushPerfTestBridge {
  enabled: boolean;
  readonly experiments: {
    gpuDab: "off" | "webgl2";
    gpuResident: boolean;
  };
  reset(): void;
  snapshot(): {
    readonly stages: {
      readonly gpuUpload: { readonly count: number };
    };
    readonly samples: {
      readonly gpuResidencyHit: readonly number[];
      readonly samplingCopyPixels: readonly number[];
    };
  };
}

function getPerf(): BrushPerfTestBridge {
  const perf = (
    globalThis as typeof globalThis & {
      __hpBrushPerf?: BrushPerfTestBridge;
    }
  ).__hpBrushPerf;
  if (!perf) throw new Error("Brush perf debug bridge is unavailable");
  return perf;
}
