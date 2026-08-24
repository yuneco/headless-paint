export const BRUSH_PERF_STAGE_NAMES = [
  "interpolate",
  "walkEmissions",
  "sweepResolve",
  "maskField",
  "maskRaster",
  "maskUpload",
  "drawSweep",
  "composite",
  "layerDraw",
  "canvasAlloc",
  "dabDraw",
  "materialSample",
  "materialAdvance",
  "materialUpload",
  "checkpointReadback",
  "samplingLayerCopy",
  "appendCommitted",
  "renderUpdateCallback",
  "processBatch",
  "feedPoint",
  "executeEffects",
  "moveMany",
  "fxAppendCommitted",
  "fxRenderPending",
  "fxOther",
] as const;

export type BrushPerfStageName = (typeof BRUSH_PERF_STAGE_NAMES)[number];

export const BRUSH_PERF_SAMPLE_NAMES = [
  "emissions",
  "fieldCells",
  "bboxAreas",
  "samplingCopyPixels",
  "checkpoints",
] as const;

export type BrushPerfSampleName = (typeof BRUSH_PERF_SAMPLE_NAMES)[number];

export interface BrushPerfNullStages {
  nullField: boolean;
  nullContact: boolean;
  nullRaster: boolean;
  nullDrawSweep: boolean;
  nullFullCopy: boolean;
  nullCheckpoint: boolean;
  nullFieldAdvance: boolean;
  nullMaterialUpload: boolean;
  nullRender: boolean;
  nullDabDraw: boolean;
  nullRotate: boolean;
}

export interface BrushPerfExperiments {
  fusedInk: boolean;
}

export interface BrushPerfStageSnapshot {
  readonly count: number;
  readonly totalMs: number;
}

export interface BrushPerfSnapshot {
  readonly enabled: boolean;
  readonly nullStages: Readonly<BrushPerfNullStages>;
  readonly experiments: Readonly<BrushPerfExperiments>;
  readonly stages: Readonly<Record<BrushPerfStageName, BrushPerfStageSnapshot>>;
  readonly samples: Readonly<Record<BrushPerfSampleName, readonly number[]>>;
  readonly stageSeries: Readonly<Record<BrushPerfStageName, readonly number[]>>;
}

export interface BrushPerfDebug {
  enabled: boolean;
  nullStages: BrushPerfNullStages;
  experiments: BrushPerfExperiments;
  recordStage(name: BrushPerfStageName, startedAt: number): void;
  recordElapsed(name: BrushPerfStageName, elapsedMs: number): void;
  recordSample(name: BrushPerfSampleName, value: number): void;
  reset(): void;
  snapshot(): BrushPerfSnapshot;
}

function createNullStages(): BrushPerfNullStages {
  return {
    nullField: false,
    nullContact: false,
    nullRaster: false,
    nullDrawSweep: false,
    nullFullCopy: false,
    nullCheckpoint: false,
    nullFieldAdvance: false,
    nullMaterialUpload: false,
    nullRender: false,
    nullDabDraw: false,
    nullRotate: false,
  };
}

function createExperiments(): BrushPerfExperiments {
  return { fusedInk: false };
}

function createStageCounters(): Record<
  BrushPerfStageName,
  { count: number; totalMs: number }
> {
  return Object.fromEntries(
    BRUSH_PERF_STAGE_NAMES.map((name) => [name, { count: 0, totalMs: 0 }]),
  ) as Record<BrushPerfStageName, { count: number; totalMs: number }>;
}

function createSamples(): Record<BrushPerfSampleName, number[]> {
  return {
    emissions: [],
    fieldCells: [],
    bboxAreas: [],
    samplingCopyPixels: [],
    checkpoints: [],
  };
}

function createBrushPerfDebug(): BrushPerfDebug {
  let stages = createStageCounters();
  let samples = createSamples();
  let stageSeries = Object.fromEntries(
    BRUSH_PERF_STAGE_NAMES.map((name) => [name, [] as number[]]),
  ) as Record<BrushPerfStageName, number[]>;
  return {
    enabled: false,
    nullStages: createNullStages(),
    experiments: createExperiments(),
    recordStage(name, startedAt) {
      if (!this.enabled) return;
      this.recordElapsed(name, performance.now() - startedAt);
    },
    recordElapsed(name, elapsedMs) {
      if (!this.enabled) return;
      const counter = stages[name];
      counter.count++;
      counter.totalMs += elapsedMs;
      stageSeries[name].push(Number(elapsedMs.toFixed(3)));
    },
    recordSample(name, value) {
      if (!this.enabled) return;
      samples[name].push(value);
    },
    reset() {
      stages = createStageCounters();
      samples = createSamples();
      stageSeries = Object.fromEntries(
        BRUSH_PERF_STAGE_NAMES.map((name) => [name, [] as number[]]),
      ) as Record<BrushPerfStageName, number[]>;
    },
    snapshot() {
      return {
        enabled: this.enabled,
        nullStages: { ...this.nullStages },
        experiments: { ...this.experiments },
        stages: Object.fromEntries(
          BRUSH_PERF_STAGE_NAMES.map((name) => [name, { ...stages[name] }]),
        ) as Record<BrushPerfStageName, BrushPerfStageSnapshot>,
        samples: {
          emissions: [...samples.emissions],
          fieldCells: [...samples.fieldCells],
          bboxAreas: [...samples.bboxAreas],
          samplingCopyPixels: [...samples.samplingCopyPixels],
          checkpoints: [...samples.checkpoints],
        },
        stageSeries: Object.fromEntries(
          BRUSH_PERF_STAGE_NAMES.map((name) => [name, [...stageSeries[name]]]),
        ) as unknown as Record<BrushPerfStageName, readonly number[]>,
      };
    },
  };
}

declare global {
  // Temporary experiment-only instrumentation. Deliberately not public API.
  var __hpBrushPerf: BrushPerfDebug | undefined;
}

const installedBrushPerfDebug =
  globalThis.__hpBrushPerf ?? createBrushPerfDebug();
globalThis.__hpBrushPerf = installedBrushPerfDebug;
export const brushPerfDebug = installedBrushPerfDebug;
