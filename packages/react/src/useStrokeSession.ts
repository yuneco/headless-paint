import {
  appendToCommittedLayer,
  clearLayer,
  renderPendingLayer,
} from "@headless-paint/engine";
import type {
  BrushRenderState,
  BrushTipRegistry,
  CompiledExpand,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import { generateBrushTip } from "@headless-paint/engine";
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
import { addPointToSession, startStrokeSession } from "@headless-paint/stroke";
import type { StrokeSessionState } from "@headless-paint/stroke";
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
  const [strokePoints, setStrokePoints] = useState<InputPoint[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  const sessionRef = useRef<SessionInternal | null>(null);
  const pendingOnlyRef = useRef(false);

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

      let brushState = initialBrushState;

      sessionRef.current = {
        strokeSession: strokeResult.state,
        filterState: filterResult.state,
        inputPoints: [inputPoint],
        compiledExpand: compiled,
        compiledFilterPipeline: activePipeline,
        layerId: currentLayer.id,
        brushState,
        brushSeed,
      };

      const pendingOnly = pendingOnlyRef.current;
      pendingLayer.meta.compositeOperation = style.compositeOperation;

      if (!pendingOnly) {
        brushState = appendToCommittedLayer(
          currentLayer,
          strokeResult.renderUpdate.newlyCommitted,
          style,
          compiled,
          0,
          brushState,
        );
        sessionRef.current.brushState = brushState;
      }

      const pendingPoints = pendingOnly
        ? [
            ...strokeResult.renderUpdate.newlyCommitted,
            ...strokeResult.renderUpdate.currentPending,
          ]
        : strokeResult.renderUpdate.currentPending;
      renderPendingLayer(
        pendingLayer,
        pendingPoints,
        style,
        compiled,
        brushState,
      );

      setStrokePoints([inputPoint]);
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

      sessionRef.current = {
        ...sessionRef.current,
        strokeSession: strokeResult.state,
        filterState: filterResult.state,
        inputPoints: [...sessionRef.current.inputPoints, inputPoint],
      };

      if (!pendingOnlyRef.current) {
        const { newlyCommitted, committedOverlapCount } =
          strokeResult.renderUpdate;
        if (newlyCommitted.length > committedOverlapCount) {
          const brushState = appendToCommittedLayer(
            currentLayer,
            newlyCommitted,
            style,
            sessionRef.current.compiledExpand,
            committedOverlapCount,
            sessionRef.current.brushState,
          );
          sessionRef.current.brushState = brushState;
        }
      }

      const pendingPoints = pendingOnlyRef.current
        ? [
            ...strokeResult.state.allCommitted,
            ...strokeResult.renderUpdate.currentPending,
          ]
        : strokeResult.renderUpdate.currentPending;
      renderPendingLayer(
        pendingLayer,
        pendingPoints,
        style,
        sessionRef.current.compiledExpand,
        sessionRef.current.brushState,
      );

      setStrokePoints((prev) => [...prev, inputPoint]);
      bumpRenderVersion();
    },
    [pendingLayer, bumpRenderVersion],
  );

  const onStrokeEnd = useCallback(() => {
    if (!sessionRef.current) {
      setStrokePoints([]);
      setIsDrawing(false);
      return;
    }

    // Still in pending-only mode → stroke was never confirmed → discard
    if (pendingOnlyRef.current) {
      clearLayer(pendingLayer);
      pendingLayer.meta.compositeOperation = undefined;
      sessionRef.current = null;
      pendingOnlyRef.current = false;
      setStrokePoints([]);
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
    } = sessionRef.current;

    const currentLayer = layerRef.current;
    if (!currentLayer || currentLayer.id !== sessionRef.current.layerId) {
      sessionRef.current = null;
      setStrokePoints([]);
      setIsDrawing(false);
      return;
    }

    const style = strokeStyleRef.current;
    const finalOutput = finalizePipeline(filterState, sessionFilter);
    const finalStrokeResult = addPointToSession(strokeSession, finalOutput);

    const { newlyCommitted, committedOverlapCount } =
      finalStrokeResult.renderUpdate;
    if (newlyCommitted.length > committedOverlapCount) {
      appendToCommittedLayer(
        currentLayer,
        newlyCommitted,
        style,
        sessionExpand,
        committedOverlapCount,
        sessionRef.current.brushState,
      );
    }

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
    setStrokePoints([]);
    setIsDrawing(false);
  }, [pendingLayer, bumpRenderVersion]);

  const onDrawConfirm = useCallback(() => {
    if (!sessionRef.current || !pendingOnlyRef.current) return;
    pendingOnlyRef.current = false;

    const currentLayer = layerRef.current;
    if (!currentLayer || currentLayer.id !== sessionRef.current.layerId) return;

    const style = strokeStyleRef.current;

    // 蓄積された全 committed ポイントを committed layer にフラッシュ
    const brushState = appendToCommittedLayer(
      currentLayer,
      sessionRef.current.strokeSession.allCommitted,
      style,
      sessionRef.current.compiledExpand,
      0,
      sessionRef.current.brushState,
    );
    sessionRef.current.brushState = brushState;

    bumpRenderVersion();
  }, [bumpRenderVersion]);

  const onDrawCancel = useCallback(() => {
    clearLayer(pendingLayer);
    pendingLayer.meta.compositeOperation = undefined;
    sessionRef.current = null;
    pendingOnlyRef.current = false;
    setStrokePoints([]);
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
    strokePoints,
    isDrawing,
  };
}
