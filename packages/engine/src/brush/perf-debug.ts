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
  "gpuFieldUpdate",
  "gpuFlush",
  "gpuCommit",
  "gpuUpload",
  "gpuBaseCopy",
  "gpuCancelRestore",
  "gpuBristleMask",
  "gpuBristleInk",
  "gpuBristleComposite",
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
  "layerReadPixels",
  "samplingCopyPixels",
  "checkpoints",
  "gpuResidencyHit",
  "gpuBranches",
  "gpuCommitPixels",
  "gpuCommitDraws",
] as const;

export type BrushPerfSampleName = (typeof BRUSH_PERF_SAMPLE_NAMES)[number];

const BRUSH_PERF_BATCH_STAGE_NAMES = [
  "gpuUpload",
  "gpuFieldUpdate",
  "gpuFlush",
  "gpuCommit",
  "gpuBaseCopy",
  "gpuCancelRestore",
  "gpuBristleMask",
  "gpuBristleInk",
  "gpuBristleComposite",
  "checkpointReadback",
  "dabDraw",
  "samplingLayerCopy",
  "processBatch",
] as const satisfies readonly BrushPerfStageName[];

type BrushPerfBatchStageName = (typeof BRUSH_PERF_BATCH_STAGE_NAMES)[number];

type BrushPerfBatchKind = "moveMany" | "strokeStart";

export type BrushPerfEventName =
  | "residency"
  | "residencyInvalidated"
  | "gpuUpload"
  | "gpuCommit"
  | "realloc:fieldStrip"
  | "realloc:snapshotArray"
  | "realloc:commitCanvas"
  | "realloc:accum"
  | "realloc:strokeBase"
  | "gpuStaleOwnerRecovered"
  | "warmUp";

export interface BrushPerfEventDetails {
  readonly mode?: "bitmap" | "direct";
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  readonly bytes?: number;
  readonly hit?: boolean;
  readonly reason?: string;
  readonly ownerLabel?: string;
  readonly ownerStartedAtMs?: number;
  readonly ownerAgeMs?: number;
  readonly recoveryOwnerLabel?: string;
  readonly passes?: number;
  readonly pixels?: number;
  readonly bitmapMs?: number;
  readonly drawMs?: number;
  readonly forceRecord?: boolean;
}

interface BrushPerfEventSnapshot {
  readonly name: BrushPerfEventName;
  readonly mode?: "bitmap" | "direct";
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  readonly bytes?: number;
  readonly hit?: boolean;
  readonly reason?: string;
  readonly ownerLabel?: string;
  readonly ownerStartedAtMs?: number;
  readonly ownerAgeMs?: number;
  readonly recoveryOwnerLabel?: string;
  readonly passes?: number;
  readonly pixels?: number;
  readonly bitmapMs?: number;
  readonly drawMs?: number;
}

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

export interface BrushPerfStageSnapshot {
  readonly count: number;
  readonly totalMs: number;
}

interface BrushPerfStallSnapshot {
  readonly kind: BrushPerfBatchKind;
  readonly ownerLabel?: string;
  readonly timestampMs: number;
  readonly gapMs: number | null;
  readonly totalMs: number;
  readonly pointCount: number;
  readonly branchCount: number;
  readonly stages: Readonly<
    Record<BrushPerfBatchStageName, BrushPerfStageSnapshot>
  >;
  readonly events: readonly BrushPerfEventSnapshot[];
}

export interface BrushPerfSnapshot {
  readonly enabled: boolean;
  readonly nullStages: Readonly<BrushPerfNullStages>;
  readonly stages: Readonly<Record<BrushPerfStageName, BrushPerfStageSnapshot>>;
  readonly samples: Readonly<Record<BrushPerfSampleName, readonly number[]>>;
  readonly stageSeries: Readonly<Record<BrushPerfStageName, readonly number[]>>;
  readonly stalls: readonly BrushPerfStallSnapshot[];
  readonly recentEvents: readonly BrushPerfEventSnapshot[];
}

export interface BrushPerfDebug {
  enabled: boolean;
  experiments: {
    stallThresholdMs: number;
  };
  nullStages: BrushPerfNullStages;
  beginBatch(
    pointCount: number,
    branchCount: number,
    kind?: BrushPerfBatchKind,
    ownerLabel?: string,
  ): void;
  endBatch(): void;
  recordStage(name: BrushPerfStageName, startedAt: number): void;
  recordElapsed(name: BrushPerfStageName, elapsedMs: number): void;
  recordSample(name: BrushPerfSampleName, value: number): void;
  recordEvent(name: BrushPerfEventName, details?: BrushPerfEventDetails): void;
  reset(): void;
  snapshot(): BrushPerfSnapshot;
}

interface ActiveBatch {
  readonly kind: BrushPerfBatchKind;
  readonly ownerLabel?: string;
  readonly startedAt: number;
  readonly timestampMs: number;
  readonly gapMs: number | null;
  readonly pointCount: number;
  readonly branchCount: number;
  readonly stages: Record<
    BrushPerfBatchStageName,
    { count: number; totalMs: number }
  >;
  readonly events: BrushPerfEventSnapshot[];
  forceRecord: boolean;
}

const STALL_BUFFER_CAPACITY = 32;
const RECENT_EVENT_BUFFER_CAPACITY = 32;
const DEFAULT_STALL_THRESHOLD_MS = 60;

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
    layerReadPixels: [],
    samplingCopyPixels: [],
    checkpoints: [],
    gpuResidencyHit: [],
    gpuBranches: [],
    gpuCommitPixels: [],
    gpuCommitDraws: [],
  };
}

function createBatchStageCounters(): Record<
  BrushPerfBatchStageName,
  { count: number; totalMs: number }
> {
  return Object.fromEntries(
    BRUSH_PERF_BATCH_STAGE_NAMES.map((name) => [
      name,
      { count: 0, totalMs: 0 },
    ]),
  ) as Record<BrushPerfBatchStageName, { count: number; totalMs: number }>;
}

function isBatchStageName(
  name: BrushPerfStageName,
): name is BrushPerfBatchStageName {
  return (
    BRUSH_PERF_BATCH_STAGE_NAMES as readonly BrushPerfStageName[]
  ).includes(name);
}

function getStallThresholdMs(value: number): number {
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_STALL_THRESHOLD_MS;
}

function toEventSnapshot(
  name: BrushPerfEventName,
  details: BrushPerfEventDetails,
): BrushPerfEventSnapshot {
  const { forceRecord: _forceRecord, ...snapshot } = details;
  return { name, ...snapshot };
}

function createBrushPerfDebug(): BrushPerfDebug {
  let stages = createStageCounters();
  let samples = createSamples();
  let stageSeries = Object.fromEntries(
    BRUSH_PERF_STAGE_NAMES.map((name) => [name, [] as number[]]),
  ) as Record<BrushPerfStageName, number[]>;
  let activeBatch: ActiveBatch | null = null;
  let stalls: BrushPerfStallSnapshot[] = [];
  let recentEvents: BrushPerfEventSnapshot[] = [];
  let lastBatchEndedAt: number | null = null;
  return {
    enabled: false,
    experiments: {
      stallThresholdMs: DEFAULT_STALL_THRESHOLD_MS,
    },
    nullStages: createNullStages(),
    beginBatch(pointCount, branchCount, kindArg, ownerLabel) {
      const kind: BrushPerfBatchKind = kindArg ?? "moveMany";
      if (!this.enabled) return;
      if (activeBatch) {
        throw new Error("Brush perf batch is already active");
      }
      const startedAt = performance.now();
      activeBatch = {
        kind,
        ownerLabel,
        startedAt,
        timestampMs: startedAt,
        gapMs:
          lastBatchEndedAt === null
            ? null
            : Math.max(0, startedAt - lastBatchEndedAt),
        pointCount,
        branchCount,
        stages: createBatchStageCounters(),
        events:
          kind === "strokeStart"
            ? recentEvents.map((event) => ({ ...event }))
            : [],
        forceRecord: false,
      };
    },
    endBatch() {
      if (!activeBatch) return;
      if (!this.enabled) {
        activeBatch = null;
        return;
      }
      const endedAt = performance.now();
      const batch = activeBatch;
      activeBatch = null;
      lastBatchEndedAt = endedAt;
      const totalMs = Math.max(0, endedAt - batch.startedAt);
      if (
        !batch.forceRecord &&
        totalMs <= getStallThresholdMs(this.experiments.stallThresholdMs)
      ) {
        return;
      }
      stalls.push({
        kind: batch.kind,
        timestampMs: batch.timestampMs,
        gapMs: batch.gapMs,
        totalMs,
        pointCount: batch.pointCount,
        branchCount: batch.branchCount,
        stages: Object.fromEntries(
          BRUSH_PERF_BATCH_STAGE_NAMES.map((name) => [
            name,
            { ...batch.stages[name] },
          ]),
        ) as Record<BrushPerfBatchStageName, BrushPerfStageSnapshot>,
        events: batch.events.map((event) => ({ ...event })),
      });
      if (stalls.length > STALL_BUFFER_CAPACITY) {
        stalls = stalls.slice(-STALL_BUFFER_CAPACITY);
      }
    },
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
      if (activeBatch && isBatchStageName(name)) {
        const batchCounter = activeBatch.stages[name];
        batchCounter.count++;
        batchCounter.totalMs += elapsedMs;
      }
    },
    recordSample(name, value) {
      if (!this.enabled) return;
      samples[name].push(value);
    },
    recordEvent(name, details = {}) {
      if (!this.enabled) return;
      const event = toEventSnapshot(name, details);
      recentEvents.push(event);
      if (recentEvents.length > RECENT_EVENT_BUFFER_CAPACITY) {
        recentEvents = recentEvents.slice(-RECENT_EVENT_BUFFER_CAPACITY);
      }
      if (activeBatch) {
        activeBatch.events.push(event);
        if (details.forceRecord) activeBatch.forceRecord = true;
      }
    },
    reset() {
      stages = createStageCounters();
      samples = createSamples();
      stageSeries = Object.fromEntries(
        BRUSH_PERF_STAGE_NAMES.map((name) => [name, [] as number[]]),
      ) as Record<BrushPerfStageName, number[]>;
      activeBatch = null;
      stalls = [];
      recentEvents = [];
      lastBatchEndedAt = null;
    },
    snapshot() {
      return {
        enabled: this.enabled,
        recentEvents: recentEvents.map((event) => ({ ...event })),
        nullStages: { ...this.nullStages },
        stages: Object.fromEntries(
          BRUSH_PERF_STAGE_NAMES.map((name) => [name, { ...stages[name] }]),
        ) as Record<BrushPerfStageName, BrushPerfStageSnapshot>,
        samples: {
          emissions: [...samples.emissions],
          fieldCells: [...samples.fieldCells],
          bboxAreas: [...samples.bboxAreas],
          layerReadPixels: [...samples.layerReadPixels],
          samplingCopyPixels: [...samples.samplingCopyPixels],
          checkpoints: [...samples.checkpoints],
          gpuResidencyHit: [...samples.gpuResidencyHit],
          gpuBranches: [...samples.gpuBranches],
          gpuCommitPixels: [...samples.gpuCommitPixels],
          gpuCommitDraws: [...samples.gpuCommitDraws],
        },
        stageSeries: Object.fromEntries(
          BRUSH_PERF_STAGE_NAMES.map((name) => [name, [...stageSeries[name]]]),
        ) as unknown as Record<BrushPerfStageName, readonly number[]>,
        stalls: stalls.map((stall) => ({
          ...stall,
          stages: Object.fromEntries(
            BRUSH_PERF_BATCH_STAGE_NAMES.map((name) => [
              name,
              { ...stall.stages[name] },
            ]),
          ) as Record<BrushPerfBatchStageName, BrushPerfStageSnapshot>,
          events: stall.events.map((event) => ({ ...event })),
        })),
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

export function perfStage<T>(name: BrushPerfStageName, operation: () => T): T {
  if (!brushPerfDebug.enabled) return operation();
  const startedAt = performance.now();
  const result = operation();
  brushPerfDebug.recordStage(name, startedAt);
  return result;
}

export function perfElapsed(name: BrushPerfStageName, elapsedMs: number): void {
  if (!brushPerfDebug.enabled) return;
  brushPerfDebug.recordElapsed(name, elapsedMs);
}

export function perfSample(name: BrushPerfSampleName, value: number): void {
  if (!brushPerfDebug.enabled) return;
  brushPerfDebug.recordSample(name, value);
}

export function perfMark(
  name: BrushPerfEventName,
  details?: BrushPerfEventDetails,
): void {
  if (!brushPerfDebug.enabled) return;
  brushPerfDebug.recordEvent(name, details);
}
