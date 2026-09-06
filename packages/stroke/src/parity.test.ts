import type {
  BrushAccelerator,
  BrushRenderState,
  Color,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import {
  AIRBRUSH,
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  DEFAULT_RADIAL_DISTRIBUTION,
  DEFAULT_SPRAY_DYNAMICS,
  DEFAULT_SPRAY_PRESSURE_DYNAMICS,
  ROUGH_BRISTLE,
  ROUND_PEN,
  SPRAY_AIRBRUSH,
  clearLayer,
  copyLayerPixels,
  createBrushAccelerator,
  createLayer,
} from "@headless-paint/engine";
import type { FilterPipelineConfig, InputPoint } from "@headless-paint/input";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeHistoryOp } from "./command-executor";
import { getGpuUndoRuntime } from "./gpu-undo-cache";
import {
  beginHistoryMutation,
  createHistoryState,
  pushCommand,
  redo,
  undo,
} from "./history";
import { createIncrementalStrokeRenderer } from "./incremental-stroke";
import {
  expectPixelEqual,
  replayOnLayer,
  simulateLiveStroke,
} from "./parity-helpers";
import { rebuildLayerFromHistory } from "./replay";
import { createStrokeRuntime } from "./stroke-runtime";
import type { HistoryConfig, HistoryState } from "./types";

const WIDTH = 180;
const HEIGHT = 140;
const LAYER_ID = "parity-layer";
const BRUSH_SEED = 0x5eed_1234;
const HISTORY_CONFIG: HistoryConfig = {
  checkpointInterval: 10,
  maxCheckpoints: 10,
  checkpointCompression: "none",
};
const FILTER_PIPELINE: FilterPipelineConfig = {
  filters: [{ type: "smoothing", config: { windowSize: 3 } }],
};
const CAUSAL_FILTER_PIPELINE: FilterPipelineConfig = {
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
const RADIAL_EXPAND_2: ExpandConfig = {
  levels: [
    {
      mode: "radial",
      offset: { x: WIDTH / 2, y: HEIGHT / 2 },
      angle: 0,
      divisions: 2,
    },
  ],
};
const RADIAL_EXPAND_64: ExpandConfig = {
  levels: [
    {
      mode: "radial",
      offset: { x: WIDTH / 2, y: HEIGHT / 2 },
      angle: 0,
      divisions: 64,
    },
  ],
};
const RADIAL_EXPAND_65: ExpandConfig = {
  levels: [
    {
      mode: "radial",
      offset: { x: WIDTH / 2, y: HEIGHT / 2 },
      angle: 0,
      divisions: 65,
    },
  ],
};
const BLACK: Color = { r: 0, g: 0, b: 0, a: 255 };
const RED: Color = { r: 225, g: 30, b: 30, a: 255 };
const GREEN: Color = { r: 30, g: 185, b: 90, a: 255 };
const BLUE: Color = { r: 35, g: 95, b: 235, a: 255 };
const WHITE: Color = { r: 255, g: 255, b: 255, a: 255 };

afterEach(() => {
  const perf = getBrushPerfTestBridge();
  if (!perf) return;
  perf.enabled = false;
  perf.reset();
});

const INPUT_POINTS: readonly InputPoint[] = [
  { x: 24, y: 70, pressure: 0.25, timestamp: 10_000 },
  { x: 44, y: 66, pressure: 0.5, timestamp: 10_016 },
  { x: 64, y: 74, pressure: 0.78, timestamp: 10_032 },
  { x: 64, y: 74, pressure: 0.78, timestamp: 10_112 },
  { x: 88, y: 82, pressure: 0.35, timestamp: 10_128 },
  { x: 116, y: 69, pressure: 0.92, timestamp: 10_144 },
  { x: 116, y: 69, pressure: 0.92, timestamp: 10_224 },
  { x: 146, y: 86, pressure: 0.56, timestamp: 10_240 },
];
const CENTER_CROSSING_INPUT_POINTS: readonly InputPoint[] = [
  { x: 28, y: 70, pressure: 0.75, timestamp: 20_000 },
  { x: 54, y: 70, pressure: 0.75, timestamp: 20_016 },
  { x: 78, y: 70, pressure: 0.75, timestamp: 20_032 },
  { x: 102, y: 70, pressure: 0.75, timestamp: 20_048 },
  { x: 128, y: 70, pressure: 0.75, timestamp: 20_064 },
  { x: 152, y: 70, pressure: 0.75, timestamp: 20_080 },
];

interface ParityCase {
  readonly name: string;
  readonly style: StrokeStyle;
  readonly alphaLocked: boolean;
  readonly paintBase?: (layer: Layer) => void;
  readonly filterPipeline?: FilterPipelineConfig;
}

const STAMP_MIXING_STYLE = makeStyle({
  color: WHITE,
  lineWidth: 26,
  brush: {
    type: "stamp",
    tip: { type: "circle", hardness: 1 },
    dynamics: {
      ...DEFAULT_BRUSH_DYNAMICS,
      spacing: 0.35,
      flow: 1,
      emissionsPerSecond: 30,
    },
    pressureDynamics: { size: 0.2, flow: 0 },
    mixing: {
      ...DEFAULT_BRUSH_MIXING,
      enabled: true,
      pickupRatePerPx: 10,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
      updateDistancePx: 1,
      checkpointDistancePx: 12,
    },
  },
});
const FIELD_TRACE_STYLE = makeStyle({
  color: WHITE,
  lineWidth: 18,
  brush: {
    type: "stamp",
    tip: { type: "circle", hardness: 1 },
    dynamics: {
      ...DEFAULT_BRUSH_DYNAMICS,
      spacing: 0.22,
      flow: 1,
      emissionsPerSecond: 0,
    },
    pressureDynamics: { size: 0, flow: 0 },
    mixing: {
      ...DEFAULT_BRUSH_MIXING,
      enabled: true,
      pickupRatePerPx: 0.18,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
      updateDistancePx: 1,
      checkpointDistancePx: 4,
    },
  },
});
const ROUGH_MIXING_STYLE = makeStyle({
  color: WHITE,
  lineWidth: 34,
  brush: {
    ...ROUGH_BRISTLE,
    mixing: {
      ...DEFAULT_BRUSH_MIXING,
      enabled: true,
      updateDistancePx: 4,
      checkpointDistancePx: 8,
    },
  },
});

const FIELD_TRACE_INPUT_POINTS: readonly InputPoint[] = Array.from(
  { length: 101 },
  (_, index) => {
    const angle = index * 0.25;
    return {
      x: WIDTH / 2 + Math.cos(angle) * 4,
      y: HEIGHT / 2 + Math.sin(angle) * 4,
      pressure: 1,
      timestamp: 30_000 + index * 16,
    };
  },
);

const cases: readonly ParityCase[] = [
  {
    name: "round-pen basic",
    style: makeStyle({
      color: BLACK,
      lineWidth: 12,
      brush: { ...ROUND_PEN, pressureDynamics: { size: 1, flow: 0 } },
    }),
    alphaLocked: false,
  },
  {
    name: "round-pen eraser",
    style: makeStyle({
      color: BLACK,
      lineWidth: 18,
      compositeOperation: "destination-out",
      brush: { ...ROUND_PEN, pressureDynamics: { size: 0.5, flow: 0 } },
    }),
    alphaLocked: false,
    paintBase: paintOpaqueBands,
  },
  {
    name: "round-pen alpha lock",
    style: makeStyle({
      color: GREEN,
      lineWidth: 22,
      brush: { ...ROUND_PEN, pressureDynamics: { size: 1, flow: 0 } },
    }),
    alphaLocked: true,
    paintBase: paintAlphaLockBase,
  },
  {
    name: "stamp jitter",
    style: makeStyle({
      color: RED,
      lineWidth: 24,
      brush: {
        ...AIRBRUSH,
        dynamics: {
          ...AIRBRUSH.dynamics,
          spacing: 0.22,
          opacityJitter: 0.32,
          sizeJitter: 0.45,
          rotationJitter: 0.2,
          scatter: 0.35,
          flow: 0.65,
          emissionsPerSecond: 30,
        },
        pressureDynamics: { size: 0.45, flow: 0.35 },
      },
    }),
    alphaLocked: false,
  },
  {
    name: "stamp mixing",
    style: STAMP_MIXING_STYLE,
    alphaLocked: false,
    paintBase: paintOpaqueBands,
  },
  {
    name: "rough bristle mixing",
    style: makeStyle({
      color: WHITE,
      lineWidth: 34,
      brush: ROUGH_BRISTLE,
    }),
    alphaLocked: false,
    paintBase: paintOpaqueBands,
    filterPipeline: CAUSAL_FILTER_PIPELINE,
  },
  {
    name: "spray lognormal",
    style: makeStyle({
      color: BLUE,
      lineWidth: 36,
      brush: {
        ...SPRAY_AIRBRUSH,
        dynamics: {
          ...DEFAULT_SPRAY_DYNAMICS,
          spacing: 0.24,
          density: 4,
          particleSize: 2,
          particleSizeJitter: 0.42,
          sizeJitterMode: "lognormal",
          opacityJitter: 0.28,
          flow: 0.42,
          radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
          emissionsPerSecond: 30,
        },
        pressureDynamics: {
          ...DEFAULT_SPRAY_PRESSURE_DYNAMICS,
          size: 0.3,
          flow: 0.8,
          density: 0.45,
        },
      },
    }),
    alphaLocked: false,
  },
  {
    name: "spray bimodal",
    style: makeStyle({
      color: BLACK,
      lineWidth: 34,
      brush: {
        ...SPRAY_AIRBRUSH,
        dynamics: {
          ...SPRAY_AIRBRUSH.dynamics,
          spacing: 0.2,
          density: 4,
          particleSize: 2,
          particleSizeJitter: 0.36,
          sizeJitterMode: "bimodal",
          opacityJitter: 0.24,
          flow: 0.38,
          emissionsPerSecond: 30,
        },
        pressureDynamics: {
          ...SPRAY_AIRBRUSH.pressureDynamics,
          size: 0.25,
          flow: 0.75,
          density: 0.5,
        },
      },
    }),
    alphaLocked: false,
  },
];

describe("live-vs-replay parity", () => {
  for (const parityCase of cases) {
    it(`${parityCase.name}: live vs replay`, () => {
      const { liveLayer, replayLayer } = runParityCase(parityCase);
      expectPixelEqual(
        replayLayer,
        liveLayer,
        `${parityCase.name} live vs replay`,
      );
    });

    it(`${parityCase.name}: undo rebuild matches pre-stroke pixels`, () => {
      const { beforeLayer, history } = runParityCase(parityCase);
      const undoneState = undo(history);
      const undoLayer = createTestLayer(parityCase.alphaLocked);
      const undoResult = rebuildLayerFromHistory(undoLayer, undoneState);
      expect(undoResult.ok).toBe(true);
      expectPixelEqual(
        undoLayer,
        beforeLayer,
        `${parityCase.name} undo rebuild vs pre-stroke`,
      );
    });

    it(`${parityCase.name}: redo rebuild matches replay`, () => {
      const { replayLayer, history } = runParityCase(parityCase);
      const undoneState = undo(history);
      const redoneState = redo(undoneState);
      const redoLayer = createTestLayer(parityCase.alphaLocked);
      const redoResult = rebuildLayerFromHistory(redoLayer, redoneState);
      expect(redoResult.ok).toBe(true);
      expectPixelEqual(
        redoLayer,
        replayLayer,
        `${parityCase.name} redo rebuild vs replay`,
      );
    });
  }
});

describe("GPU mixing feedMany parity", () => {
  it("複数 batch と replay 相当の単一 batch が byte-identical", () => {
    const perf = getBrushPerfTestBridge();
    if (!perf) throw new Error("Brush perf debug bridge is unavailable");
    perf.enabled = true;
    perf.reset();
    const splitLayer = renderGpuMixingBatches([
      INPUT_POINTS.slice(0, 2),
      INPUT_POINTS.slice(2, 5),
      INPUT_POINTS.slice(5),
    ]);
    const replayLayer = renderGpuMixingBatches([INPUT_POINTS]);

    expectPixelEqual(
      splitLayer,
      replayLayer,
      "GPU mixing split feedMany vs replay feedMany",
    );
    const stages = perf.snapshot().stages;
    expect(stages.gpuFlush.count).toBeGreaterThan(0);
    expect(stages.gpuFieldUpdate.count).toBeGreaterThan(0);
    expect(stages.checkpointReadback.count).toBe(0);
  });
});

describe("GPU undo-1 cache byte parity", () => {
  const cases = [
    {
      name: "stamp replay",
      style: STAMP_MIXING_STYLE,
      expand: EXPAND,
      interval: 10,
      compression: "none",
    },
    {
      name: "stamp radial checkpoint",
      style: STAMP_MIXING_STYLE,
      expand: RADIAL_EXPAND_4,
      interval: 1,
      compression: "fast",
    },
    {
      name: "rough replay",
      style: ROUGH_MIXING_STYLE,
      expand: RADIAL_EXPAND_4,
      interval: 10,
      compression: "none",
    },
    {
      name: "rough checkpoint",
      style: ROUGH_MIXING_STYLE,
      expand: EXPAND,
      interval: 1,
      compression: "none",
    },
  ] as const;

  for (const fixture of cases) {
    it.each(["transparent", "opaque", "translucent"])(
      `${fixture.name}: %s hit, next stroke, branch and deep undo match rebuild byte-for-byte`,
      (substrate) => {
        const accelerator = createTestAccelerator();
        const referenceAccelerator = createTestAccelerator();
        const runtime = getGpuUndoRuntime(accelerator);
        if (!runtime) throw new Error("Missing GPU undo runtime");
        const restore = vi.spyOn(runtime, "restoreUndoSnapshot");
        const actual = createTestLayer();
        const expected = createTestLayer();
        const config: HistoryConfig = {
          ...HISTORY_CONFIG,
          checkpointInterval: fixture.interval,
          checkpointCompression: fixture.compression,
        };
        if (substrate === "opaque") paintOpaqueBands(actual);
        if (substrate === "translucent") {
          const pixels = actual.ctx.createImageData(WIDTH, HEIGHT);
          for (let offset = 0; offset < pixels.data.length; offset += 4) {
            pixels.data.set([31, 119, 237, 1 + ((offset / 4) % 254)], offset);
          }
          actual.ctx.putImageData(pixels, 0, 0);
        }
        let history = createHistoryState(WIDTH, HEIGHT, { layerCount: 1 });
        const draw = (layer: Layer, gpu: BrushAccelerator, seed: number) =>
          simulateLiveStroke({
            layer,
            accelerator: gpu,
            inputPoints: INPUT_POINTS,
            style: fixture.style,
            expand: fixture.expand,
            filterPipeline: CAUSAL_FILTER_PIPELINE,
            brushSeed: seed,
            alphaLocked: false,
          }).command;
        const compareRebuild = (state: HistoryState, label: string) => {
          expect(
            rebuildLayerFromHistory(expected, state, undefined, {
              accelerator: referenceAccelerator,
            }).ok,
          ).toBe(true);
          expectPixelEqual(
            actual,
            expected,
            `${fixture.name} ${substrate} ${label}`,
          );
        };
        try {
          for (let index = 0; index < 3; index++) {
            history = beginHistoryMutation(
              history,
              { affectedLayers: [actual] },
              config,
            );
            const command = draw(actual, accelerator, BRUSH_SEED + index);
            history = pushCommand(
              history,
              command,
              { afterLayer: actual },
              config,
            );
          }
          const result = executeHistoryOp("undo", history, {
            layers: [actual],
            accelerator,
          });
          expect(result.ok).toBe(true);
          expect(restore).toHaveLastReturnedWith(true);
          compareRebuild(result.next, "hit undo");

          // Both start from the same visible pixels; only actual keeps GPU accum.
          const forkBase = beginHistoryMutation(
            result.next,
            { affectedLayers: [actual] },
            config,
          );
          const forkCommand = draw(actual, accelerator, BRUSH_SEED + 99);
          draw(expected, referenceAccelerator, BRUSH_SEED + 99);
          expectPixelEqual(
            actual,
            expected,
            "stroke after hit vs stroke after rebuild",
          );
          const fork = pushCommand(
            forkBase,
            forkCommand,
            { afterLayer: actual },
            config,
          );
          expect(fork.currentIndex).toBe(history.currentIndex);
          expect(fork.commands).not.toBe(history.commands);
          const forkUndo = executeHistoryOp("undo", fork, {
            layers: [actual],
            accelerator,
          });
          expect(forkUndo.ok).toBe(true);
          expect(restore).toHaveLastReturnedWith(true);
          compareRebuild(forkUndo.next, "fork undo");

          const deepUndo = executeHistoryOp("undo", forkUndo.next, {
            layers: [actual],
            accelerator,
          });
          expect(deepUndo.ok).toBe(true);
          expect(restore).toHaveLastReturnedWith(false);
          compareRebuild(deepUndo.next, "deep undo fallback");
          const redone = executeHistoryOp("redo", deepUndo.next, {
            layers: [actual],
            accelerator,
          });
          expect(redone.ok).toBe(true);
          compareRebuild(redone.next, "redo fallback");
        } finally {
          accelerator.dispose();
          referenceAccelerator.dispose();
        }
      },
    );
  }
});

describe("GPU rough bristle parity", () => {
  it("Rough mixing ON の CPU/GPU が Tier B parity を満たす", () => {
    const cpuLayer = renderRoughMixing("cpu");
    const gpuLayer = renderRoughMixing("webgl2");
    const metrics = measureTierB(cpuLayer, gpuLayer);

    console.info("Rough mixing CPU/GPU Tier B", metrics);
    expect(metrics.alphaMae).toBeLessThanOrEqual(0.015);
    expect(metrics.rgbMae).toBeLessThanOrEqual(0.02);
    expect(metrics.largeDeltaRate).toBeLessThanOrEqual(0.01);
  });

  it("CPU perFlush mixing の live/replay/undo/redo が byte-identical", () => {
    expectRoughMixingHistoryParity(null, "CPU perFlush rough");
  });

  it("GPU perFlush mixing の live/replay/undo/redo が byte-identical", () => {
    const accelerator = createTestAccelerator();
    try {
      expectRoughMixingHistoryParity(accelerator, "GPU perFlush rough");
    } finally {
      accelerator.dispose();
    }
  });

  it("mixing OFF の live/replay/undo/redo が同一 backend 内で byte-identical", () => {
    const perf = getBrushPerfTestBridge();
    if (!perf) throw new Error("Brush perf debug bridge is unavailable");
    perf.enabled = true;
    perf.reset();
    const accelerator = createTestAccelerator();
    const style = makeStyle({
      color: { r: 205, g: 55, b: 25, a: 255 },
      lineWidth: 30,
      brush: ROUGH_BRISTLE,
    });
    const baseLayer = createTestLayer();
    const liveLayer = createTestLayer();
    copyLayerPixels(baseLayer, liveLayer);
    let history = createHistoryState(WIDTH, HEIGHT, { layerCount: 1 });
    history = beginHistoryMutation(
      history,
      { affectedLayers: [liveLayer], layerCount: 1 },
      HISTORY_CONFIG,
    );
    const { command } = simulateLiveStroke({
      layer: liveLayer,
      inputPoints: INPUT_POINTS,
      style,
      filterPipeline: CAUSAL_FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: BRUSH_SEED,
      alphaLocked: false,
      accelerator,
    });
    expect(perf.snapshot().stages.gpuCommit.count).toBeGreaterThan(1);
    perf.reset();
    const replayLayer = createTestLayer();
    replayOnLayer(command, replayLayer, baseLayer, accelerator);
    expect(perf.snapshot().stages.gpuCommit.count).toBe(1);
    expectPixelEqual(liveLayer, replayLayer, "GPU rough live vs replay");

    history = pushCommand(
      history,
      command,
      { afterLayer: liveLayer, layerCount: 1 },
      HISTORY_CONFIG,
    );
    const undoLayer = createTestLayer();
    const undoResult = rebuildLayerFromHistory(
      undoLayer,
      undo(history),
      undefined,
      { accelerator },
    );
    expect(undoResult.ok).toBe(true);
    expectPixelEqual(undoLayer, baseLayer, "GPU rough undo");

    perf.reset();
    const redoLayer = createTestLayer();
    const redoResult = rebuildLayerFromHistory(
      redoLayer,
      redo(undo(history)),
      undefined,
      { accelerator },
    );
    expect(redoResult.ok).toBe(true);
    expect(perf.snapshot().stages.gpuCommit.count).toBe(1);
    expectPixelEqual(redoLayer, replayLayer, "GPU rough redo");
    accelerator.dispose();
  });
});

describe("GPU mixing lifecycle fallback", () => {
  it("runtimeはWEBGL_lose_context後にhistory復元してCPUで全入力を再実行する", async () => {
    const expected = createTestLayer();
    paintOpaqueBands(expected);
    const expectedRenderer = createIncrementalStrokeRenderer({
      layer: expected,
      style: STAMP_MIXING_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: BRUSH_SEED,
      alphaLocked: false,
      accelerator: null,
    });
    expectedRenderer.feedMany(INPUT_POINTS);
    expectedRenderer.finalize();

    const perf = getBrushPerfTestBridge();
    if (!perf) throw new Error("Brush perf debug bridge is unavailable");
    perf.enabled = true;
    perf.reset();
    const accelerator = createTestAccelerator();
    const actual = createTestLayer();
    paintOpaqueBands(actual);
    accelerator.warmUp(actual);
    perf.reset();
    const runtime = createHistoryBackedGpuRuntime(actual, accelerator);
    startRuntimeStroke(runtime, actual);
    runtime.moveMany(INPUT_POINTS.slice(1, 3));

    const surface = getActiveSurfaceForTest(accelerator);
    const gl = surface.canvas.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("WEBGL_lose_context is unavailable");
    const contextLost = new Promise<void>((resolve) => {
      surface.canvas.addEventListener(
        "webglcontextlost",
        (event) => {
          event.preventDefault();
          resolve();
        },
        { once: true },
      );
    });
    extension.loseContext();
    await contextLost;

    runtime.moveMany(INPUT_POINTS.slice(3));
    runtime.end();
    expectPixelEqual(actual, expected, "context loss CPU recovery");
    expect(perf.snapshot().samples.gpuResidencyHit).toEqual([1]);

    const nextExpected = createTestLayer();
    copyLayerPixels(actual, nextExpected);
    const nextActual = createTestLayer();
    copyLayerPixels(actual, nextActual);
    perf.reset();
    renderStrokeForLifecycle(nextExpected, null);
    renderStrokeForLifecycle(nextActual, accelerator);
    expectPixelEqual(nextActual, nextExpected, "post-loss CPU fallback");
    expect(perf.snapshot().samples.gpuBranches).toEqual([]);
    accelerator.dispose();
  });

  it("GPU stroke の cancel 中に context lost なら従来の layer 復元へ fallback する", async () => {
    const accelerator = createTestAccelerator();
    const actual = createTestLayer();
    paintOpaqueBands(actual);
    const before = createTestLayer();
    copyLayerPixels(actual, before);
    accelerator.warmUp(actual);
    const restoreLayerBeforeStroke = vi.fn((target: Layer) => {
      copyLayerPixels(before, target);
    });
    const runtime = createStrokeRuntime({
      setTimeout: () => 0,
      clearTimeout: () => {},
      now: () => INPUT_POINTS[0]?.timestamp ?? 0,
      requestRender: () => {},
      onCommit: () => {},
      onDrawingChanged: () => {},
      randomSeed: () => BRUSH_SEED,
      accelerator,
      restoreLayerBeforeStroke,
    });
    startRuntimeStroke(runtime, actual);
    runtime.moveMany(INPUT_POINTS.slice(1, 3));

    const surface = getActiveSurfaceForTest(accelerator);
    const gl = surface.canvas.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("WEBGL_lose_context is unavailable");
    const contextLost = new Promise<void>((resolve) => {
      surface.canvas.addEventListener(
        "webglcontextlost",
        (event) => {
          event.preventDefault();
          resolve();
        },
        { once: true },
      );
    });
    extension.loseContext();
    await contextLost;

    runtime.cancel();

    expect(restoreLayerBeforeStroke).toHaveBeenCalledOnce();
    expectPixelEqual(actual, before, "context loss cancel fallback");
    runtime.dispose();
    accelerator.dispose();
  });

  it("runtimeはstroke途中のaccelerator dispose後にhistory復元してCPUで全入力を再実行する", () => {
    const expected = createTestLayer();
    paintOpaqueBands(expected);
    const expectedRenderer = createIncrementalStrokeRenderer({
      layer: expected,
      style: STAMP_MIXING_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: BRUSH_SEED,
      alphaLocked: false,
      accelerator: null,
    });
    expectedRenderer.feedMany(INPUT_POINTS);
    expectedRenderer.finalize();

    const accelerator = createTestAccelerator();
    const actual = createTestLayer();
    paintOpaqueBands(actual);
    accelerator.warmUp(actual);
    const runtime = createHistoryBackedGpuRuntime(actual, accelerator);
    startRuntimeStroke(runtime, actual);
    runtime.moveMany(INPUT_POINTS.slice(1, 3));
    accelerator.dispose();
    runtime.moveMany(INPUT_POINTS.slice(3));
    runtime.end();

    expectPixelEqual(actual, expected, "active dispose CPU recovery");
  });

  it("incremental renderer直接利用は復元せず現在layer上でCPU全入力を再描画する", () => {
    const accelerator = createTestAccelerator();
    const actual = createTestLayer();
    paintOpaqueBands(actual);
    accelerator.warmUp(actual);
    const renderer = createIncrementalStrokeRenderer({
      layer: actual,
      style: STAMP_MIXING_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: BRUSH_SEED,
      alphaLocked: false,
      accelerator,
    });
    renderer.feedMany(INPUT_POINTS.slice(0, 3));

    const expected = createTestLayer();
    copyLayerPixels(actual, expected);
    const cpuRenderer = createIncrementalStrokeRenderer({
      layer: expected,
      style: STAMP_MIXING_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: EXPAND,
      brushSeed: BRUSH_SEED,
      alphaLocked: false,
      accelerator: null,
    });
    cpuRenderer.feedMany(INPUT_POINTS);
    cpuRenderer.finalize();

    accelerator.dispose();
    renderer.feedMany(INPUT_POINTS.slice(3));
    renderer.finalize();

    expectPixelEqual(actual, expected, "low-level CPU redraw without restore");
  });

  it("dispose済みacceleratorはstroke全体をCPU経路で描く", () => {
    const expected = createTestLayer();
    paintOpaqueBands(expected);
    const actual = createTestLayer();
    paintOpaqueBands(actual);
    const accelerator = createTestAccelerator();
    accelerator.dispose();

    renderStrokeForLifecycle(expected, null);
    renderStrokeForLifecycle(actual, accelerator);

    expectPixelEqual(actual, expected, "disposed accelerator CPU fallback");
  });
});

describe("GPU mixing Expand parity", () => {
  it("radial 2 の branch field が 5 update ごとに CPU と一致する", () => {
    const cpuSnapshots = traceRadialFieldUpdates("cpu");
    const gpuSnapshots = traceRadialFieldUpdates("webgl2");

    expect(gpuSnapshots.map(snapshotKey)).toEqual(
      cpuSnapshots.map(snapshotKey),
    );
    for (let index = 0; index < cpuSnapshots.length; index++) {
      const cpu = cpuSnapshots[index];
      const gpu = gpuSnapshots[index];
      if (!cpu || !gpu) continue;
      const mae = materialFieldMae(cpu.pixels, gpu.pixels);
      expect(
        mae,
        `branch ${cpu.branchIndex} update ${cpu.updateCount}`,
      ).toBeLessThanOrEqual(4 / 255);
    }
  });

  it("radial 4 の中心重なり fixture が CPU と Tier B alpha parity を満たす", () => {
    const cpuLayer = renderGpuExpandBatches("cpu", [
      CENTER_CROSSING_INPUT_POINTS,
    ]);
    const perf = getBrushPerfTestBridge();
    if (!perf) throw new Error("Brush perf debug bridge is unavailable");
    perf.reset();
    const gpuLayer = renderGpuExpandBatches("webgl2", [
      CENTER_CROSSING_INPUT_POINTS,
    ]);

    expectAlphaTierB(cpuLayer, gpuLayer);
    const snapshot = perf.snapshot();
    expect(snapshot.samples.gpuBranches).toEqual([4]);
    expect(snapshot.stages.gpuFieldUpdate.count).toBe(15);
    expect(snapshot.stages.checkpointReadback.count).toBe(0);
  });

  it("radial 4 の live 分割 batch と replay 相当単一 batch が byte-identical", () => {
    const splitLayer = renderGpuExpandBatches("webgl2", [
      CENTER_CROSSING_INPUT_POINTS.slice(0, 2),
      CENTER_CROSSING_INPUT_POINTS.slice(2, 4),
      CENTER_CROSSING_INPUT_POINTS.slice(4),
    ]);
    const replayLayer = renderGpuExpandBatches("webgl2", [
      CENTER_CROSSING_INPUT_POINTS,
    ]);

    expectPixelEqual(
      splitLayer,
      replayLayer,
      "GPU radial 4 split feedMany vs replay feedMany",
    );
  });

  it("radial 4 の live stroke と command replay が byte-identical", () => {
    const perf = getBrushPerfTestBridge();
    if (!perf) throw new Error("Brush perf debug bridge is unavailable");
    perf.enabled = true;
    const accelerator = createTestAccelerator();

    const baseLayer = createTestLayer();
    paintExpandFixture(baseLayer);
    const liveLayer = createTestLayer();
    copyLayerPixels(baseLayer, liveLayer);
    const { command } = simulateLiveStroke({
      layer: liveLayer,
      inputPoints: CENTER_CROSSING_INPUT_POINTS,
      style: STAMP_MIXING_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: RADIAL_EXPAND_4,
      brushSeed: BRUSH_SEED,
      alphaLocked: false,
      accelerator,
    });
    expect(perf.snapshot().stages.gpuCommit.count).toBeGreaterThan(1);
    perf.reset();
    const replayLayer = createTestLayer();
    replayOnLayer(command, replayLayer, baseLayer, accelerator);
    expect(perf.snapshot().stages.gpuCommit.count).toBe(1);

    expectPixelEqual(
      liveLayer,
      replayLayer,
      "GPU radial 4 live stroke vs command replay",
    );
    accelerator.dispose();
  });

  it("radial 64 が GPU を使い live/replay byte 一致と CPU Tier B parity を満たす", () => {
    const cpuLayer = renderGpuExpandBatches(
      "cpu",
      [CENTER_CROSSING_INPUT_POINTS],
      RADIAL_EXPAND_64,
    );
    const perf = getBrushPerfTestBridge();
    if (!perf) throw new Error("Brush perf debug bridge is unavailable");
    perf.enabled = true;
    perf.reset();
    const accelerator = createTestAccelerator();
    const gpuRuntime = getGpuTestRuntime(accelerator);
    if (!gpuRuntime) throw new Error("GPU accelerator runtime is unavailable");
    expect(gpuRuntime.supportsBranchCount(64)).toBe(true);

    const baseLayer = createTestLayer();
    paintExpandFixture(baseLayer);
    const liveLayer = createTestLayer();
    copyLayerPixels(baseLayer, liveLayer);
    const { command } = simulateLiveStroke({
      layer: liveLayer,
      inputPoints: CENTER_CROSSING_INPUT_POINTS,
      style: STAMP_MIXING_STYLE,
      filterPipeline: FILTER_PIPELINE,
      expand: RADIAL_EXPAND_64,
      brushSeed: BRUSH_SEED,
      alphaLocked: false,
      accelerator,
    });

    expect(perf.snapshot().samples.gpuBranches).toEqual([64]);
    expect(perf.snapshot().stages.gpuFieldUpdate.count).toBeGreaterThan(0);
    const replayLayer = createTestLayer();
    replayOnLayer(command, replayLayer, baseLayer, accelerator);

    expectPixelEqual(
      liveLayer,
      replayLayer,
      "GPU radial 64 live stroke vs command replay",
    );
    expectAlphaTierB(cpuLayer, liveLayer);
    accelerator.dispose();
  });

  it("radial 65 は supportsBranchCount=false となり CPU fallback する", () => {
    const accelerator = createTestAccelerator();
    const gpuRuntime = getGpuTestRuntime(accelerator);
    if (!gpuRuntime) throw new Error("GPU accelerator runtime is unavailable");
    expect(gpuRuntime.supportsBranchCount(65)).toBe(false);
    accelerator.dispose();

    const expected = renderGpuExpandBatches(
      "cpu",
      [CENTER_CROSSING_INPUT_POINTS],
      RADIAL_EXPAND_65,
    );
    const perf = getBrushPerfTestBridge();
    if (!perf) throw new Error("Brush perf debug bridge is unavailable");
    perf.enabled = true;
    perf.reset();
    const actual = renderGpuExpandBatches(
      "webgl2",
      [CENTER_CROSSING_INPUT_POINTS],
      RADIAL_EXPAND_65,
    );

    expectPixelEqual(expected, actual, "radial 65 CPU fallback");
    expect(perf.snapshot().samples.gpuBranches).toEqual([]);
  });
});

interface MaterialFieldSnapshot {
  readonly branchIndex: number;
  readonly updateCount: number;
  readonly pixels: Uint8ClampedArray;
}

function traceRadialFieldUpdates(
  backend: "cpu" | "webgl2",
): readonly MaterialFieldSnapshot[] {
  const perf = getBrushPerfTestBridge();
  if (!perf) throw new Error("Brush perf debug bridge is unavailable");
  perf.enabled = true;
  perf.reset();
  const accelerator =
    backend === "webgl2" ? createTestAccelerator({ resident: false }) : null;
  const gpuRuntime = getGpuTestRuntime(accelerator);

  const layer = createTestLayer();
  layer.ctx.fillStyle = "rgb(35, 95, 220)";
  layer.ctx.fillRect(0, 0, layer.width, layer.height);
  const snapshots: MaterialFieldSnapshot[] = [];
  const capturedUpdates = new Set<string>();
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style: FIELD_TRACE_STYLE,
    filterPipeline: { filters: [] },
    expand: RADIAL_EXPAND_2,
    brushSeed: BRUSH_SEED,
    alphaLocked: false,
    accelerator,
    onRenderUpdate: ({ brushState }) => {
      captureFieldSnapshots(snapshots, capturedUpdates, brushState, gpuRuntime);
    },
  });
  for (const point of FIELD_TRACE_INPUT_POINTS) renderer.feed(point);
  renderer.finalize();
  accelerator?.dispose();
  return snapshots;
}

function captureFieldSnapshots(
  snapshots: MaterialFieldSnapshot[],
  capturedUpdates: Set<string>,
  brushState: BrushRenderState | undefined,
  gpuRuntime: GpuTestRuntime | null,
): void {
  if (!brushState) return;
  for (let branchIndex = 0; branchIndex < 2; branchIndex++) {
    const branch = brushState.branches[branchIndex];
    const updateCount = branch?.emissionCount ?? 0;
    if (updateCount === 0 || updateCount % 5 !== 0) continue;
    const key = `${branchIndex}:${updateCount}`;
    if (capturedUpdates.has(key)) continue;
    const pixels = gpuRuntime
      ? gpuRuntime.readMaterialFieldForTest(branchIndex)
      : materialFieldPixels(branch?.mixing?.field);
    if (!pixels) throw new Error("GPU material field is unavailable");
    snapshots.push({ branchIndex, updateCount, pixels });
    capturedUpdates.add(key);
  }
}

function materialFieldPixels(
  field: Float32Array | undefined,
): Uint8ClampedArray {
  if (!field) throw new Error("CPU material field is unavailable");
  return Uint8ClampedArray.from(field, (value) => Math.round(value));
}

function materialFieldMae(
  expected: Uint8ClampedArray,
  actual: Uint8ClampedArray,
): number {
  expect(actual).toHaveLength(expected.length);
  let absoluteDelta = 0;
  for (let index = 0; index < expected.length; index++) {
    absoluteDelta += Math.abs((expected[index] ?? 0) - (actual[index] ?? 0));
  }
  return absoluteDelta / expected.length / 255;
}

function snapshotKey(snapshot: MaterialFieldSnapshot): string {
  return `${snapshot.branchIndex}:${snapshot.updateCount}`;
}

function renderGpuMixingBatches(
  batches: readonly (readonly InputPoint[])[],
): Layer {
  const accelerator = createTestAccelerator();
  const layer = createTestLayer();
  paintOpaqueBands(layer);
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style: STAMP_MIXING_STYLE,
    filterPipeline: FILTER_PIPELINE,
    expand: EXPAND,
    brushSeed: BRUSH_SEED,
    alphaLocked: false,
    accelerator,
  });
  for (const batch of batches) renderer.feedMany(batch);
  renderer.finalize();
  accelerator.dispose();
  return layer;
}

function renderRoughMixing(backend: "cpu" | "webgl2"): Layer {
  const accelerator = backend === "webgl2" ? createTestAccelerator() : null;
  const layer = createTestLayer();
  paintOpaqueBands(layer);
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style: ROUGH_MIXING_STYLE,
    filterPipeline: CAUSAL_FILTER_PIPELINE,
    expand: EXPAND,
    brushSeed: BRUSH_SEED,
    alphaLocked: false,
    accelerator,
  });
  renderer.feedMany(INPUT_POINTS);
  renderer.finalize();
  accelerator?.dispose();
  return layer;
}

function expectRoughMixingHistoryParity(
  accelerator: BrushAccelerator | null,
  label: string,
): void {
  const baseLayer = createTestLayer();
  paintOpaqueBands(baseLayer);
  const liveLayer = createTestLayer();
  copyLayerPixels(baseLayer, liveLayer);
  let history = createHistoryState(WIDTH, HEIGHT, { layerCount: 1 });
  history = beginHistoryMutation(
    history,
    { affectedLayers: [liveLayer], layerCount: 1 },
    HISTORY_CONFIG,
  );
  const { command } = simulateLiveStroke({
    layer: liveLayer,
    inputPoints: INPUT_POINTS,
    style: ROUGH_MIXING_STYLE,
    filterPipeline: CAUSAL_FILTER_PIPELINE,
    expand: EXPAND,
    brushSeed: BRUSH_SEED,
    alphaLocked: false,
    accelerator,
  });
  const replayLayer = createTestLayer();
  replayOnLayer(command, replayLayer, baseLayer, accelerator);
  expectPixelEqual(liveLayer, replayLayer, `${label} live vs replay`);

  history = pushCommand(
    history,
    command,
    { afterLayer: liveLayer, layerCount: 1 },
    HISTORY_CONFIG,
  );
  const undoLayer = createTestLayer();
  const undoResult = rebuildLayerFromHistory(
    undoLayer,
    undo(history),
    undefined,
    { accelerator },
  );
  expect(undoResult.ok).toBe(true);
  expectPixelEqual(undoLayer, baseLayer, `${label} undo`);

  const redoLayer = createTestLayer();
  const redoResult = rebuildLayerFromHistory(
    redoLayer,
    redo(undo(history)),
    undefined,
    { accelerator },
  );
  expect(redoResult.ok).toBe(true);
  expectPixelEqual(redoLayer, replayLayer, `${label} redo`);
}

function renderGpuExpandBatches(
  backend: "cpu" | "webgl2",
  batches: readonly (readonly InputPoint[])[],
  expand: ExpandConfig = RADIAL_EXPAND_4,
): Layer {
  const perf = getBrushPerfTestBridge();
  if (!perf) throw new Error("Brush perf debug bridge is unavailable");
  perf.enabled = true;
  const accelerator = backend === "webgl2" ? createTestAccelerator() : null;

  const layer = createTestLayer();
  paintExpandFixture(layer);
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style: STAMP_MIXING_STYLE,
    filterPipeline: FILTER_PIPELINE,
    expand,
    brushSeed: BRUSH_SEED,
    alphaLocked: false,
    accelerator,
  });
  for (const batch of batches) renderer.feedMany(batch);
  renderer.finalize();
  accelerator?.dispose();
  return layer;
}

function paintExpandFixture(layer: Layer): void {
  layer.ctx.fillStyle = "rgb(225, 45, 35)";
  layer.ctx.fillRect(28, 48, 62, 44);
  layer.ctx.fillStyle = "rgb(30, 80, 225)";
  layer.ctx.fillRect(90, 48, 62, 44);
  layer.ctx.fillStyle = "rgba(35, 210, 90, 0.65)";
  layer.ctx.beginPath();
  layer.ctx.arc(WIDTH / 2, HEIGHT / 2, 24, 0, Math.PI * 2);
  layer.ctx.fill();
}

function expectAlphaTierB(cpuLayer: Layer, gpuLayer: Layer): void {
  const cpu = cpuLayer.ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
  const gpu = gpuLayer.ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
  let absoluteDelta = 0;
  let largeDeltaPixels = 0;
  const pixelCount = WIDTH * HEIGHT;
  for (let offset = 3; offset < cpu.length; offset += 4) {
    const delta = Math.abs((cpu[offset] ?? 0) - (gpu[offset] ?? 0)) / 255;
    absoluteDelta += delta;
    if (delta > 0.1) largeDeltaPixels++;
  }
  expect(absoluteDelta / pixelCount).toBeLessThanOrEqual(0.015);
  expect(largeDeltaPixels / pixelCount).toBeLessThanOrEqual(0.01);
}

function measureTierB(
  cpuLayer: Layer,
  gpuLayer: Layer,
): {
  readonly alphaMae: number;
  readonly rgbMae: number;
  readonly largeDeltaRate: number;
  readonly comparedPixels: number;
} {
  const cpu = cpuLayer.ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
  const gpu = gpuLayer.ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
  let alphaAbsoluteDelta = 0;
  let rgbAbsoluteDelta = 0;
  let largeDeltaPixels = 0;
  let comparedPixels = 0;
  for (let offset = 0; offset < cpu.length; offset += 4) {
    const cpuAlpha = (cpu[offset + 3] ?? 0) / 255;
    const gpuAlpha = (gpu[offset + 3] ?? 0) / 255;
    if (cpuAlpha <= 0 && gpuAlpha <= 0) continue;
    comparedPixels++;
    const redDelta = Math.abs((cpu[offset] ?? 0) - (gpu[offset] ?? 0)) / 255;
    const greenDelta =
      Math.abs((cpu[offset + 1] ?? 0) - (gpu[offset + 1] ?? 0)) / 255;
    const blueDelta =
      Math.abs((cpu[offset + 2] ?? 0) - (gpu[offset + 2] ?? 0)) / 255;
    const alphaDelta = Math.abs(cpuAlpha - gpuAlpha);
    rgbAbsoluteDelta += redDelta + greenDelta + blueDelta;
    alphaAbsoluteDelta += alphaDelta;
    if (Math.max(redDelta, greenDelta, blueDelta, alphaDelta) > 0.1) {
      largeDeltaPixels++;
    }
  }
  if (comparedPixels === 0) {
    throw new Error("Tier B comparison requires union coverage");
  }
  return {
    alphaMae: alphaAbsoluteDelta / comparedPixels,
    rgbMae: rgbAbsoluteDelta / comparedPixels / 3,
    largeDeltaRate: largeDeltaPixels / comparedPixels,
    comparedPixels,
  };
}

function getBrushPerfTestBridge():
  | {
      enabled: boolean;
      reset(): void;
      snapshot(): {
        readonly stages: {
          readonly gpuFlush: { readonly count: number };
          readonly gpuFieldUpdate: { readonly count: number };
          readonly gpuCommit: { readonly count: number };
          readonly checkpointReadback: { readonly count: number };
        };
        readonly samples: {
          readonly gpuBranches: readonly number[];
          readonly gpuResidencyHit: readonly number[];
        };
      };
    }
  | undefined {
  return (
    globalThis as typeof globalThis & {
      readonly __hpBrushPerf?: {
        enabled: boolean;
        reset(): void;
        snapshot(): {
          readonly stages: {
            readonly gpuFlush: { readonly count: number };
            readonly gpuFieldUpdate: { readonly count: number };
            readonly gpuCommit: { readonly count: number };
            readonly checkpointReadback: { readonly count: number };
          };
          readonly samples: {
            readonly gpuBranches: readonly number[];
            readonly gpuResidencyHit: readonly number[];
          };
        };
      };
    }
  ).__hpBrushPerf;
}

interface GpuTestRuntime {
  supportsBranchCount(branchCount: number): boolean;
  readMaterialFieldForTest(branchIndex: number): Uint8ClampedArray | null;
}

function createTestAccelerator(
  options: { readonly resident?: boolean } = {},
): BrushAccelerator {
  const accelerator = createBrushAccelerator({
    backend: "webgl2",
    resident: options.resident,
  });
  if (!accelerator) throw new Error("WebGL2 accelerator is unavailable");
  return accelerator;
}

function getGpuTestRuntime(
  accelerator: BrushAccelerator | null,
): GpuTestRuntime | null {
  if (!accelerator) return null;
  const runtime = accelerator as BrushAccelerator & Partial<GpuTestRuntime>;
  return typeof runtime.supportsBranchCount === "function" &&
    typeof runtime.readMaterialFieldForTest === "function"
    ? (runtime as GpuTestRuntime)
    : null;
}

function getActiveSurfaceForTest(accelerator: BrushAccelerator): {
  readonly canvas: OffscreenCanvas;
} {
  const surface = (
    accelerator as unknown as {
      readonly activeSurface: { readonly canvas: OffscreenCanvas } | null;
    }
  ).activeSurface;
  if (!surface) throw new Error("GPU stroke surface is unavailable");
  return surface;
}

function renderStrokeForLifecycle(
  layer: Layer,
  accelerator: BrushAccelerator | null,
): void {
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style: STAMP_MIXING_STYLE,
    filterPipeline: FILTER_PIPELINE,
    expand: EXPAND,
    brushSeed: BRUSH_SEED + 1,
    alphaLocked: false,
    accelerator,
  });
  renderer.feedMany(CENTER_CROSSING_INPUT_POINTS);
  renderer.finalize();
}

function createHistoryBackedGpuRuntime(
  layer: Layer,
  accelerator: BrushAccelerator,
): ReturnType<typeof createStrokeRuntime> {
  const history = beginHistoryMutation(
    createHistoryState(WIDTH, HEIGHT, { layerCount: 1 }),
    { affectedLayers: [layer], layerCount: 1 },
    HISTORY_CONFIG,
  );
  return createStrokeRuntime({
    setTimeout: () => 0,
    clearTimeout: () => {},
    now: () => INPUT_POINTS[0]?.timestamp ?? 0,
    requestRender: () => {},
    onCommit: () => {},
    onDrawingChanged: () => {},
    randomSeed: () => BRUSH_SEED,
    accelerator,
    restoreLayerBeforeStroke: (target) => {
      const result = rebuildLayerFromHistory(target, history);
      if (!result.ok) {
        throw new Error(`History recovery failed: ${result.reason}`);
      }
    },
  });
}

function startRuntimeStroke(
  runtime: ReturnType<typeof createStrokeRuntime>,
  layer: Layer,
): void {
  const firstPoint = INPUT_POINTS[0];
  if (!firstPoint) throw new Error("Lifecycle test requires input points");
  runtime.start(firstPoint, {
    layer,
    pendingLayer: createLayer(WIDTH, HEIGHT),
    style: STAMP_MIXING_STYLE,
    filterPipeline: FILTER_PIPELINE,
    expand: EXPAND,
    alphaLocked: false,
    brushSeed: BRUSH_SEED,
  });
}

interface ParityRun {
  readonly beforeLayer: Layer;
  readonly liveLayer: Layer;
  readonly replayLayer: Layer;
  readonly history: HistoryState;
}

function runParityCase(parityCase: ParityCase): ParityRun {
  const baseLayer = createTestLayer();
  parityCase.paintBase?.(baseLayer);

  const liveLayer = createTestLayer(parityCase.alphaLocked);
  copyLayerPixels(baseLayer, liveLayer);
  const beforeLayer = createTestLayer(parityCase.alphaLocked);
  copyLayerPixels(liveLayer, beforeLayer);

  let history = createHistoryState(WIDTH, HEIGHT, { layerCount: 1 });
  history = beginHistoryMutation(
    history,
    { affectedLayers: [liveLayer], layerCount: 1 },
    HISTORY_CONFIG,
  );

  const { command } = simulateLiveStroke({
    layer: liveLayer,
    inputPoints: INPUT_POINTS,
    style: parityCase.style,
    filterPipeline: parityCase.filterPipeline ?? FILTER_PIPELINE,
    expand: EXPAND,
    brushSeed: BRUSH_SEED,
    alphaLocked: parityCase.alphaLocked,
  });

  const replayLayer = createTestLayer(parityCase.alphaLocked);
  replayOnLayer(command, replayLayer, baseLayer);

  history = pushCommand(
    history,
    command,
    { afterLayer: liveLayer, layerCount: 1 },
    HISTORY_CONFIG,
  );

  return { beforeLayer, liveLayer, replayLayer, history };
}

function makeStyle(overrides: Partial<StrokeStyle>): StrokeStyle {
  return {
    color: BLACK,
    lineWidth: 10,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush: ROUND_PEN,
    ...overrides,
  };
}

function createTestLayer(alphaLocked = false): Layer {
  const layer = createLayer(WIDTH, HEIGHT, {
    name: "parity",
    visible: true,
    opacity: 1,
    alphaLocked,
  });
  (layer as { id: string }).id = LAYER_ID;
  return layer;
}

function paintOpaqueBands(layer: Layer): void {
  clearLayer(layer);
  layer.ctx.fillStyle = "rgb(240, 75, 65)";
  layer.ctx.fillRect(0, 0, WIDTH / 2, HEIGHT);
  layer.ctx.fillStyle = "rgb(35, 95, 220)";
  layer.ctx.fillRect(WIDTH / 2, 0, WIDTH / 2, HEIGHT);
  layer.ctx.fillStyle = "rgb(245, 215, 90)";
  layer.ctx.fillRect(0, HEIGHT - 34, WIDTH, 34);
}

function paintAlphaLockBase(layer: Layer): void {
  clearLayer(layer);
  layer.ctx.fillStyle = "rgba(20, 20, 20, 1)";
  layer.ctx.fillRect(18, 48, 130, 48);
  layer.ctx.fillStyle = "rgba(220, 220, 220, 0.75)";
  layer.ctx.fillRect(62, 22, 48, 92);
}
