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
  clearLayer,
  copyLayerPixels,
  createBrushAccelerator,
  createLayer,
} from "@headless-paint/engine";
import type { FilterPipelineConfig, InputPoint } from "@headless-paint/input";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeHistoryOp } from "./command-executor";
import {
  beginHistoryMutation,
  createHistoryState,
  pushCommand,
} from "./history";
import { createIncrementalStrokeRenderer } from "./incremental-stroke";
import { expectPixelEqual, simulateLiveStroke } from "./parity-helpers";
import { rebuildLayerFromHistory } from "./replay";
import { createStrokeRuntime } from "./stroke-runtime";
import type { HistoryState } from "./types";

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
const THIRD_GPU_POINTS: readonly InputPoint[] = [
  { x: 22, y: 66, pressure: 0.75, timestamp: 200 },
  { x: 54, y: 62, pressure: 0.75, timestamp: 216 },
  { x: 92, y: 68, pressure: 0.75, timestamp: 232 },
];
const CPU_POINTS: readonly InputPoint[] = [
  { x: 20, y: 42, pressure: 0.6, timestamp: 50 },
  { x: 108, y: 42, pressure: 0.6, timestamp: 66 },
];
const LARGE_WIDTH = 1200;
const LARGE_HEIGHT = 1200;
const LARGE_EXPAND: ExpandConfig = {
  levels: [
    {
      mode: "none",
      offset: { x: LARGE_WIDTH / 2, y: LARGE_HEIGHT / 2 },
      angle: 0,
      divisions: 1,
    },
  ],
};
const LARGE_GPU_STYLE: StrokeStyle = {
  color: { r: 225, g: 30, b: 30, a: 255 },
  lineWidth: 48,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  compositeOperation: "source-over",
  brush: {
    type: "stamp",
    tip: { type: "circle", hardness: 0.78 },
    dynamics: {
      ...DEFAULT_BRUSH_DYNAMICS,
      spacing: 0.12,
      spacingSizeCoupling: 1,
      flow: 0.72,
    },
    pressureDynamics: { size: 0.3, flow: 0.4, smoothingMs: 50 },
    mixing: {
      ...DEFAULT_BRUSH_MIXING,
      enabled: true,
      pickupRatePerPx: 0.007,
      restoreRatePerPx: 0.004,
      diffusionRatePerPx: 0.05,
      updateDistancePx: 15,
      checkpointDistancePx: 36,
      fieldColumns: 18,
      fieldRows: 8,
    },
  },
};
const LARGE_HATCH_STROKES: readonly (readonly InputPoint[])[] = [
  createLinePoints(40, 180, 1160, 700, 0),
  createLinePoints(40, 300, 1160, 820, 1_000),
  createLinePoints(40, 420, 1160, 940, 2_000),
  createLinePoints(40, 540, 1160, 1060, 3_000),
];
const LARGE_MULTI_PASS_STROKE: readonly InputPoint[] = createLinePoints(
  20,
  20,
  1180,
  1180,
  10_000,
  13,
);

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
      expect(event.mode).toBe("bitmap");
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

  it("GPU stroke x3 のUndo rebuild後は次のGPU strokeがhitし、常駐無効時とbyte一致する", () => {
    const resident = renderGpuUndoThenStroke(true);
    const uploadAfterRebuild = renderGpuUndoThenStroke(false);

    expect(resident.residencyHits).toEqual([1]);
    expect(resident.gpuUploadCount).toBe(0);
    expect(uploadAfterRebuild.residencyHits).toEqual([0]);
    expect(uploadAfterRebuild.gpuUploadCount).toBe(1);
    expectPixelEqual(
      resident.layer,
      uploadAfterRebuild.layer,
      "Undo rebuild residency vs upload-after-rebuild",
    );
  });

  it.each([
    ["通常", EXPAND, 1],
    ["radial 4 Expand", RADIAL_EXPAND_4, 4],
  ] as const)(
    "%s GPU stroke の cancel は history 復元せず byte 一致し次 stroke も residency hit する",
    (_label, expand, branchCount) => {
      const perf = configurePerf();
      const accelerator = requireAccelerator({ resident: true });
      const layer = createTestLayer();
      const before = createLayer(WIDTH, HEIGHT);
      copyLayerPixels(layer, before);
      const pendingLayer = createLayer(WIDTH, HEIGHT);
      const rebuildSpy = vi.fn(rebuildLayerFromHistory);
      const restoreLayerBeforeStroke = vi.fn((target: Layer) => {
        rebuildSpy(
          target,
          createHistoryState(WIDTH, HEIGHT, { layerCount: 1 }),
        );
      });
      accelerator.warmUp(layer);
      perf.reset();
      const runtime = createStrokeRuntime({
        setTimeout: () => 0,
        clearTimeout: () => {},
        now: () => performance.now(),
        requestRender: () => {},
        onCommit: () => {},
        onDrawingChanged: () => {},
        randomSeed: () => 303,
        accelerator,
        restoreLayerBeforeStroke,
      });

      runtime.start(FIRST_GPU_POINTS[0], {
        layer,
        pendingLayer,
        style: GPU_STYLE,
        filterPipeline: FILTER_PIPELINE,
        expand,
        alphaLocked: false,
        pendingOnly: false,
      });
      runtime.move(FIRST_GPU_POINTS[1]);
      runtime.move(FIRST_GPU_POINTS[2]);
      runtime.cancel();

      expectPixelEqual(layer, before, `${branchCount} branch GPU cancel`);
      expect(restoreLayerBeforeStroke).not.toHaveBeenCalled();
      expect(rebuildSpy).not.toHaveBeenCalled();

      drawStroke(layer, GPU_STYLE, SECOND_GPU_POINTS, 404, expand, accelerator);
      const snapshot = perf.snapshot();
      expect(snapshot.samples.gpuResidencyHit).toEqual([1, 1]);
      expect(snapshot.samples.gpuBranches).toEqual([branchCount, branchCount]);
      expect(snapshot.stages.gpuUpload.count).toBe(0);
      expect(snapshot.stages.gpuBaseCopy.count).toBe(2);
      expect(snapshot.stages.gpuCancelRestore.count).toBe(1);
      runtime.dispose();
      accelerator.dispose();
    },
  );

  it("React Undoボタン順序のcancel→restore→undo→遅延end後もownerを残さず次がhitする", () => {
    const perf = configurePerf();
    perf.experiments.stallThresholdMs = 0;
    const accelerator = requireAccelerator({ resident: true });
    const layer = createTestLayer();
    const pendingLayer = createLayer(WIDTH, HEIGHT);
    let history = createHistoryState(WIDTH, HEIGHT, { layerCount: 1 });
    history = recordStroke(
      history,
      layer,
      GPU_STYLE,
      FIRST_GPU_POINTS,
      101,
      accelerator,
    );
    history = recordStroke(
      history,
      layer,
      GPU_STYLE,
      SECOND_GPU_POINTS,
      202,
      accelerator,
    );

    perf.reset();
    const runtime = createStrokeRuntime({
      setTimeout: () => 0,
      clearTimeout: () => {},
      now: () => performance.now(),
      requestRender: () => {},
      onCommit: () => {},
      onDrawingChanged: () => {},
      randomSeed: () => 303,
      accelerator,
      restoreLayerBeforeStroke: (target) => {
        const result = rebuildLayerFromHistory(target, history, undefined, {
          accelerator,
          invalidationReason: "runtimeRestore",
        });
        expect(result.ok).toBe(true);
      },
    });
    runtime.start(THIRD_GPU_POINTS[0], {
      layer,
      pendingLayer,
      style: GPU_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      alphaLocked: false,
      pendingOnly: false,
    });
    runtime.move(THIRD_GPU_POINTS[1]);

    // usePaintEngine の履歴操作と、遅れて届く pointer end の順序:
    // active cancel → history undo → delayed end → next live stroke。
    runtime.cancel();
    const undoResult = executeHistoryOp("undo", history, {
      layers: [layer],
      accelerator,
    });
    expect(undoResult.ok).toBe(true);
    history = undoResult.next;
    runtime.end();
    drawStroke(layer, GPU_STYLE, THIRD_GPU_POINTS, 404, EXPAND, accelerator);

    const snapshot = perf.snapshot();
    const events = snapshot.stalls.flatMap((stall) => stall.events);
    expect(snapshot.samples.gpuResidencyHit.at(-1)).toBe(1);
    expect(
      events.some(
        (event) =>
          event.name === "residencyInvalidated" &&
          event.reason === "runtimeRestore",
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.name === "residencyInvalidated" &&
          event.reason === "executorUndo",
      ),
    ).toBe(true);
    expect(
      events.filter((event) => event.name === "gpuStaleOwnerRecovered"),
    ).toEqual([]);
    runtime.dispose();
    accelerator.dispose();
  });

  it("strokeStart stallに直前のresidency invalidation reasonを含める", () => {
    const perf = configurePerf();
    perf.experiments.stallThresholdMs = 0;
    const accelerator = requireAccelerator({ resident: true });
    const layer = createTestLayer();
    accelerator.warmUp(layer);
    perf.reset();

    clearLayer(layer);
    drawStroke(layer, GPU_STYLE, FIRST_GPU_POINTS, 101, EXPAND, accelerator);

    const strokeStart = [...perf.snapshot().stalls]
      .reverse()
      .find((stall) => stall.kind === "strokeStart");
    expect(
      strokeStart?.events.some(
        (event) =>
          event.name === "residencyInvalidated" &&
          event.reason === "clearLayer",
      ),
    ).toBe(true);
    accelerator.dispose();
  });

  it("stale owner回復eventに開始経路・開始時刻・回復経路を含める", () => {
    const perf = configurePerf();
    perf.experiments.stallThresholdMs = 0;
    const accelerator = requireAccelerator({ resident: true });
    const layer = createTestLayer();
    const live = createIncrementalStrokeRenderer({
      layer,
      style: GPU_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: 101,
      alphaLocked: false,
      accelerator,
      gpuOwnerLabel: "live",
    });
    const rebuild = createIncrementalStrokeRenderer({
      layer,
      style: GPU_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: 202,
      alphaLocked: false,
      accelerator,
      gpuOwnerLabel: "rebuild",
    });

    const staleEvent = perf
      .snapshot()
      .stalls.flatMap((stall) => stall.events)
      .find((event) => event.name === "gpuStaleOwnerRecovered");
    expect(staleEvent).toMatchObject({
      ownerLabel: "live",
      recoveryOwnerLabel: "rebuild",
    });
    expect(staleEvent?.ownerStartedAtMs).toBeTypeOf("number");
    expect(staleEvent?.ownerAgeMs).toBeGreaterThanOrEqual(0);
    live.cancel();
    rebuild.cancel();
    accelerator.dispose();
  });

  it("GPU→CPU strokeのUndoでcheckpoint復元後のGPU replayを常駐維持する", () => {
    const perf = configurePerf();
    const accelerator = requireAccelerator({ resident: true });
    const layer = createTestLayer();
    let history = createHistoryState(WIDTH, HEIGHT, { layerCount: 1 });
    history = recordStroke(
      history,
      layer,
      GPU_STYLE,
      FIRST_GPU_POINTS,
      101,
      accelerator,
    );
    history = recordStroke(
      history,
      layer,
      CPU_STYLE,
      CPU_POINTS,
      77,
      accelerator,
    );

    const undoResult = executeHistoryOp("undo", history, {
      layers: [layer],
      accelerator,
    });
    expect(undoResult.ok).toBe(true);
    perf.reset();

    drawStroke(layer, GPU_STYLE, SECOND_GPU_POINTS, 303, EXPAND, accelerator);
    const snapshot = perf.snapshot();
    expect(snapshot.samples.gpuResidencyHit).toEqual([1]);
    expect(snapshot.stages.gpuUpload.count).toBe(0);
    accelerator.dispose();
  });

  it("CPU→GPU strokeのUndoでCPU replayが最後なら次のGPU strokeはmissする", () => {
    const perf = configurePerf();
    const accelerator = requireAccelerator({ resident: true });
    const layer = createTestLayer();
    let history = createHistoryState(WIDTH, HEIGHT, { layerCount: 1 });
    history = recordStroke(
      history,
      layer,
      CPU_STYLE,
      CPU_POINTS,
      77,
      accelerator,
    );
    history = recordStroke(
      history,
      layer,
      GPU_STYLE,
      FIRST_GPU_POINTS,
      101,
      accelerator,
    );

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

  it("4本のAcrylic hatchをUndo→RedoしてもUndoなしのlayerとbyte一致する", () => {
    expectHistoryRedoPixelParity(LARGE_HATCH_STROKES);
  });

  it("dirty rectが1024²を超える単一Acrylic strokeのRedoを複数passでbyte一致commitする", () => {
    const transferSpy = vi.spyOn(
      OffscreenCanvas.prototype,
      "transferToImageBitmap",
    );
    try {
      let transfersBeforeRedo = 0;
      expectHistoryRedoPixelParity(
        [LARGE_MULTI_PASS_STROKE],
        () => {
          transfersBeforeRedo = transferSpy.mock.calls.length;
        },
        () => {
          const redoTransfers =
            transferSpy.mock.calls.length - transfersBeforeRedo;
          expect(redoTransfers).toBeGreaterThanOrEqual(2);
        },
      );
    } finally {
      transferSpy.mockRestore();
    }
  });
});

function createLinePoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  timestampBase: number,
  pointCount = 9,
): readonly InputPoint[] {
  return Array.from({ length: pointCount }, (_, index) => {
    const progress = index / (pointCount - 1);
    return {
      x: startX + (endX - startX) * progress,
      y: startY + (endY - startY) * progress,
      pressure: 0.8,
      timestamp: timestampBase + index * 16,
    };
  });
}

function expectHistoryRedoPixelParity(
  strokes: readonly (readonly InputPoint[])[],
  beforeRedo?: () => void,
  afterRedo?: () => void,
): void {
  const expected = createLargeTestLayer();
  const expectedAccelerator = requireAccelerator({ resident: true });
  try {
    for (const [index, points] of strokes.entries()) {
      simulateLiveStroke({
        layer: expected,
        inputPoints: points,
        style: LARGE_GPU_STYLE,
        filterPipeline: FILTER_PIPELINE,
        expand: LARGE_EXPAND,
        brushSeed: 8_000 + index,
        alphaLocked: false,
        accelerator: expectedAccelerator,
      });
    }
  } finally {
    expectedAccelerator.dispose();
  }

  const actual = createLargeTestLayer();
  const accelerator = requireAccelerator({ resident: true });
  try {
    let history = createHistoryState(LARGE_WIDTH, LARGE_HEIGHT, {
      layerCount: 1,
    });
    for (const [index, points] of strokes.entries()) {
      history = beginHistoryMutation(history, {
        affectedLayers: [actual],
        layerCount: 1,
      });
      const { command } = simulateLiveStroke({
        layer: actual,
        inputPoints: points,
        style: LARGE_GPU_STYLE,
        filterPipeline: FILTER_PIPELINE,
        expand: LARGE_EXPAND,
        brushSeed: 8_000 + index,
        alphaLocked: false,
        accelerator,
      });
      history = pushCommand(history, command, {
        afterLayer: actual,
        layerCount: 1,
      });
    }
    expectPixelEqual(actual, expected, "Acrylic before history operation");

    const undoResult = executeHistoryOp("undo", history, {
      layers: [actual],
      accelerator,
    });
    expect(undoResult.ok).toBe(true);
    beforeRedo?.();
    const redoResult = executeHistoryOp("redo", undoResult.next, {
      layers: [actual],
      accelerator,
    });
    expect(redoResult.ok).toBe(true);
    afterRedo?.();
    expectPixelEqual(actual, expected, "Acrylic history redo vs no undo");
  } finally {
    accelerator.dispose();
  }
}

interface SequenceResult {
  readonly layer: Layer;
  readonly residencyHits: readonly number[];
  readonly gpuUploadCount: number;
  readonly samplingCopyPixels: readonly number[];
  readonly gpuBranches: readonly number[];
}

function renderGpuUndoThenStroke(gpuResident: boolean): SequenceResult {
  const perf = configurePerf();
  const accelerator = requireAccelerator({ resident: gpuResident });
  const layer = createTestLayer();
  let history = createHistoryState(WIDTH, HEIGHT, { layerCount: 1 });
  history = recordStroke(
    history,
    layer,
    GPU_STYLE,
    FIRST_GPU_POINTS,
    101,
    accelerator,
  );
  history = recordStroke(
    history,
    layer,
    GPU_STYLE,
    SECOND_GPU_POINTS,
    202,
    accelerator,
  );
  history = recordStroke(
    history,
    layer,
    GPU_STYLE,
    THIRD_GPU_POINTS,
    303,
    accelerator,
  );

  const undoResult = executeHistoryOp("undo", history, {
    layers: [layer],
    accelerator,
  });
  expect(undoResult.ok).toBe(true);
  perf.reset();

  drawStroke(layer, GPU_STYLE, THIRD_GPU_POINTS, 404, EXPAND, accelerator);
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

function recordStroke(
  history: HistoryState,
  layer: Layer,
  style: StrokeStyle,
  points: readonly InputPoint[],
  brushSeed: number,
  accelerator: BrushAccelerator,
): HistoryState {
  const prepared = beginHistoryMutation(history, {
    affectedLayers: [layer],
    layerCount: 1,
  });
  const { command } = simulateLiveStroke({
    layer,
    inputPoints: points,
    style,
    filterPipeline: FILTER_PIPELINE,
    expand: EXPAND,
    brushSeed,
    alphaLocked: false,
    accelerator,
  });
  return pushCommand(prepared, command, {
    afterLayer: layer,
    layerCount: 1,
  });
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

function createLargeTestLayer(): Layer {
  const layer = createLayer(LARGE_WIDTH, LARGE_HEIGHT);
  layer.ctx.fillStyle = "rgb(225, 190, 145)";
  layer.ctx.fillRect(0, 0, LARGE_WIDTH, LARGE_HEIGHT);
  layer.ctx.fillStyle = "rgb(55, 110, 185)";
  layer.ctx.fillRect(0, LARGE_HEIGHT / 2, LARGE_WIDTH, LARGE_HEIGHT / 2);
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
      readonly gpuBaseCopy: { readonly count: number };
      readonly gpuCancelRestore: { readonly count: number };
      readonly samplingLayerCopy: { readonly count: number };
    };
    readonly samples: {
      readonly gpuResidencyHit: readonly number[];
      readonly layerReadPixels: readonly number[];
      readonly samplingCopyPixels: readonly number[];
      readonly gpuBranches: readonly number[];
    };
    readonly stalls: readonly {
      readonly kind: "moveMany" | "strokeStart";
      readonly events: readonly {
        readonly name: string;
        readonly mode?: "bitmap" | "direct";
        readonly width?: number;
        readonly height?: number;
        readonly bitmapMs?: number;
        readonly drawMs?: number;
        readonly reason?: string;
        readonly ownerLabel?: string;
        readonly ownerStartedAtMs?: number;
        readonly ownerAgeMs?: number;
        readonly recoveryOwnerLabel?: string;
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
