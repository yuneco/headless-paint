import type {
  BrushRenderState,
  BrushTipRegistry,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import {
  appendToCommittedLayer,
  compileExpand,
  copyLayerPixels,
  createLayer,
  generateBrushTip,
  isBrushMixingActive,
} from "@headless-paint/engine";
import {
  compileFilterPipeline,
  createFilterPipelineState,
  finalizePipeline,
  processPoint,
} from "@headless-paint/input";
import type {
  FilterPipelineConfig,
  FilterPipelineState,
  InputPoint,
} from "@headless-paint/input";
import { addPointToSession, startStrokeSession } from "./session";
import type { RenderUpdate, StrokeSessionState } from "./types";

export interface IncrementalStrokeRendererConfig {
  readonly layer: Layer;
  readonly style: StrokeStyle;
  readonly filterPipeline: FilterPipelineConfig;
  readonly expand: ExpandConfig;
  readonly brushSeed: number;
  readonly alphaLocked: boolean;
  readonly sourceLayer?: Layer;
  readonly registry?: BrushTipRegistry;
  readonly onRenderUpdate?: (update: IncrementalStrokeRenderUpdate) => void;
}

export interface IncrementalStrokeRenderUpdate {
  readonly session: StrokeSessionState;
  readonly renderUpdate: RenderUpdate;
  readonly brushState: BrushRenderState | undefined;
}

export interface IncrementalStrokeRenderer {
  feed(point: InputPoint): void;
  feedMany(points: readonly InputPoint[]): void;
  finalize(): void;
}

const BRISTLE_BATCH_INTERVAL_MS = 32;

export function createIncrementalStrokeRenderer(
  config: IncrementalStrokeRendererConfig,
): IncrementalStrokeRenderer {
  const compiledFilterPipeline = compileFilterPipeline(config.filterPipeline);
  const compiledExpand = compileExpand(config.expand);
  const samplingLayer =
    config.sourceLayer ?? createSamplingLayer(config.layer, config.style);
  const gpuRuntime = getGpuStrokeRuntime();
  const gpuOwner = {};
  const gpuStrokeActive =
    brushPerfGpuDabEnabled() &&
    config.style.brush.type === "stamp" &&
    isBrushMixingActive(config.style.brush.mixing) &&
    config.style.compositeOperation === "source-over" &&
    !config.alphaLocked &&
    compiledExpand.outputCount === 1 &&
    !!samplingLayer &&
    !!gpuRuntime?.beginStroke(gpuOwner, samplingLayer.canvas);

  let filterState: FilterPipelineState = createFilterPipelineState(
    compiledFilterPipeline,
  );
  let strokeSession: StrokeSessionState | null = null;
  let brushState = createInitialBrushState(
    config.style,
    config.brushSeed,
    config.registry,
  ).brushState;
  let hasFed = false;
  let finalized = false;
  let renderedCommittedCount = 0;
  let pendingBristlePoints: InputPoint[] = [];

  function appendProcessedBatch(
    nextSession: StrokeSessionState,
    lastUpdate: RenderUpdate,
  ): void {
    const nextCommittedCount = nextSession.allCommitted.length;
    const hasNewCommitted = nextCommittedCount > renderedCommittedCount;
    const overlapCount = Math.min(3, renderedCommittedCount);
    const startIndex = Math.max(0, renderedCommittedCount - overlapCount);
    const batchUpdate: RenderUpdate = {
      ...lastUpdate,
      newlyCommitted: hasNewCommitted
        ? nextSession.allCommitted.slice(startIndex).map(toStrokePoint)
        : [],
      committedOverlapCount: hasNewCommitted ? overlapCount : 0,
    };
    const perfDebug = (
      globalThis as typeof globalThis & {
        __hpBrushPerf?: {
          readonly enabled: boolean;
          recordStage(name: string, startedAt: number): void;
        };
      }
    ).__hpBrushPerf;
    const appendStartedAt = perfDebug?.enabled ? performance.now() : 0;
    if (hasNewCommitted) {
      if (gpuStrokeActive) gpuRuntime?.enter(gpuOwner);
      try {
        brushState = appendToCommittedLayer(
          config.layer,
          batchUpdate.newlyCommitted,
          config.style,
          compiledExpand,
          batchUpdate.committedOverlapCount,
          brushState,
          samplingLayer,
          config.alphaLocked,
        );
      } finally {
        if (gpuStrokeActive) gpuRuntime?.leave(gpuOwner);
      }
      renderedCommittedCount = nextCommittedCount;
    }
    if (perfDebug?.enabled) {
      perfDebug.recordStage("appendCommitted", appendStartedAt);
    }
    const callbackStartedAt = perfDebug?.enabled ? performance.now() : 0;
    config.onRenderUpdate?.({
      session: nextSession,
      renderUpdate: batchUpdate,
      brushState,
    });
    if (perfDebug?.enabled) {
      perfDebug.recordStage("renderUpdateCallback", callbackStartedAt);
    }
  }

  function processBatch(points: readonly InputPoint[]): void {
    const perfDebugBatch = (
      globalThis as typeof globalThis & {
        __hpBrushPerf?: {
          readonly enabled: boolean;
          recordStage(name: string, startedAt: number): void;
        };
      }
    ).__hpBrushPerf;
    const batchStartedAt = perfDebugBatch?.enabled ? performance.now() : 0;
    let lastUpdate: RenderUpdate | null = null;
    for (const point of points) {
      const filterResult = processPoint(
        filterState,
        point,
        compiledFilterPipeline,
      );
      filterState = filterResult.state;
      const strokeResult = strokeSession
        ? addPointToSession(strokeSession, filterResult.output)
        : startStrokeSession(filterResult.output, config.style, config.expand);
      strokeSession = strokeResult.state;
      lastUpdate = strokeResult.renderUpdate;
    }
    if (strokeSession && lastUpdate) {
      appendProcessedBatch(strokeSession, lastUpdate);
    }
    if (perfDebugBatch?.enabled) {
      perfDebugBatch.recordStage("processBatch", batchStartedAt);
    }
  }

  function feedMany(points: readonly InputPoint[]): void {
    if (finalized || points.length === 0) return;
    hasFed = true;
    if (config.style.brush.type !== "bristle") {
      for (const point of points) processBatch([point]);
      if (gpuStrokeActive) {
        gpuRuntime?.commitToLayer(gpuOwner, config.layer);
        gpuRuntime?.requestCheckpoint(gpuOwner);
      }
      return;
    }
    for (const point of points) {
      pendingBristlePoints.push(point);
      if (
        shouldFlushBristleBatch(pendingBristlePoints, config.style.lineWidth)
      ) {
        processBatch(pendingBristlePoints);
        pendingBristlePoints = [];
      }
    }
  }

  return {
    feed(point) {
      feedMany([point]);
    },
    feedMany,
    finalize() {
      if (finalized) return;
      if (!hasFed) {
        finalized = true;
        if (gpuStrokeActive) gpuRuntime?.endStroke(gpuOwner);
        return;
      }
      if (pendingBristlePoints.length > 0) {
        processBatch(pendingBristlePoints);
        pendingBristlePoints = [];
      }
      if (!strokeSession) {
        if (gpuStrokeActive) gpuRuntime?.endStroke(gpuOwner);
        return;
      }
      finalized = true;
      const finalOutput = finalizePipeline(filterState, compiledFilterPipeline);
      const strokeResult = addPointToSession(strokeSession, finalOutput);
      strokeSession = strokeResult.state;
      appendProcessedBatch(strokeResult.state, strokeResult.renderUpdate);
      if (gpuStrokeActive) {
        gpuRuntime?.commitToLayer(gpuOwner, config.layer);
        gpuRuntime?.requestCheckpoint(gpuOwner);
        gpuRuntime?.endStroke(gpuOwner);
      }
    },
  };
}

interface GpuStrokeRuntimeBridge {
  beginStroke(owner: object, sourceCanvas: OffscreenCanvas): boolean;
  enter(owner: object): void;
  leave(owner: object): void;
  commitToLayer(owner: object, layer: Layer): void;
  requestCheckpoint(owner: object): void;
  endStroke(owner: object): void;
}

function getGpuStrokeRuntime(): GpuStrokeRuntimeBridge | undefined {
  return (
    globalThis as typeof globalThis & {
      __hpGpuStrokeRuntime?: GpuStrokeRuntimeBridge;
    }
  ).__hpGpuStrokeRuntime;
}

function brushPerfGpuDabEnabled(): boolean {
  return (
    (
      globalThis as typeof globalThis & {
        __hpBrushPerf?: {
          readonly experiments: { readonly gpuDab?: "off" | "webgl2" };
        };
      }
    ).__hpBrushPerf?.experiments.gpuDab === "webgl2"
  );
}

function shouldFlushBristleBatch(
  points: readonly InputPoint[],
  brushSize: number,
): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2) return false;
  if (last.timestamp - first.timestamp >= BRISTLE_BATCH_INTERVAL_MS) {
    return true;
  }
  let traveledDistance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    traveledDistance += Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    );
    if (traveledDistance >= brushSize * 1.5) return true;
  }
  return false;
}

function toStrokePoint(point: InputPoint) {
  return {
    x: point.x,
    y: point.y,
    pressure: point.pressure,
    timestamp: point.timestamp,
  };
}

export function createInitialBrushState(
  style: StrokeStyle,
  seed: number,
  registry?: BrushTipRegistry,
): {
  readonly brushState: BrushRenderState | undefined;
  readonly brushSeed: number;
} {
  if (style.brush.type === "round-pen") {
    return { brushState: undefined, brushSeed: seed };
  }
  if (style.brush.type === "bristle") {
    return {
      brushState: {
        tipCanvas: null,
        seed,
        branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
      },
      brushSeed: seed,
    };
  }
  const tipCanvas =
    style.brush.type === "stamp"
      ? generateBrushTip(
          style.brush.tip,
          Math.ceil(style.lineWidth * 2),
          style.color,
          registry,
        )
      : generateBrushTip(
          style.brush.particle,
          calculateSprayTipSize(style),
          style.color,
          registry,
        );
  return {
    brushState: {
      tipCanvas,
      seed,
      branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
    },
    brushSeed: seed,
  };
}

function calculateSprayTipSize(style: StrokeStyle): number {
  if (style.brush.type !== "spray") return 0;
  const maxScale = style.brush.dynamics.sizeJitterMode === "lognormal" ? 4 : 1;
  return Math.ceil(style.brush.dynamics.particleSize * maxScale);
}

function createSamplingLayer(
  layer: Layer,
  style: StrokeStyle,
): Layer | undefined {
  if (
    (style.brush.type !== "stamp" && style.brush.type !== "bristle") ||
    !isBrushMixingActive(style.brush.mixing)
  ) {
    return undefined;
  }
  const perf = (
    globalThis as typeof globalThis & {
      __hpBrushPerf?: {
        readonly enabled: boolean;
        readonly nullStages: { readonly nullFullCopy: boolean };
        recordStage(name: string, startedAt: number): void;
        recordSample(name: "samplingCopyPixels", value: number): void;
      };
    }
  ).__hpBrushPerf;
  const startedAt = perf?.enabled ? performance.now() : 0;
  if (perf?.nullStages.nullFullCopy) {
    if (perf.enabled) {
      perf.recordStage("samplingLayerCopy", startedAt);
      perf.recordSample("samplingCopyPixels", 0);
    }
    return layer;
  }
  const samplingLayer = createLayer(layer.width, layer.height);
  copyLayerPixels(layer, samplingLayer);
  if (perf?.enabled) {
    perf.recordStage("samplingLayerCopy", startedAt);
    perf.recordSample("samplingCopyPixels", layer.width * layer.height);
  }
  return samplingLayer;
}
