import type {
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
  createLayer,
} from "@headless-paint/engine";
import type { FilterPipelineConfig, InputPoint } from "@headless-paint/input";
import { afterEach, describe, expect, it } from "vitest";
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
  perf.experiments.gpuDab = "off";
  perf.experiments.gpuReadback = "gpu-field";
  perf.experiments.checkpointLagSteps = 1;
  perf.experiments.gpuResident = true;
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

describe.each([
  { gpuReadback: "gpu-field", checkpointLagSteps: 1 },
  { gpuReadback: "sync", checkpointLagSteps: 1 },
] as const)(
  "GPU mixing $gpuReadback lag=$checkpointLagSteps feedMany parity",
  ({ gpuReadback, checkpointLagSteps }) => {
    it("複数 batch と replay 相当の単一 batch が byte-identical", () => {
      const perf = getBrushPerfTestBridge();
      if (!perf) throw new Error("Brush perf debug bridge is unavailable");
      perf.enabled = true;
      perf.reset();
      const splitLayer = renderGpuMixingBatches(
        gpuReadback,
        checkpointLagSteps,
        [
          INPUT_POINTS.slice(0, 2),
          INPUT_POINTS.slice(2, 5),
          INPUT_POINTS.slice(5),
        ],
      );
      const replayLayer = renderGpuMixingBatches(
        gpuReadback,
        checkpointLagSteps,
        [INPUT_POINTS],
      );

      expectPixelEqual(
        splitLayer,
        replayLayer,
        `GPU mixing ${gpuReadback} lag=${checkpointLagSteps} split feedMany vs replay feedMany`,
      );
      const stages = perf.snapshot().stages;
      expect(stages.gpuFlush.count).toBeGreaterThan(0);
      if (gpuReadback === "gpu-field") {
        expect(stages.gpuFieldUpdate.count).toBeGreaterThan(0);
        expect(stages.checkpointReadback.count).toBe(0);
      }
    });
  },
);

describe("GPU mixing Expand parity", () => {
  it("radial 4 の中心重なり fixture が CPU と Tier B alpha parity を満たす", () => {
    const cpuLayer = renderGpuExpandBatches("off", [
      CENTER_CROSSING_INPUT_POINTS,
    ]);
    const perf = getBrushPerfTestBridge();
    if (!perf) throw new Error("Brush perf debug bridge is unavailable");
    perf.reset();
    const gpuLayer = renderGpuExpandBatches("webgl2", [
      CENTER_CROSSING_INPUT_POINTS,
    ]);

    expectAlphaTierB(cpuLayer, gpuLayer);
    expect(perf.snapshot().samples.gpuBranches).toEqual([4]);
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
    perf.experiments.gpuDab = "webgl2";
    perf.experiments.gpuReadback = "gpu-field";

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
    });
    const replayLayer = createTestLayer();
    replayOnLayer(command, replayLayer, baseLayer);

    expectPixelEqual(
      liveLayer,
      replayLayer,
      "GPU radial 4 live stroke vs command replay",
    );
  });
});

function renderGpuMixingBatches(
  gpuReadback: "gpu-field" | "sync",
  checkpointLagSteps: number,
  batches: readonly (readonly InputPoint[])[],
): Layer {
  const perf = getBrushPerfTestBridge();
  if (!perf) throw new Error("Brush perf debug bridge is unavailable");
  perf.experiments.gpuDab = "webgl2";
  perf.experiments.gpuReadback = gpuReadback;
  perf.experiments.checkpointLagSteps = checkpointLagSteps;

  const layer = createTestLayer();
  paintOpaqueBands(layer);
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style: STAMP_MIXING_STYLE,
    filterPipeline: FILTER_PIPELINE,
    expand: EXPAND,
    brushSeed: BRUSH_SEED,
    alphaLocked: false,
  });
  for (const batch of batches) renderer.feedMany(batch);
  renderer.finalize();
  return layer;
}

function renderGpuExpandBatches(
  gpuDab: "off" | "webgl2",
  batches: readonly (readonly InputPoint[])[],
): Layer {
  const perf = getBrushPerfTestBridge();
  if (!perf) throw new Error("Brush perf debug bridge is unavailable");
  perf.enabled = true;
  perf.experiments.gpuDab = gpuDab;
  perf.experiments.gpuReadback = "gpu-field";

  const layer = createTestLayer();
  paintExpandFixture(layer);
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style: STAMP_MIXING_STYLE,
    filterPipeline: FILTER_PIPELINE,
    expand: RADIAL_EXPAND_4,
    brushSeed: BRUSH_SEED,
    alphaLocked: false,
  });
  for (const batch of batches) renderer.feedMany(batch);
  renderer.finalize();
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

function getBrushPerfTestBridge():
  | {
      enabled: boolean;
      readonly experiments: {
        gpuDab: "off" | "webgl2";
        gpuReadback: "gpu-field" | "sync";
        checkpointLagSteps: number;
        gpuResident: boolean;
      };
      reset(): void;
      snapshot(): {
        readonly stages: {
          readonly gpuFlush: { readonly count: number };
          readonly gpuFieldUpdate: { readonly count: number };
          readonly checkpointReadback: { readonly count: number };
        };
        readonly samples: {
          readonly gpuBranches: readonly number[];
        };
      };
    }
  | undefined {
  return (
    globalThis as typeof globalThis & {
      readonly __hpBrushPerf?: {
        enabled: boolean;
        readonly experiments: {
          gpuDab: "off" | "webgl2";
          gpuReadback: "gpu-field" | "sync";
          checkpointLagSteps: number;
          gpuResident: boolean;
        };
        reset(): void;
        snapshot(): {
          readonly stages: {
            readonly gpuFlush: { readonly count: number };
            readonly gpuFieldUpdate: { readonly count: number };
            readonly checkpointReadback: { readonly count: number };
          };
          readonly samples: {
            readonly gpuBranches: readonly number[];
          };
        };
      };
    }
  ).__hpBrushPerf;
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
