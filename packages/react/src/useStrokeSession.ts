import {
  appendToCommittedLayer,
  clearLayer,
  createLayer,
  renderPendingLayer,
} from "@headless-paint/core";
import type {
  BrushRenderState,
  BrushTipRegistry,
  CompiledExpand,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/core";
import { generateBrushTip } from "@headless-paint/core";
import {
  compileFilterPipeline,
  createFilterPipelineState,
  finalizePipeline,
  processPoint,
} from "@headless-paint/core";
import type {
  CompiledFilterPipeline,
  FilterPipelineConfig,
  FilterPipelineState,
  InputPoint,
} from "@headless-paint/core";
import { addPointToSession, startStrokeSession } from "@headless-paint/core";
import type { StrokeSessionState } from "@headless-paint/core";
import { useCallback, useMemo, useRef, useState } from "react";

export interface StrokeCompleteData {
  readonly inputPoints: readonly InputPoint[];
  readonly filterPipelineConfig: FilterPipelineConfig;
  readonly expandConfig: ExpandConfig;
  readonly strokeStyle: StrokeStyle;
  readonly brushSeed: number;
  readonly totalPoints: number;
}

export interface StrokeStartOptions {
  readonly pendingOnly?: boolean;
  readonly straightLine?: boolean;
}

export interface UseStrokeSessionConfig {
  readonly layer: Layer | null;
  readonly pendingLayer: Layer;
  readonly strokeStyle: StrokeStyle;
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  readonly expandConfig: ExpandConfig;
  readonly compiledExpand: CompiledExpand;
  readonly onStrokeComplete?: (data: StrokeCompleteData) => void;
  readonly registry?: BrushTipRegistry;
}

export interface UseStrokeSessionResult {
  readonly onStrokeStart: (
    point: InputPoint,
    options?: StrokeStartOptions,
  ) => void;
  readonly onStrokeMove: (point: InputPoint) => void;
  readonly onStrokeEnd: () => void;
  readonly onDrawConfirm: () => void;
  readonly onDrawCancel: () => void;
  readonly canDraw: boolean;
  readonly renderVersion: number;
  readonly strokePoints: readonly InputPoint[];
  readonly isDrawing: boolean;
}

interface SessionInternal {
  strokeSession: StrokeSessionState;
  filterState: FilterPipelineState;
  inputPoints: InputPoint[];
  compiledExpand: CompiledExpand;
  compiledFilterPipeline: CompiledFilterPipeline;
  layerId: string;
  brushState?: BrushRenderState;
  brushSeed: number;
  samplingLayer?: Layer;
  committedSnapshot?: Layer;
}

function toStrokePoints(points: readonly InputPoint[]) {
  return points.map((point) => ({
    x: point.x,
    y: point.y,
    pressure: point.pressure,
  }));
}

function buildLiveStrokePoints(session: StrokeSessionState) {
  return [
    ...toStrokePoints(session.allCommitted),
    ...toStrokePoints(session.currentPending),
  ];
}

/**
 * スタンプブラシ用の初期 BrushRenderState を生成する。
 * round-pen では undefined を返す（brushState 不要）。
 */
function createInitialBrushState(
  style: StrokeStyle,
  registry?: BrushTipRegistry,
): {
  brushState: BrushRenderState | undefined;
  brushSeed: number;
} {
  if (style.brush.type !== "stamp") {
    return { brushState: undefined, brushSeed: 0 };
  }
  const brushSeed = (Math.random() * 0xffffffff) | 0;
  const tipCanvas = generateBrushTip(
    style.brush.tip,
    Math.ceil(style.lineWidth * 2),
    style.color,
    registry,
  );
  return {
    brushState: {
      accumulatedDistance: 0,
      tipCanvas,
      seed: brushSeed,
      stampCount: 0,
    },
    brushSeed,
  };
}

function needsSamplingLayer(style: StrokeStyle): boolean {
  return style.brush.type === "stamp" && !!style.brush.mixing?.enabled;
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
  return needsSamplingLayer(style) && style.compositeOperation === "source-over"
    ? "copy"
    : style.compositeOperation;
}

export function useStrokeSession(
  config: UseStrokeSessionConfig,
): UseStrokeSessionResult {
  const {
    layer,
    pendingLayer,
    strokeStyle,
    compiledFilterPipeline,
    expandConfig,
    compiledExpand,
    onStrokeComplete,
    registry,
  } = config;

  const [renderVersion, setRenderVersion] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);

  const sessionRef = useRef<SessionInternal | null>(null);
  const pendingOnlyRef = useRef(false);
  const strokePointsRef = useRef<InputPoint[]>([]);

  // refs で最新値をコールバック内から参照
  const expandConfigRef = useRef(expandConfig);
  expandConfigRef.current = expandConfig;
  const compiledExpandRef = useRef(compiledExpand);
  compiledExpandRef.current = compiledExpand;
  const strokeStyleRef = useRef(strokeStyle);
  strokeStyleRef.current = strokeStyle;
  const onStrokeCompleteRef = useRef(onStrokeComplete);
  onStrokeCompleteRef.current = onStrokeComplete;
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const registryRef = useRef(registry);
  registryRef.current = registry;

  const canDraw = layer?.meta.visible ?? false;

  const bumpRenderVersion = useCallback(
    () => setRenderVersion((n) => n + 1),
    [],
  );

  const straightLinePipeline = useMemo(
    () =>
      compileFilterPipeline({
        filters: [{ type: "straight-line", config: {} }],
      }),
    [],
  );

  const onStrokeStart = useCallback(
    (inputPoint: InputPoint, options?: StrokeStartOptions) => {
      const currentLayer = layerRef.current;
      if (!currentLayer || !currentLayer.meta.visible) return;
      pendingOnlyRef.current = options?.pendingOnly ?? false;

      const compiled = compiledExpandRef.current;
      const style = strokeStyleRef.current;
      const activePipeline = options?.straightLine
        ? straightLinePipeline
        : compiledFilterPipeline;
      const filterState = createFilterPipelineState(activePipeline);
      const filterResult = processPoint(
        filterState,
        inputPoint,
        activePipeline,
      );

      const strokeResult = startStrokeSession(
        filterResult.output,
        style,
        expandConfigRef.current,
      );

      const { brushState: initialBrushState, brushSeed } =
        createInitialBrushState(style, registryRef.current);
      const committedSnapshot = pendingOnlyRef.current
        ? undefined
        : cloneLayerContent(currentLayer);
      const samplingLayer = needsSamplingLayer(style)
        ? committedSnapshot
        : undefined;

      sessionRef.current = {
        strokeSession: strokeResult.state,
        filterState: filterResult.state,
        inputPoints: [inputPoint],
        compiledExpand: compiled,
        compiledFilterPipeline: activePipeline,
        layerId: currentLayer.id,
        brushState: initialBrushState,
        brushSeed,
        samplingLayer,
        committedSnapshot,
      };

      if (!pendingOnlyRef.current) {
        const brushState = appendToCommittedLayer(
          currentLayer,
          strokeResult.renderUpdate.newlyCommitted,
          style,
          compiled,
          strokeResult.renderUpdate.committedOverlapCount,
          initialBrushState,
          samplingLayer,
        );
        sessionRef.current.brushState = brushState;
      }

      pendingLayer.meta.compositeOperation =
        getPendingCompositeOperation(style);
      renderPendingLayer(
        pendingLayer,
        pendingOnlyRef.current
          ? buildLiveStrokePoints(strokeResult.state)
          : strokeResult.renderUpdate.currentPending,
        style,
        compiled,
        sessionRef.current.brushState,
        samplingLayer ?? currentLayer,
        needsSamplingLayer(style) ? currentLayer : undefined,
      );

      strokePointsRef.current = [inputPoint];
      setIsDrawing(true);
      bumpRenderVersion();
    },
    [
      compiledFilterPipeline,
      straightLinePipeline,
      pendingLayer,
      bumpRenderVersion,
    ],
  );

  const onStrokeMove = useCallback(
    (inputPoint: InputPoint) => {
      if (!sessionRef.current) return;

      // layer の最新を参照（描画中にレイヤーが変わることは通常ないが安全のため）
      const currentLayer = layerRef.current;
      if (!currentLayer || currentLayer.id !== sessionRef.current.layerId)
        return;

      const style = strokeStyleRef.current;
      const filterResult = processPoint(
        sessionRef.current.filterState,
        inputPoint,
        sessionRef.current.compiledFilterPipeline,
      );

      const strokeResult = addPointToSession(
        sessionRef.current.strokeSession,
        filterResult.output,
      );

      sessionRef.current.strokeSession = strokeResult.state;
      sessionRef.current.filterState = filterResult.state;
      sessionRef.current.inputPoints.push(inputPoint);
      strokePointsRef.current = [...strokePointsRef.current, inputPoint];

      if (!pendingOnlyRef.current) {
        const brushState = appendToCommittedLayer(
          currentLayer,
          strokeResult.renderUpdate.newlyCommitted,
          style,
          sessionRef.current.compiledExpand,
          strokeResult.renderUpdate.committedOverlapCount,
          sessionRef.current.brushState,
          sessionRef.current.samplingLayer,
        );
        sessionRef.current.brushState = brushState;
      }

      renderPendingLayer(
        pendingLayer,
        pendingOnlyRef.current
          ? buildLiveStrokePoints(strokeResult.state)
          : strokeResult.renderUpdate.currentPending,
        style,
        sessionRef.current.compiledExpand,
        sessionRef.current.brushState,
        sessionRef.current.samplingLayer ?? currentLayer,
        needsSamplingLayer(style) ? currentLayer : undefined,
      );

      bumpRenderVersion();
    },
    [pendingLayer, bumpRenderVersion],
  );

  const onStrokeEnd = useCallback(() => {
    if (!sessionRef.current) {
      strokePointsRef.current = [];
      setIsDrawing(false);
      return;
    }

    // Still in pending-only mode → stroke was never confirmed → discard
    if (pendingOnlyRef.current) {
      clearLayer(pendingLayer);
      pendingLayer.meta.compositeOperation = undefined;
      sessionRef.current = null;
      pendingOnlyRef.current = false;
      strokePointsRef.current = [];
      setIsDrawing(false);
      bumpRenderVersion();
      return;
    }

    const {
      inputPoints,
      strokeSession,
      filterState,
      compiledFilterPipeline: sessionFilter,
      compiledExpand: sessionExpand,
      brushSeed,
      samplingLayer,
    } = sessionRef.current;

    const currentLayer = layerRef.current;
    if (!currentLayer || currentLayer.id !== sessionRef.current.layerId) {
      sessionRef.current = null;
      strokePointsRef.current = [];
      setIsDrawing(false);
      return;
    }

    const style = strokeStyleRef.current;
    const finalOutput = finalizePipeline(filterState, sessionFilter);
    const finalStrokeResult = addPointToSession(strokeSession, finalOutput);
    const brushState = appendToCommittedLayer(
      currentLayer,
      finalStrokeResult.renderUpdate.newlyCommitted,
      style,
      sessionExpand,
      finalStrokeResult.renderUpdate.committedOverlapCount,
      sessionRef.current.brushState,
      samplingLayer,
    );
    sessionRef.current.brushState = brushState;

    const totalPoints = finalStrokeResult.state.allCommitted.length;

    if (totalPoints >= 1) {
      onStrokeCompleteRef.current?.({
        inputPoints,
        filterPipelineConfig: sessionFilter.config,
        expandConfig: strokeSession.expand,
        strokeStyle: style,
        brushSeed,
        totalPoints,
      });
    }

    clearLayer(pendingLayer);
    pendingLayer.meta.compositeOperation = undefined;
    bumpRenderVersion();

    sessionRef.current = null;
    strokePointsRef.current = [];
    setIsDrawing(false);
  }, [pendingLayer, bumpRenderVersion]);

  const onDrawConfirm = useCallback(() => {
    if (!sessionRef.current || !pendingOnlyRef.current) return;
    pendingOnlyRef.current = false;

    const currentLayer = layerRef.current;
    if (!currentLayer || currentLayer.id !== sessionRef.current.layerId) return;

    const style = strokeStyleRef.current;
    const committedSnapshot = cloneLayerContent(currentLayer);
    sessionRef.current.committedSnapshot = committedSnapshot;
    sessionRef.current.samplingLayer = needsSamplingLayer(style)
      ? committedSnapshot
      : undefined;

    // 蓄積された全 committed ポイントを committed layer にフラッシュ
    const brushState = appendToCommittedLayer(
      currentLayer,
      sessionRef.current.strokeSession.allCommitted,
      style,
      sessionRef.current.compiledExpand,
      0,
      sessionRef.current.brushState,
      sessionRef.current.samplingLayer,
    );
    sessionRef.current.brushState = brushState;

    bumpRenderVersion();
  }, [bumpRenderVersion]);

  const onDrawCancel = useCallback(() => {
    const currentSession = sessionRef.current;
    const currentLayer = layerRef.current;
    if (
      currentSession &&
      currentLayer &&
      currentLayer.id === currentSession.layerId &&
      currentSession.committedSnapshot
    ) {
      restoreLayerContent(currentLayer, currentSession.committedSnapshot);
    }
    clearLayer(pendingLayer);
    pendingLayer.meta.compositeOperation = undefined;
    sessionRef.current = null;
    pendingOnlyRef.current = false;
    strokePointsRef.current = [];
    setIsDrawing(false);
    bumpRenderVersion();
  }, [pendingLayer, bumpRenderVersion]);

  return {
    onStrokeStart,
    onStrokeMove,
    onStrokeEnd,
    onDrawConfirm,
    onDrawCancel,
    canDraw,
    renderVersion,
    strokePoints: strokePointsRef.current,
    isDrawing,
  };
}
