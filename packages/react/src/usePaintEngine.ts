import {
  createLayer,
  isBrushMixingActive,
  transformLayer,
  wrapShiftLayer,
} from "@headless-paint/core";
import type {
  BrushAcceleratorBackend,
  BrushTipRegistry,
  CompiledExpand,
  ExpandConfig,
  Layer,
  LayerMeta,
  PendingOverlay,
  StrokeStyle,
} from "@headless-paint/core";
import type { CompiledFilterPipeline, InputPoint } from "@headless-paint/core";
import {
  beginHistoryMutation,
  canRedo as checkCanRedo,
  canUndo as checkCanUndo,
  computeCumulativeOffset,
  createHistoryState,
  createStrokeCommand,
  createTransformLayerCommand,
  createWrapShiftCommand,
  pushCommand,
  rebuildLayerFromHistory,
} from "@headless-paint/core";
import type { HistoryConfig, HistoryState } from "@headless-paint/core";
import type { mat3 } from "gl-matrix";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_HISTORY_CONFIG,
  useHistoryActions,
  usePushCustomCommand,
} from "./paint-engine/history-ops";
import { useLayerActions, useLayerListOps } from "./paint-engine/layer-ops";
import { usePaintRenderState } from "./paint-engine/render-state";
import type {
  CustomCommandContext,
  CustomCommandHandler,
} from "./paint-engine/types";
import { useBrushAccelerator } from "./paint-engine/useBrushAccelerator";
import type { InitialLayer, LayerEntry } from "./useLayers";
import { useLayers } from "./useLayers";
import type {
  StrokeCompleteData,
  StrokeStartOptions,
} from "./useStrokeSession";
import { useStrokeSessionWithAccelerator } from "./useStrokeSession";

export type {
  CustomCommandContext,
  CustomCommandHandler,
} from "./paint-engine/types";

export interface PaintEngineConfig<TCustom = never> {
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly strokeStyle: StrokeStyle;
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  readonly expandConfig: ExpandConfig;
  readonly compiledExpand: CompiledExpand;
  readonly historyConfig?: HistoryConfig;
  readonly registry?: BrushTipRegistry;
  readonly initialDocument?: PaintEngineInitialDocument;
  readonly customCommandHandler?: CustomCommandHandler<TCustom>;
  readonly gpuBackend?: BrushAcceleratorBackend;
  readonly gpuCommitMode?: "bitmap" | "direct";
}

export interface PaintEngineInitialLayer {
  readonly id: string;
  readonly meta: LayerMeta;
  readonly imageData: ImageData;
}

export interface PaintEngineInitialDocument {
  readonly layers: readonly PaintEngineInitialLayer[];
  readonly activeLayerId: string | null;
}

export interface PaintEngineResult<TCustom = never> {
  readonly gpuBackend: "webgl2" | "cpu";
  readonly gpuBackendReason: string;

  // ── レイヤー ──
  readonly entries: readonly LayerEntry[];
  readonly activeLayerId: string | null;
  readonly activeEntry: LayerEntry | undefined;
  readonly setActiveLayerId: (id: string | null) => void;
  readonly toggleVisibility: (layerId: string) => void;
  readonly renameLayer: (layerId: string, name: string) => void;
  readonly setLayerOpacity: (layerId: string, opacity: number) => void;
  readonly setLayerBlendMode: (
    layerId: string,
    blendMode: GlobalCompositeOperation | undefined,
  ) => void;
  readonly setLayerAlphaLocked: (layerId: string, alphaLocked: boolean) => void;
  readonly toggleAlphaLock: (layerId: string) => void;

  // ── レイヤー操作（履歴に自動記録される） ──
  readonly addLayer: () => void;
  readonly removeLayer: (layerId: string) => void;
  readonly moveLayerUp: (layerId: string) => void;
  readonly moveLayerDown: (layerId: string) => void;
  readonly duplicateLayer: (layerId: string) => void;
  readonly mergeLayerDown: (layerId: string) => void;

  // ── ストローク ──
  readonly onStrokeStart: (
    point: InputPoint,
    options?: StrokeStartOptions,
  ) => void;
  readonly onStrokeMove: (point: InputPoint) => void;
  readonly onStrokeMoves: (points: readonly InputPoint[]) => void;
  readonly onStrokeEnd: () => void;
  readonly onDrawConfirm: () => void;
  readonly onDrawCancel: () => void;

  // ── Transform ──
  readonly commitTransform: (layerId: string, matrix: mat3) => void;

  // ── Wrap shift ──
  readonly onWrapShift: (dx: number, dy: number) => void;
  readonly onWrapShiftEnd: (totalDx: number, totalDy: number) => void;
  readonly onResetOffset: () => void;
  readonly cumulativeOffset: { readonly x: number; readonly y: number };

  // ── カスタムコマンド ──
  readonly pushCustomCommand: (cmd: TCustom) => void;

  // ── 履歴 ──
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly historyState: HistoryState<TCustom>;

  // ── レンダリング ──
  readonly pendingLayer: Layer;
  readonly layers: readonly Layer[];
  readonly pendingOverlay: PendingOverlay | undefined;
  readonly renderVersion: number;
  readonly canDraw: boolean;
  readonly isDrawing: boolean;
  readonly strokePoints: readonly InputPoint[];
}

export function usePaintEngine<TCustom = never>(
  config: PaintEngineConfig<TCustom>,
): PaintEngineResult<TCustom> {
  const {
    layerWidth,
    layerHeight,
    strokeStyle,
    compiledFilterPipeline,
    expandConfig,
    compiledExpand,
    historyConfig = DEFAULT_HISTORY_CONFIG,
    registry,
    initialDocument,
    customCommandHandler,
    gpuBackend: requestedGpuBackend = "auto",
    gpuCommitMode: requestedGpuCommitMode = "bitmap",
  } = config;

  const { accelerator, gpuBackend, gpuBackendReason } = useBrushAccelerator(
    requestedGpuBackend,
    requestedGpuCommitMode,
  );

  const registryRef = useRef(registry);
  registryRef.current = registry;

  const customCommandHandlerRef = useRef(customCommandHandler);
  customCommandHandlerRef.current = customCommandHandler;

  // ── レイヤー管理 ──
  const initialLayers: readonly InitialLayer[] | undefined =
    initialDocument?.layers;
  const layerManager = useLayers(layerWidth, layerHeight, {
    initialLayers,
    initialActiveLayerId: initialDocument?.activeLayerId ?? null,
  });
  const {
    entries,
    entriesRef,
    activeLayerId,
    activeEntry,
    addLayer: addLayerRaw,
    removeLayer: removeLayerById,
    replaceEntries,
    setActiveLayerId,
    toggleVisibility,
    renameLayer,
    setLayerVisible,
    moveLayerUp: moveLayerUpRaw,
    moveLayerDown: moveLayerDownRaw,
    setLayerOpacity,
    setLayerBlendMode,
    setLayerAlphaLocked,
    toggleAlphaLock,
    findEntry,
    getLayerIndex,
    renderVersion: layerRenderVersion,
    bumpRenderVersion,
  } = layerManager;

  // ── 共有 pending layer ──
  const pendingLayer = useMemo(
    () => createLayer(layerWidth, layerHeight),
    [layerWidth, layerHeight],
  );

  // ── 履歴 ──
  const [historyState, setHistoryState] = useState<HistoryState<TCustom>>(() =>
    createHistoryState<TCustom>(layerWidth, layerHeight, {
      layerCount: initialLayers?.length ?? 1,
    }),
  );
  const historyStateRef = useRef(historyState);
  historyStateRef.current = historyState;

  const commitHistoryState = useCallback((next: HistoryState<TCustom>) => {
    historyStateRef.current = next;
    setHistoryState(next);
  }, []);

  const historyConfigRef = useRef(historyConfig);
  historyConfigRef.current = historyConfig;

  // ── Wrap shift ──
  const shiftTempCanvas = useMemo(
    () => new OffscreenCanvas(layerWidth, layerHeight),
    [layerWidth, layerHeight],
  );

  const dragShiftRef = useRef({ x: 0, y: 0 });
  const wrapShiftBegunRef = useRef(false);
  const wrapShiftHistoryBeforeBeginRef = useRef<HistoryState<TCustom> | null>(
    null,
  );
  const strokeHistoryBeforeBeginRef = useRef<HistoryState<TCustom> | null>(
    null,
  );

  const beginForLayers = useCallback(
    (affectedLayers: readonly Layer[]) => {
      if (affectedLayers.length === 0) return;
      const before = historyStateRef.current;
      const next = beginHistoryMutation(
        before,
        { affectedLayers, layerCount: entriesRef.current.length },
        historyConfigRef.current,
      );
      commitHistoryState(next);
    },
    [commitHistoryState, entriesRef],
  );

  // ── ストロークセッション ──
  const onStrokeComplete = useCallback(
    (data: StrokeCompleteData) => {
      if (data.totalPoints < 1) return;

      const currentEntry = findEntry(activeLayerId ?? "");
      if (!currentEntry) return;

      const command = createStrokeCommand(
        currentEntry.id,
        data.inputPoints,
        data.filterPipelineConfig,
        data.expandConfig,
        data.strokeStyle,
        data.brushSeed,
        data.alphaLocked,
      );
      const next = pushCommand(
        historyStateRef.current,
        command,
        {
          afterLayer: currentEntry.committedLayer,
          layerCount: entriesRef.current.length,
        },
        historyConfigRef.current,
      );
      strokeHistoryBeforeBeginRef.current = null;
      commitHistoryState(next);
    },
    [findEntry, activeLayerId, entriesRef, commitHistoryState],
  );

  const restoreLayerBeforeStroke = useCallback(
    (layer: Layer) => {
      const result = rebuildLayerFromHistory(
        layer,
        historyStateRef.current,
        registryRef.current,
        { accelerator, invalidationReason: "runtimeRestore" },
      );
      if (!result.ok) {
        throw new Error(
          `[headless-paint] GPU stroke recovery failed: ${result.reason} layerId=${result.layerId}`,
        );
      }
    },
    [accelerator],
  );

  const session = useStrokeSessionWithAccelerator({
    layer: activeEntry?.committedLayer ?? null,
    pendingLayer,
    strokeStyle,
    compiledFilterPipeline,
    expandConfig,
    compiledExpand,
    onStrokeComplete,
    registry,
    accelerator,
    restoreLayerBeforeStroke,
  });

  useEffect(() => {
    const brush = strokeStyle.brush;
    if (
      brush.type === "stamp" &&
      isBrushMixingActive(brush.mixing) &&
      activeEntry?.committedLayer
    ) {
      accelerator?.warmUp(activeEntry.committedLayer);
    }
  }, [accelerator, activeEntry?.committedLayer, strokeStyle.brush]);

  const handleStrokeStart = useCallback(
    (point: InputPoint, options?: StrokeStartOptions) => {
      if (!options?.pendingOnly && activeEntry?.committedLayer) {
        strokeHistoryBeforeBeginRef.current = historyStateRef.current;
        beginForLayers([activeEntry.committedLayer]);
      }
      session.onStrokeStart(point, options);
    },
    [activeEntry, beginForLayers, session.onStrokeStart],
  );

  const handleDrawConfirm = useCallback(() => {
    if (activeEntry?.committedLayer) {
      strokeHistoryBeforeBeginRef.current = historyStateRef.current;
      beginForLayers([activeEntry.committedLayer]);
    }
    session.onDrawConfirm();
  }, [activeEntry, beginForLayers, session.onDrawConfirm]);

  const handleDrawCancel = useCallback(() => {
    session.onDrawCancel();
    if (strokeHistoryBeforeBeginRef.current) {
      commitHistoryState(strokeHistoryBeforeBeginRef.current);
      strokeHistoryBeforeBeginRef.current = null;
    }
  }, [commitHistoryState, session.onDrawCancel]);

  // ── レイヤー操作（履歴付き） ──
  const layerActions = useLayerActions({
    layerWidth,
    layerHeight,
    entriesRef,
    addLayer: addLayerRaw,
    removeLayer: removeLayerById,
    replaceEntries,
    moveLayerUp: moveLayerUpRaw,
    moveLayerDown: moveLayerDownRaw,
    findEntry,
    getLayerIndex,
    beginForLayers,
    historyStateRef,
    historyConfigRef,
    commitHistoryState,
  });

  // ── Wrap shift ──
  const handleWrapShift = useCallback(
    (dx: number, dy: number) => {
      for (const entry of entriesRef.current) {
        if (!wrapShiftBegunRef.current && (dx !== 0 || dy !== 0)) {
          wrapShiftHistoryBeforeBeginRef.current = historyStateRef.current;
          beginForLayers(entriesRef.current.map((e) => e.committedLayer));
          wrapShiftBegunRef.current = true;
        }
        wrapShiftLayer(entry.committedLayer, dx, dy, shiftTempCanvas);
      }
      dragShiftRef.current = {
        x: dragShiftRef.current.x + dx,
        y: dragShiftRef.current.y + dy,
      };
      bumpRenderVersion();
    },
    [entriesRef, shiftTempCanvas, beginForLayers, bumpRenderVersion],
  );

  const handleWrapShiftEnd = useCallback(
    (totalDx: number, totalDy: number) => {
      dragShiftRef.current = { x: 0, y: 0 };
      if (totalDx === 0 && totalDy === 0) {
        if (wrapShiftHistoryBeforeBeginRef.current) {
          commitHistoryState(wrapShiftHistoryBeforeBeginRef.current);
        }
        wrapShiftBegunRef.current = false;
        wrapShiftHistoryBeforeBeginRef.current = null;
        return;
      }
      const command = createWrapShiftCommand(totalDx, totalDy);
      const next = pushCommand(
        historyStateRef.current,
        command,
        {
          affectedLayerIds: entriesRef.current.map((e) => e.id),
          layerCount: entriesRef.current.length,
        },
        historyConfigRef.current,
      );
      wrapShiftBegunRef.current = false;
      wrapShiftHistoryBeforeBeginRef.current = null;
      commitHistoryState(next);
    },
    [entriesRef, commitHistoryState],
  );

  // ── Transform ──
  const handleCommitTransform = useCallback(
    (layerId: string, matrix: mat3) => {
      const entry = findEntry(layerId);
      if (!entry) return;
      beginForLayers([entry.committedLayer]);
      transformLayer(entry.committedLayer, matrix, shiftTempCanvas);
      const command = createTransformLayerCommand(
        layerId,
        matrix as Float32Array,
      );
      const next = pushCommand(
        historyStateRef.current,
        command,
        {
          afterLayer: entry.committedLayer,
          layerCount: entriesRef.current.length,
        },
        historyConfigRef.current,
      );
      commitHistoryState(next);
      bumpRenderVersion();
    },
    [
      findEntry,
      shiftTempCanvas,
      entriesRef,
      beginForLayers,
      commitHistoryState,
      bumpRenderVersion,
    ],
  );

  const handleResetOffset = useCallback(() => {
    const { x, y } = computeCumulativeOffset(historyStateRef.current);
    if (x === 0 && y === 0) return;
    beginForLayers(entriesRef.current.map((e) => e.committedLayer));
    for (const entry of entriesRef.current) {
      wrapShiftLayer(entry.committedLayer, -x, -y, shiftTempCanvas);
    }
    const command = createWrapShiftCommand(-x, -y);
    const next = pushCommand(
      historyStateRef.current,
      command,
      {
        affectedLayerIds: entriesRef.current.map((e) => e.id),
        layerCount: entriesRef.current.length,
      },
      historyConfigRef.current,
    );
    commitHistoryState(next);
    bumpRenderVersion();
  }, [
    entriesRef,
    shiftTempCanvas,
    beginForLayers,
    commitHistoryState,
    bumpRenderVersion,
  ]);

  // ── Custom Commands ──
  const handlePushCustomCommand = usePushCustomCommand({
    handlerRef: customCommandHandlerRef,
    historyStateRef,
    historyConfigRef,
    entriesRef,
    findEntry,
    bumpRenderVersion,
    commitHistoryState,
  });

  // ── Undo/Redo ──
  const applyLayerListOps = useLayerListOps({
    entriesRef,
    removeLayer: removeLayerById,
    replaceEntries,
    moveLayerUp: moveLayerUpRaw,
    moveLayerDown: moveLayerDownRaw,
  });
  const historyActions = useHistoryActions({
    activeLayerId,
    entriesRef,
    historyStateRef,
    registryRef,
    customCommandHandlerRef,
    shiftTempCanvas,
    accelerator,
    brush: strokeStyle.brush,
    applyLayerListOps,
    setActiveLayerId,
    setLayerVisible,
    findEntry,
    bumpRenderVersion,
    commitHistoryState,
    cancelDrawing: handleDrawCancel,
  });

  const renderState = usePaintRenderState({
    entries,
    activeLayerId,
    pendingLayer,
    layerWidth,
    layerHeight,
    layerRenderVersion,
    sessionRenderVersion: session.renderVersion,
    historyState,
    dragShift: dragShiftRef.current,
  });

  return {
    gpuBackend,
    gpuBackendReason,

    // レイヤー
    entries,
    activeLayerId,
    activeEntry,
    setActiveLayerId,
    toggleVisibility,
    renameLayer,
    setLayerOpacity,
    setLayerBlendMode,
    setLayerAlphaLocked,
    toggleAlphaLock,

    // レイヤー操作（履歴付き）
    addLayer: layerActions.addLayer,
    removeLayer: layerActions.removeLayer,
    moveLayerUp: layerActions.moveLayerUp,
    moveLayerDown: layerActions.moveLayerDown,
    duplicateLayer: layerActions.duplicateLayer,
    mergeLayerDown: layerActions.mergeLayerDown,

    // ストローク
    onStrokeStart: handleStrokeStart,
    onStrokeMove: session.onStrokeMove,
    onStrokeMoves: session.onStrokeMoves,
    onStrokeEnd: session.onStrokeEnd,
    onDrawConfirm: handleDrawConfirm,
    onDrawCancel: handleDrawCancel,

    // Transform
    commitTransform: handleCommitTransform,

    // Custom commands
    pushCustomCommand: handlePushCustomCommand,

    // Wrap shift
    onWrapShift: handleWrapShift,
    onWrapShiftEnd: handleWrapShiftEnd,
    onResetOffset: handleResetOffset,
    cumulativeOffset: renderState.cumulativeOffset,

    // 履歴
    undo: historyActions.undo,
    redo: historyActions.redo,
    canUndo: checkCanUndo(historyState),
    canRedo: checkCanRedo(historyState),
    historyState,

    // レンダリング
    pendingLayer,
    layers: renderState.layers,
    pendingOverlay: renderState.pendingOverlay,
    renderVersion: renderState.renderVersion,
    canDraw: session.canDraw,
    isDrawing: session.isDrawing,
    strokePoints: session.strokePoints,
  };
}
