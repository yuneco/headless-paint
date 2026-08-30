import type {
  BrushAccelerator,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import {
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  ROUND_PEN,
  createBrushAccelerator,
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
const RADIAL_EXPAND_4: ExpandConfig = {
  levels: [
    {
      mode: "radial",
      offset: { x: WIDTH / 2, y: HEIGHT / 2 },
      angle: 0,
      divisions: 4,
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
  perf.experiments.stallThresholdMs = 60;
  perf.reset();
});

describe("GPU layer residency", () => {
  it("筆圧で stampSize が変化しても snapshot array を stroke 中に再確保しない", () => {
    const perf = configurePerf();
    perf.experiments.stallThresholdMs = 0;
    const accelerator = requireAccelerator({ resident: false });
    const layer = createTestLayer();
    const gpuBrush = GPU_STYLE.brush;
    if (gpuBrush.type !== "stamp") throw new Error("Expected stamp brush");
    const style: StrokeStyle = {
      ...GPU_STYLE,
      brush: {
        ...gpuBrush,
        dynamics: { ...gpuBrush.dynamics, spacing: 0.1 },
        pressureDynamics: { size: 1, flow: 0 },
        mixing: {
          ...(gpuBrush.mixing ?? DEFAULT_BRUSH_MIXING),
          checkpointDistancePx: 4,
        },
      },
    };
    const points = Array.from({ length: 12 }, (_, index) => ({
      x: 12 + index * 9,
      y: 40,
      pressure: index % 2 === 0 ? 0.1 : 1,
      timestamp: index * 16,
    }));
    const renderer = createIncrementalStrokeRenderer({
      layer,
      style,
      filterPipeline: { filters: [] },
      expand: EXPAND,
      brushSeed: 404,
      alphaLocked: false,
      accelerator,
    });

    perf.beginBatch(points.length, 1);
    try {
      renderer.feedMany(points);
      renderer.finalize();
    } finally {
      perf.endBatch();
      accelerator.dispose();
    }

    const events = perf.snapshot().stalls.flatMap((stall) => stall.events);
    const snapshotReallocations = events.filter(
      (event) => event.name === "realloc:snapshotArray",
    );
    expect(snapshotReallocations.length).toBeLessThanOrEqual(1);
    for (const event of snapshotReallocations) {
      expect((event.width ?? 0) % 32).toBe(0);
      expect(event.width).toBe(event.height);
    }
    const commitEvents = events.filter((event) => event.name === "gpuCommit");
    expect(commitEvents.length).toBeGreaterThan(0);
    for (const event of commitEvents) {
      expect(event.bitmapMs).toBeTypeOf("number");
      expect(event.drawMs).toBeTypeOf("number");
    }
  });

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

  it("residency hit の通常 stroke は layer pixel を読み出さない", () => {
    const accelerator = requireAccelerator({ resident: true });
    const layer = createTestLayer();
    accelerator.warmUp(layer);
    const perf = configurePerf();

    simulateLiveStroke({
      layer,
      inputPoints: FIRST_GPU_POINTS,
      style: GPU_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: 101,
      alphaLocked: false,
      accelerator,
    });

    const snapshot = perf.snapshot();
    expect(snapshot.samples.gpuResidencyHit).toEqual([1]);
    expect(snapshot.stages.samplingLayerCopy.count).toBe(0);
    expect(snapshot.samples.samplingCopyPixels).toEqual([]);
    expect(snapshot.samples.layerReadPixels).toEqual([]);
    accelerator.dispose();
  });

  it("radial 4 Expand と併用して連続する2本目が residency hit する", () => {
    const resident = renderSequence(true, false, RADIAL_EXPAND_4);
    const uploadEveryStroke = renderSequence(false, false, RADIAL_EXPAND_4);

    expect(resident.residencyHits).toEqual([0, 1]);
    expect(resident.gpuBranches).toEqual([4, 4]);
    expect(resident.gpuUploadCount).toBe(1);
    expectPixelEqual(
      resident.layer,
      uploadEveryStroke.layer,
      "radial 4 resident vs upload-every-stroke",
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
    const perf = configurePerf();
    const accelerator = requireAccelerator({ resident: true });
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
      accelerator,
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
      accelerator,
    });
    history = pushCommand(history, second.command, {
      afterLayer: layer,
      layerCount: 1,
    });

    const undoResult = executeHistoryOp("undo", history, {
      layers: [layer],
      accelerator,
    });
    expect(undoResult.ok).toBe(true);
    perf.reset();

    drawStroke(layer, GPU_STYLE, SECOND_GPU_POINTS, 303, EXPAND, accelerator);
    const snapshot = perf.snapshot();
    expect(snapshot.samples.gpuResidencyHit).toEqual([0]);
    expect(snapshot.stages.gpuUpload.count).toBe(1);
    accelerator.dispose();
  });
});

interface SequenceResult {
  readonly layer: Layer;
  readonly residencyHits: readonly number[];
  readonly gpuUploadCount: number;
  readonly samplingCopyPixels: readonly number[];
  readonly gpuBranches: readonly number[];
}

function renderSequence(
  gpuResident: boolean,
  includeCpuStroke: boolean,
  expand: ExpandConfig = EXPAND,
): SequenceResult {
  const perf = configurePerf();
  const accelerator = requireAccelerator({ resident: gpuResident });
  const layer = createTestLayer();
  drawStroke(layer, GPU_STYLE, FIRST_GPU_POINTS, 101, expand, accelerator);
  if (includeCpuStroke) {
    drawStroke(layer, CPU_STYLE, CPU_POINTS, 77, EXPAND, accelerator);
  }
  drawStroke(layer, GPU_STYLE, SECOND_GPU_POINTS, 202, expand, accelerator);
  const snapshot = perf.snapshot();
  const result = {
    layer,
    residencyHits: snapshot.samples.gpuResidencyHit,
    gpuUploadCount: snapshot.stages.gpuUpload.count,
    samplingCopyPixels: snapshot.samples.samplingCopyPixels,
    gpuBranches: snapshot.samples.gpuBranches,
  };
  accelerator.dispose();
  return result;
}

function drawStroke(
  layer: Layer,
  style: StrokeStyle,
  points: readonly InputPoint[],
  brushSeed: number,
  expand: ExpandConfig = EXPAND,
  accelerator?: BrushAccelerator | null,
): void {
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style,
    filterPipeline: FILTER_PIPELINE,
    expand,
    brushSeed,
    alphaLocked: false,
    accelerator,
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

function configurePerf(): BrushPerfTestBridge {
  const perf = getPerf();
  perf.enabled = true;
  perf.reset();
  return perf;
}

interface BrushPerfTestBridge {
  enabled: boolean;
  readonly experiments: {
    stallThresholdMs: number;
  };
  beginBatch(pointCount: number, branchCount: number): void;
  endBatch(): void;
  reset(): void;
  snapshot(): {
    readonly stages: {
      readonly gpuUpload: { readonly count: number };
      readonly samplingLayerCopy: { readonly count: number };
    };
    readonly samples: {
      readonly gpuResidencyHit: readonly number[];
      readonly layerReadPixels: readonly number[];
      readonly samplingCopyPixels: readonly number[];
      readonly gpuBranches: readonly number[];
    };
    readonly stalls: readonly {
      readonly events: readonly {
        readonly name: string;
        readonly width?: number;
        readonly height?: number;
        readonly bitmapMs?: number;
        readonly drawMs?: number;
      }[];
    }[];
  };
}

function requireAccelerator(options: {
  readonly resident: boolean;
}): BrushAccelerator {
  const accelerator = createBrushAccelerator({
    backend: "webgl2",
    resident: options.resident,
  });
  if (!accelerator) throw new Error("WebGL2 accelerator is unavailable");
  return accelerator;
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
