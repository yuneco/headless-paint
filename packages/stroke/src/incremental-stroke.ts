import type {
  BrushAccelerator,
  BrushRenderState,
  BrushTipRegistry,
  ExpandConfig,
  GpuStrokeOwnerLabel,
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
import { getBrushPerfDebug, perfSample, perfStage } from "./perf-debug";
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
  readonly accelerator?: BrushAccelerator | null;
  readonly gpuOwnerLabel?: GpuStrokeOwnerLabel;
  readonly restoreLayerOnGpuLoss?: () => void;
  readonly onRenderUpdate?: (update: IncrementalStrokeRenderUpdate) => void;
}

export interface IncrementalStrokeRenderUpdate {
  readonly session: StrokeSessionState;
  readonly renderUpdate: RenderUpdate;
  readonly brushState: BrushRenderState | undefined;
}

export interface IncrementalStrokeRenderer {
  readonly usesGpu: boolean;
  feed(point: InputPoint): void;
  feedMany(points: readonly InputPoint[]): void;
  finalize(): void;
  /** Abandon the stroke and report whether GPU restored the committed layer. */
  cancel(): boolean;
}

const BRISTLE_BATCH_INTERVAL_MS = 32;

export function createIncrementalStrokeRenderer(
  config: IncrementalStrokeRendererConfig,
): IncrementalStrokeRenderer {
  const compiledFilterPipeline = compileFilterPipeline(config.filterPipeline);
  const compiledExpand = compileExpand(config.expand);
  const gpuRuntime = getGpuStrokeRuntime(config.accelerator);
  const gpuOwner = {
    label: config.gpuOwnerLabel ?? "live",
    startedAtMs: 0,
  };
  const gpuStrokeEligible =
    gpuRuntime !== null &&
    ((config.style.brush.type === "stamp" &&
      isBrushMixingActive(config.style.brush.mixing)) ||
      config.style.brush.type === "bristle") &&
    config.style.compositeOperation === "source-over" &&
    !config.alphaLocked &&
    (gpuRuntime?.supportsBranchCount(compiledExpand.outputCount) ?? false);
  const perfDebug = getBrushPerfDebug();
  if (gpuStrokeEligible) {
    perfDebug?.beginBatch(
      0,
      compiledExpand.outputCount,
      "strokeStart",
      config.gpuOwnerLabel ?? "live",
    );
  }
  let gpuResidencyHit = false;
  let samplingLayer: Layer | undefined;
  let gpuStrokeActive = false;
  try {
    gpuResidencyHit =
      gpuStrokeEligible && !!gpuRuntime?.isLayerResident(config.layer);
    samplingLayer =
      config.sourceLayer ??
      (gpuResidencyHit
        ? undefined
        : createSamplingLayer(config.layer, config.style));
    if (gpuStrokeEligible) {
      gpuOwner.startedAtMs = performance.now();
      gpuStrokeActive = !!gpuRuntime?.beginStroke(
        gpuOwner,
        config.layer,
        gpuResidencyHit
          ? undefined
          : (samplingLayer?.canvas ?? config.layer.canvas),
        compiledExpand.outputCount,
      );
    }
    if (gpuStrokeActive) samplingLayer = undefined;
  } finally {
    if (gpuStrokeEligible) perfDebug?.endBatch();
  }

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
  const gpuInputPoints: InputPoint[] = [];
  let gpuStrokeLost = false;

  function detectGpuStrokeLoss(): boolean {
    if (!gpuStrokeActive) return false;
    gpuStrokeLost ||= gpuRuntime?.isStrokeLost(gpuOwner) ?? true;
    return gpuStrokeLost;
  }

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
    perfStage("appendCommitted", () => {
      if (hasNewCommitted) {
        if (!detectGpuStrokeLoss()) {
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
              config.accelerator,
            );
            if (!gpuStrokeActive) {
              config.accelerator?.invalidate(config.layer, "cpuBrush");
            }
          } catch (error) {
            if (!detectGpuStrokeLoss()) throw error;
          } finally {
            if (gpuStrokeActive) gpuRuntime?.leave(gpuOwner);
          }
        }
        renderedCommittedCount = nextCommittedCount;
      }
    });
    perfStage("renderUpdateCallback", () => {
      if (!gpuStrokeLost) {
        config.onRenderUpdate?.({
          session: nextSession,
          renderUpdate: batchUpdate,
          brushState,
        });
      }
    });
  }

  function processBatch(points: readonly InputPoint[]): void {
    perfStage("processBatch", () => {
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
          : startStrokeSession(
              filterResult.output,
              config.style,
              config.expand,
            );
        strokeSession = strokeResult.state;
        lastUpdate = strokeResult.renderUpdate;
      }
      if (strokeSession && lastUpdate) {
        appendProcessedBatch(strokeSession, lastUpdate);
      }
    });
  }

  function feedMany(points: readonly InputPoint[]): void {
    if (finalized || points.length === 0) return;
    hasFed = true;
    if (gpuStrokeActive) gpuInputPoints.push(...points);
    if (config.style.brush.type !== "bristle") {
      for (const point of points) processBatch([point]);
      if (gpuStrokeActive && !detectGpuStrokeLoss()) {
        gpuRuntime?.commitToLayer(gpuOwner, config.layer);
        detectGpuStrokeLoss();
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
        if (gpuStrokeActive && !detectGpuStrokeLoss()) {
          gpuRuntime?.commitToLayer(gpuOwner, config.layer);
          detectGpuStrokeLoss();
        }
      }
    }
  }

  return {
    usesGpu: gpuStrokeActive,
    feed(point) {
      feedMany([point]);
    },
    feedMany,
    cancel() {
      if (finalized) return false;
      finalized = true;
      if (!gpuStrokeActive) return false;
      const restoredOnGpu =
        !detectGpuStrokeLoss() && (gpuRuntime?.cancelStroke(gpuOwner) ?? false);
      gpuRuntime?.endStroke(gpuOwner);
      return restoredOnGpu && !gpuStrokeLost;
    },
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
        if (!detectGpuStrokeLoss()) {
          gpuRuntime?.commitToLayer(gpuOwner, config.layer);
          detectGpuStrokeLoss();
        }
        gpuRuntime?.endStroke(gpuOwner);
        if (gpuStrokeLost) recoverLostGpuStroke();
      }
    },
  };

  function recoverLostGpuStroke(): void {
    config.restoreLayerOnGpuLoss?.();
    let recoveredUpdate: IncrementalStrokeRenderUpdate | undefined;
    const cpuRenderer = createIncrementalStrokeRenderer({
      ...config,
      sourceLayer: undefined,
      accelerator: null,
      restoreLayerOnGpuLoss: undefined,
      onRenderUpdate: (update) => {
        recoveredUpdate = update;
      },
    });
    cpuRenderer.feedMany(gpuInputPoints);
    cpuRenderer.finalize();
    if (recoveredUpdate) config.onRenderUpdate?.(recoveredUpdate);
  }
}

interface GpuStrokeRuntimeBridge {
  supportsBranchCount(branchCount: number): boolean;
  beginStroke(
    owner: object,
    layer: Layer,
    sourceCanvas?: OffscreenCanvas,
    branchCount?: number,
  ): boolean;
  enter(owner: object): void;
  leave(owner: object): void;
  commitToLayer(owner: object, layer: Layer): void;
  cancelStroke(owner: object): boolean;
  endStroke(owner: object): void;
  isStrokeLost(owner: object): boolean;
  isLayerResident(layer: Layer): boolean;
}

function getGpuStrokeRuntime(
  accelerator: BrushAccelerator | null | undefined,
): GpuStrokeRuntimeBridge | null {
  if (!accelerator) return null;
  const runtime = accelerator as BrushAccelerator &
    Partial<GpuStrokeRuntimeBridge>;
  return typeof runtime.beginStroke === "function"
    ? (runtime as GpuStrokeRuntimeBridge)
    : null;
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
  const perf = getBrushPerfDebug();
  if (perf?.nullStages.nullFullCopy) {
    perfStage("samplingLayerCopy", () => undefined);
    perfSample("samplingCopyPixels", 0);
    return layer;
  }
  return copySamplingLayer(layer);
}

function copySamplingLayer(layer: Layer): Layer {
  const samplingLayer = perfStage("samplingLayerCopy", () => {
    const next = createLayer(layer.width, layer.height);
    copyLayerPixels(layer, next);
    return next;
  });
  perfSample("samplingCopyPixels", layer.width * layer.height);
  return samplingLayer;
}
