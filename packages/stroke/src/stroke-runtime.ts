import {
  clearLayer,
  compileExpand,
  createLayer,
  renderPendingLayer,
  timeSpacingMsFromRate,
} from "@headless-paint/engine";
import type {
  BrushRenderState,
  BrushTipRegistry,
  CompiledExpand,
  ExpandConfig,
  Layer,
  StrokePoint,
  StrokeStyle,
} from "@headless-paint/engine";
import {
  compileFilterPipeline,
  createFilterPipelineState,
  finalizePipeline,
  processPoint,
} from "@headless-paint/input";
import type {
  CompiledFilterPipeline,
  FilterPipelineConfig,
  FilterPipelineState,
  InputPoint,
} from "@headless-paint/input";
import {
  createIncrementalStrokeRenderer,
  createInitialBrushState,
} from "./incremental-stroke";
import type { IncrementalStrokeRenderer } from "./incremental-stroke";
import {
  addPointToSession,
  createStrokeCommand,
  startStrokeSession,
} from "./session";
import { createInitialStrokePhase, transitionStroke } from "./stroke-machine";
import type {
  StrokeMachineEffect,
  StrokeMachineEvent,
  StrokePhase,
} from "./stroke-machine";
import type { RenderUpdate, StrokeCommand, StrokeSessionState } from "./types";

export interface StrokeRuntimeDeps {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (id: unknown) => void;
  readonly now: () => number;
  readonly requestRender: () => void;
  readonly onCommit: (command: StrokeCommand) => void;
  readonly onDrawingChanged: (isDrawing: boolean) => void;
  readonly randomSeed?: () => number;
}

export interface StrokeRuntime {
  start(point: InputPoint, config: StrokeStartConfig): void;
  move(point: InputPoint): void;
  confirm(): void;
  end(): void;
  cancel(): void;
  dispose(): void;
  readonly isDrawing: boolean;
}

export interface StrokeStartConfig {
  readonly layer: Layer;
  readonly pendingLayer: Layer;
  readonly style: StrokeStyle;
  readonly filterPipeline: FilterPipelineConfig;
  readonly expand: ExpandConfig;
  readonly alphaLocked: boolean;
  readonly brushSeed?: number;
  readonly pendingOnly?: boolean;
  /** image tip ブラシ（ImageTipConfig）に必須。未指定だと該当ブラシで engine が throw する */
  readonly tipRegistry?: BrushTipRegistry;
}

interface FrozenStrokeConfig {
  readonly layer: Layer;
  readonly pendingLayer: Layer;
  readonly style: StrokeStyle;
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  readonly compiledExpand: CompiledExpand;
  readonly alphaLocked: boolean;
  readonly pendingOnly: boolean;
}

interface PendingStart {
  readonly point: InputPoint;
  readonly config: StrokeStartConfig;
}

const DEFAULT_RANDOM_SEED = (): number => (Math.random() * 0xffffffff) | 0;

export function createStrokeRuntime(deps: StrokeRuntimeDeps): StrokeRuntime {
  const randomSeed = deps.randomSeed ?? DEFAULT_RANDOM_SEED;

  let machine: StrokePhase = createInitialStrokePhase();
  let disposed = false;
  let drawing = false;
  let emissionTimer: unknown | null = null;
  let pendingStart: PendingStart | null = null;

  let strokeSession: StrokeSessionState | null = null;
  let filterState: FilterPipelineState | null = null;
  let inputPoints: InputPoint[] = [];
  let brushState: BrushRenderState | undefined;
  let brushSeed = 0;
  let renderer: IncrementalStrokeRenderer | null = null;
  let rendererFedPointCount = 0;
  let committedSnapshot: Layer | undefined;
  let samplingLayer: Layer | undefined;
  let frozenConfig: FrozenStrokeConfig | null = null;
  let currentRenderUpdate: RenderUpdate | null = null;
  let lastInputPoint: InputPoint | null = null;

  const runtime: StrokeRuntime = {
    start(point, config) {
      if (disposed) return;
      pendingStart = { point, config };
      const result = transition({
        type: "start",
        layerId: config.layer.id,
        pendingOnly: config.pendingOnly ?? false,
        hasEmission: getEmissionIntervalMs(config.style) !== undefined,
      });
      executeEffects(result.effects, "start");
      pendingStart = null;
    },
    move(point) {
      if (disposed || machine.phase !== "active" || !strokeSession) return;
      feedPoint(point);
      const result = transition({ type: "move" });
      executeEffects(result.effects, "move");
    },
    confirm() {
      if (disposed) return;
      const result = transition({ type: "confirm" });
      executeEffects(result.effects, "confirm");
    },
    end() {
      if (disposed) return;
      const result = transition({ type: "end" });
      executeEffects(result.effects, "end");
    },
    cancel() {
      if (disposed) return;
      const result = transition({ type: "cancel" });
      executeEffects(result.effects, "cancel");
    },
    dispose() {
      if (disposed) return;
      const result = transition({ type: "dispose" });
      executeEffects(result.effects, "dispose");
      releaseSession();
      disposed = true;
    },
    get isDrawing() {
      return drawing;
    },
  };

  function transition(event: StrokeMachineEvent) {
    const result = transitionStroke(machine, event);
    machine = result.next;
    return result;
  }

  function executeEffects(
    effects: readonly StrokeMachineEffect[],
    eventType: StrokeMachineEvent["type"],
  ): void {
    for (const effect of effects) {
      switch (effect.type) {
        case "snapshot-layer":
          snapshotLayer();
          break;
        case "append-committed":
          appendCommitted(eventType);
          break;
        case "render-pending":
          renderPending();
          break;
        case "schedule-emission":
          scheduleEmission();
          break;
        case "cancel-emission":
          cancelEmission();
          break;
        case "schedule-render":
          deps.requestRender();
          break;
        case "finalize-commit":
          finalizeCommit();
          break;
        case "restore-snapshot":
          restoreSnapshot(eventType === "start");
          break;
        case "drawing-changed":
          drawing = effect.isDrawing;
          deps.onDrawingChanged(effect.isDrawing);
          break;
      }
    }
  }

  function snapshotLayer(): void {
    if (pendingStart) {
      installPendingStart(pendingStart);
    }
    if (!frozenConfig) return;
    committedSnapshot = cloneLayerContent(frozenConfig.layer);
    samplingLayer = needsSamplingLayer(frozenConfig.style)
      ? committedSnapshot
      : undefined;
  }

  function installPendingStart(start: PendingStart): void {
    const compiledFilterPipeline = compileFilterPipeline(
      start.config.filterPipeline,
    );
    const compiledExpand = compileExpand(start.config.expand);
    const nextFilterState = createFilterPipelineState(compiledFilterPipeline);
    const filterResult = processPoint(
      nextFilterState,
      start.point,
      compiledFilterPipeline,
    );
    const strokeResult = startStrokeSession(
      filterResult.output,
      start.config.style,
      start.config.expand,
    );
    const initialBrush = createInitialBrushState(
      start.config.style,
      start.config.brushSeed ?? randomSeed(),
      start.config.tipRegistry,
    );

    frozenConfig = {
      layer: start.config.layer,
      pendingLayer: start.config.pendingLayer,
      style: start.config.style,
      compiledFilterPipeline,
      compiledExpand,
      alphaLocked: start.config.alphaLocked,
      pendingOnly: start.config.pendingOnly ?? false,
    };
    strokeSession = strokeResult.state;
    filterState = filterResult.state;
    inputPoints = [start.point];
    brushState = initialBrush.brushState;
    brushSeed = initialBrush.brushSeed;
    renderer = createIncrementalStrokeRenderer({
      layer: start.config.layer,
      style: start.config.style,
      filterPipeline: start.config.filterPipeline,
      expand: start.config.expand,
      brushSeed,
      alphaLocked: start.config.alphaLocked,
      registry: start.config.tipRegistry,
      onRenderUpdate: (update) => {
        brushState = update.brushState;
      },
    });
    rendererFedPointCount = 0;
    committedSnapshot = undefined;
    samplingLayer = undefined;
    currentRenderUpdate = strokeResult.renderUpdate;
    lastInputPoint = start.point;
    start.config.pendingLayer.meta.compositeOperation =
      getPendingCompositeOperation(start.config.style);
  }

  function feedPoint(point: InputPoint): void {
    if (!frozenConfig || !filterState || !strokeSession) return;
    const filterResult = processPoint(
      filterState,
      point,
      frozenConfig.compiledFilterPipeline,
    );
    const strokeResult = addPointToSession(strokeSession, filterResult.output);
    filterState = filterResult.state;
    strokeSession = strokeResult.state;
    inputPoints.push(point);
    currentRenderUpdate = strokeResult.renderUpdate;
    lastInputPoint = point;
  }

  function appendCommitted(eventType: StrokeMachineEvent["type"]): void {
    if (!frozenConfig || !strokeSession || !renderer) return;
    if (eventType === "confirm") {
      feedPendingRendererPoints();
      frozenConfig = { ...frozenConfig, pendingOnly: false };
      return;
    }
    feedPendingRendererPoints();
  }

  function feedPendingRendererPoints(): void {
    if (!renderer) return;
    while (rendererFedPointCount < inputPoints.length) {
      const point = inputPoints[rendererFedPointCount];
      if (!point) return;
      renderer.feed(point);
      rendererFedPointCount++;
    }
  }

  function renderPending(): void {
    if (!frozenConfig || !strokeSession || !currentRenderUpdate) return;
    renderPendingLayer(
      frozenConfig.pendingLayer,
      frozenConfig.pendingOnly
        ? buildLiveStrokePoints(strokeSession)
        : currentRenderUpdate.currentPending,
      frozenConfig.style,
      frozenConfig.compiledExpand,
      brushState,
      samplingLayer ?? frozenConfig.layer,
    );
  }

  function scheduleEmission(): void {
    cancelEmission();
    if (!frozenConfig) return;
    const intervalMs = getEmissionIntervalMs(frozenConfig.style);
    if (intervalMs === undefined) return;
    emissionTimer = deps.setTimeout(() => {
      emissionTimer = null;
      const last = lastInputPoint;
      if (!strokeSession || !last || disposed) return;
      runtime.move({ ...last, timestamp: deps.now() });
    }, intervalMs);
  }

  function cancelEmission(): void {
    if (emissionTimer === null) return;
    deps.clearTimeout(emissionTimer);
    emissionTimer = null;
  }

  function finalizeCommit(): void {
    if (!frozenConfig || !filterState || !strokeSession) {
      releaseSession();
      return;
    }
    const finalOutput = finalizePipeline(
      filterState,
      frozenConfig.compiledFilterPipeline,
    );
    const finalStrokeResult = addPointToSession(strokeSession, finalOutput);
    strokeSession = finalStrokeResult.state;
    currentRenderUpdate = finalStrokeResult.renderUpdate;
    feedPendingRendererPoints();
    renderer?.finalize();

    const totalPoints = finalStrokeResult.state.allCommitted.length;
    if (totalPoints >= 1) {
      deps.onCommit(
        createStrokeCommand(
          frozenConfig.layer.id,
          inputPoints,
          frozenConfig.compiledFilterPipeline.config,
          finalStrokeResult.state.expand,
          frozenConfig.style,
          brushSeed,
          frozenConfig.alphaLocked,
        ),
      );
    }

    clearPendingLayer();
    releaseSession();
  }

  function restoreSnapshot(preservePendingStart: boolean): void {
    if (frozenConfig && committedSnapshot) {
      restoreLayerContent(frozenConfig.layer, committedSnapshot);
    }
    clearPendingLayer();
    releaseSession(preservePendingStart);
  }

  function clearPendingLayer(): void {
    if (!frozenConfig) return;
    clearLayer(frozenConfig.pendingLayer);
    frozenConfig.pendingLayer.meta.compositeOperation = undefined;
  }

  function releaseSession(preservePendingStart = false): void {
    strokeSession = null;
    filterState = null;
    inputPoints = [];
    brushState = undefined;
    brushSeed = 0;
    renderer = null;
    rendererFedPointCount = 0;
    committedSnapshot = undefined;
    samplingLayer = undefined;
    frozenConfig = null;
    currentRenderUpdate = null;
    lastInputPoint = null;
    if (!preservePendingStart) {
      pendingStart = null;
    }
  }

  return runtime;
}

function getEmissionIntervalMs(style: StrokeStyle): number | undefined {
  if (style.brush.type === "round-pen" || style.brush.type === "bristle") {
    return undefined;
  }
  return timeSpacingMsFromRate(style.brush.dynamics.emissionsPerSecond);
}

function needsSamplingLayer(style: StrokeStyle): boolean {
  return (
    (style.brush.type === "stamp" || style.brush.type === "bristle") &&
    !!style.brush.mixing?.enabled
  );
}

function cloneLayerContent(layer: Layer): Layer {
  const snapshot = createLayer(layer.width, layer.height);
  snapshot.ctx.drawImage(layer.canvas, 0, 0);
  return snapshot;
}

function restoreLayerContent(layer: Layer, snapshot: Layer): void {
  clearLayer(layer);
  layer.ctx.drawImage(snapshot.canvas, 0, 0);
}

function getPendingCompositeOperation(
  style: StrokeStyle,
): GlobalCompositeOperation {
  return style.compositeOperation;
}

function buildLiveStrokePoints(
  session: StrokeSessionState,
): readonly StrokePoint[] {
  return [
    ...toStrokePoints(session.allCommitted),
    ...toStrokePoints(session.currentPending),
  ];
}

function toStrokePoints(points: readonly InputPoint[]): readonly StrokePoint[] {
  return points.map((point) => ({
    x: point.x,
    y: point.y,
    pressure: point.pressure,
    timestamp: point.timestamp,
  }));
}
