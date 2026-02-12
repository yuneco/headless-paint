import {
  appendToCommittedLayer,
  clearLayer,
  renderPendingLayer,
} from "@headless-paint/engine";
import type {
  CompiledExpand,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import {
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
import { useCallback, useRef, useState } from "react";

export interface StrokeCompleteData {
  readonly inputPoints: readonly InputPoint[];
  readonly filterPipelineConfig: FilterPipelineConfig;
  readonly expandConfig: ExpandConfig;
  readonly strokeStyle: StrokeStyle;
  readonly totalPoints: number;
}

export interface UseStrokeSessionConfig {
  readonly layer: Layer | null;
  readonly pendingLayer: Layer;
  readonly strokeStyle: StrokeStyle;
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  readonly expandConfig: ExpandConfig;
  readonly compiledExpand: CompiledExpand;
  readonly onStrokeComplete?: (data: StrokeCompleteData) => void;
}

export interface UseStrokeSessionResult {
  readonly onStrokeStart: (point: InputPoint, pendingOnly?: boolean) => void;
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

  const canDraw = layer?.meta.visible ?? false;

  const bumpRenderVersion = useCallback(
    () => setRenderVersion((n) => n + 1),
    [],
  );

  const onStrokeStart = useCallback(
    (inputPoint: InputPoint, pendingOnly = false) => {
      const currentLayer = layerRef.current;
      if (!currentLayer || !currentLayer.meta.visible) return;
      pendingOnlyRef.current = pendingOnly;

      const compiled = compiledExpandRef.current;
      const style = strokeStyleRef.current;
      const filterState = createFilterPipelineState(compiledFilterPipeline);
      const filterResult = processPoint(
        filterState,
        inputPoint,
        compiledFilterPipeline,
      );

      const strokeResult = startStrokeSession(
        filterResult.output,
        style,
        expandConfigRef.current,
      );

      sessionRef.current = {
        strokeSession: strokeResult.state,
        filterState: filterResult.state,
        inputPoints: [inputPoint],
        compiledExpand: compiled,
        compiledFilterPipeline,
        layerId: currentLayer.id,
      };

      pendingLayer.meta.compositeOperation = style.compositeOperation;

      if (!pendingOnly) {
        appendToCommittedLayer(
          currentLayer,
          strokeResult.renderUpdate.newlyCommitted,
          style,
          compiled,
        );
      }

      const pendingPoints = pendingOnly
        ? [
            ...strokeResult.renderUpdate.newlyCommitted,
            ...strokeResult.renderUpdate.currentPending,
          ]
        : strokeResult.renderUpdate.currentPending;
      renderPendingLayer(pendingLayer, pendingPoints, style, compiled);

      setStrokePoints([inputPoint]);
      setIsDrawing(true);
      bumpRenderVersion();
    },
    [compiledFilterPipeline, pendingLayer, bumpRenderVersion],
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
          appendToCommittedLayer(
            currentLayer,
            newlyCommitted,
            style,
            sessionRef.current.compiledExpand,
            committedOverlapCount,
          );
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
      );
    }

    const totalPoints = finalStrokeResult.state.allCommitted.length;

    if (totalPoints >= 1) {
      onStrokeCompleteRef.current?.({
        inputPoints,
        filterPipelineConfig: sessionFilter.config,
        expandConfig: strokeSession.expand,
        strokeStyle: style,
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
    appendToCommittedLayer(
      currentLayer,
      sessionRef.current.strokeSession.allCommitted,
      style,
      sessionRef.current.compiledExpand,
    );

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
