import {
  createBrushAccelerator,
  createLayer,
  isBrushMixingActive,
  resolveBrushAcceleratorBackend,
  transformLayer,
  wrapShiftLayer,
} from "@headless-paint/core";
import type {
  BrushAccelerator,
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
  createAddLayerCommand,
  createHistoryState,
  createRemoveLayerCommand,
  createReorderLayerCommand,
  createStrokeCommand,
  createTransformLayerCommand,
  createWrapShiftCommand,
  duplicateLayerAtomic,
  executeHistoryOp,
  mergeLayerDownAtomic,
  pushCommand,
  rebuildLayerFromHistory,
} from "@headless-paint/core";
import type {
  Command,
  CustomCommandExecutor,
  CustomCommandOutcome,
  ExecutorResult,
  HistoryConfig,
  HistoryState,
  LayerListOp,
} from "@headless-paint/core";
import type { mat3 } from "gl-matrix";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InitialLayer, LayerEntry } from "./useLayers";
import { useLayers } from "./useLayers";
import type {
  StrokeCompleteData,
  StrokeStartOptions,
} from "./useStrokeSession";
import { useStrokeSessionWithAccelerator } from "./useStrokeSession";

export interface CustomCommandHandler<TCustom> {
  readonly apply: (cmd: TCustom, ctx: CustomCommandContext) => void;
  readonly undo: (cmd: TCustom, ctx: CustomCommandContext) => void;
}

export interface CustomCommandContext {
  readonly entries: readonly LayerEntry[];
  readonly findEntry: (layerId: string) => LayerEntry | undefined;
  readonly bumpRenderVersion: () => void;
}

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

interface BrushAcceleratorState {
  readonly requestedBackend: BrushAcceleratorBackend;
  readonly requestedCommitMode: "bitmap" | "direct";
  readonly accelerator: BrushAccelerator | null;
}

const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  checkpointInterval: 10,
  maxCheckpoints: 10,
  checkpointCompression: "fast",
};

function createDuplicateLayerName(
  sourceName: string,
  entries: readonly LayerEntry[],
): string {
  const existing = new Set(
    entries.map((entry) => entry.committedLayer.meta.name),
  );
  const baseName = `${sourceName} copy`;
  if (!existing.has(baseName)) return baseName;
  let index = 2;
  while (existing.has(`${baseName} ${index}`)) {
    index += 1;
  }
  return `${baseName} ${index}`;
}

function getCommandType(command: unknown): string {
  const typed = command as { readonly type?: unknown } | undefined;
  return typeof typed?.type === "string" ? typed.type : "custom";
}

function shouldApplyActiveLayerHint<TCustom>(
  op: "undo" | "redo",
  result: ExecutorResult<TCustom>,
  currentActiveLayerId: string | null,
): boolean {
  if (!result.activeLayerIdHint) return false;

  const commandType = getCommandType(result.command);
  const isNearbyRemoveHint =
    (op === "undo" && commandType === "add-layer") ||
    (op === "redo" && commandType === "remove-layer");
  if (!isNearbyRemoveHint) return true;

  return result.layerListOps.some(
    (listOp) =>
      listOp.type === "remove" && listOp.layerId === currentActiveLayerId,
  );
}

function warnHistoryExecutorFailure<TCustom>(
  op: "undo" | "redo",
  result: ExecutorResult<TCustom>,
): void {
  const failure = result.failure;
  const commandType = failure?.commandType ?? getCommandType(result.command);
  const layerPart = failure?.layerId ? ` layerId=${failure.layerId}` : "";
  console.warn(
    `[headless-paint] ${op} skipped ${commandType}: ${failure?.reason ?? "unknown"}${layerPart}`,
  );
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

  const [acceleratorState, setAcceleratorState] =
    useState<BrushAcceleratorState>(() => ({
      requestedBackend: requestedGpuBackend,
      requestedCommitMode: requestedGpuCommitMode,
      accelerator: null,
    }));
  useEffect(() => {
    const nextAccelerator =
      requestedGpuBackend === "cpu"
        ? null
        : createBrushAccelerator({
            backend: requestedGpuBackend,
            commitMode: requestedGpuCommitMode,
          });
    setAcceleratorState({
      requestedBackend: requestedGpuBackend,
      requestedCommitMode: requestedGpuCommitMode,
      accelerator: nextAccelerator,
    });
    return () => {
      nextAccelerator?.dispose();
    };
  }, [requestedGpuBackend, requestedGpuCommitMode]);
  const accelerator =
    acceleratorState.requestedBackend === requestedGpuBackend &&
    acceleratorState.requestedCommitMode === requestedGpuCommitMode
      ? acceleratorState.accelerator
      : null;
  const gpuBackend = accelerator?.backend ?? "cpu";
  const gpuBackendReason = resolveBrushAcceleratorBackend(
    { backend: requestedGpuBackend },
    { webgl2Available: () => accelerator !== null },
  ).reason;

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
  const handleAddLayer = useCallback(() => {
    const { entry, insertIndex } = addLayerRaw();
    const command = createAddLayerCommand(
      entry.id,
      insertIndex,
      layerWidth,
      layerHeight,
      entry.committedLayer.meta,
    );
    const next = pushCommand(
      historyStateRef.current,
      command,
      { layerCount: entriesRef.current.length },
      historyConfigRef.current,
    );
    commitHistoryState(next);
  }, [addLayerRaw, layerWidth, layerHeight, entriesRef, commitHistoryState]);

  const handleRemoveLayer = useCallback(
    (layerId: string) => {
      const entry = findEntry(layerId);
      if (!entry) return;
      const removedIndex = getLayerIndex(layerId);
      const command = createRemoveLayerCommand(
        layerId,
        removedIndex,
        entry.committedLayer.meta,
      );
      beginForLayers([entry.committedLayer]);
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
      removeLayerById(layerId);
    },
    [
      findEntry,
      getLayerIndex,
      entriesRef,
      beginForLayers,
      commitHistoryState,
      removeLayerById,
    ],
  );

  const handleMoveLayerUp = useCallback(
    (layerId: string) => {
      const result = moveLayerUpRaw(layerId);
      if (!result) return;
      const command = createReorderLayerCommand(
        layerId,
        result.fromIndex,
        result.toIndex,
      );
      const next = pushCommand(
        historyStateRef.current,
        command,
        { layerCount: entriesRef.current.length },
        historyConfigRef.current,
      );
      commitHistoryState(next);
    },
    [moveLayerUpRaw, entriesRef, commitHistoryState],
  );

  const handleMoveLayerDown = useCallback(
    (layerId: string) => {
      const result = moveLayerDownRaw(layerId);
      if (!result) return;
      const command = createReorderLayerCommand(
        layerId,
        result.fromIndex,
        result.toIndex,
      );
      const next = pushCommand(
        historyStateRef.current,
        command,
        { layerCount: entriesRef.current.length },
        historyConfigRef.current,
      );
      commitHistoryState(next);
    },
    [moveLayerDownRaw, entriesRef, commitHistoryState],
  );

  const handleDuplicateLayer = useCallback(
    (layerId: string) => {
      const entry = findEntry(layerId);
      if (!entry) return;
      const name = createDuplicateLayerName(
        entry.committedLayer.meta.name,
        entriesRef.current,
      );
      beginForLayers([entry.committedLayer]);
      const result = duplicateLayerAtomic(
        entriesRef.current.map((e) => e.committedLayer),
        {
          sourceLayerId: layerId,
          meta: { name },
        },
      );
      if (!result) return;
      const next = pushCommand(
        historyStateRef.current,
        result.command,
        { layerCount: result.layers.length },
        historyConfigRef.current,
      );
      commitHistoryState(next);
      replaceEntries(result.layers, result.layer.id);
    },
    [findEntry, entriesRef, beginForLayers, commitHistoryState, replaceEntries],
  );

  const handleMergeLayerDown = useCallback(
    (layerId: string) => {
      const currentEntries = entriesRef.current;
      const sourceIndex = currentEntries.findIndex((e) => e.id === layerId);
      const targetIndex = sourceIndex - 1;
      if (sourceIndex < 0 || targetIndex < 0) return;
      const sourceEntry = currentEntries[sourceIndex];
      const targetEntry = currentEntries[targetIndex];
      beginForLayers([sourceEntry.committedLayer, targetEntry.committedLayer]);
      const result = mergeLayerDownAtomic(
        currentEntries.map((e) => e.committedLayer),
        { sourceLayerId: layerId },
      );
      if (!result) return;
      const next = pushCommand(
        historyStateRef.current,
        result.command,
        { layerCount: result.layers.length },
        historyConfigRef.current,
      );
      commitHistoryState(next);
      replaceEntries(result.layers, result.targetLayerId);
    },
    [entriesRef, beginForLayers, commitHistoryState, replaceEntries],
  );

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
  const handlePushCustomCommand = useCallback(
    (cmd: TCustom) => {
      const handler = customCommandHandlerRef.current;
      if (!handler) return;
      const next = pushCommand(
        historyStateRef.current,
        cmd as Command<TCustom>,
        { layerCount: entriesRef.current.length },
        historyConfigRef.current,
      );
      commitHistoryState(next);
      handler.apply(cmd, {
        entries: entriesRef.current,
        findEntry,
        bumpRenderVersion,
      });
    },
    [entriesRef, findEntry, commitHistoryState, bumpRenderVersion],
  );

  // ── Undo/Redo ──
  const applyMoveLayerListOp = useCallback(
    (fromIndex: number, toIndex: number) => {
      const currentEntries = entriesRef.current;
      const movedEntry = currentEntries[fromIndex];
      if (!movedEntry || toIndex < 0 || toIndex >= currentEntries.length) {
        return;
      }

      if (toIndex === fromIndex + 1) {
        moveLayerUpRaw(movedEntry.id);
        return;
      }
      if (toIndex === fromIndex - 1) {
        moveLayerDownRaw(movedEntry.id);
        return;
      }

      const layers = currentEntries.map((entry) => entry.committedLayer);
      const [movedLayer] = layers.splice(fromIndex, 1);
      layers.splice(toIndex, 0, movedLayer);
      replaceEntries(layers);
    },
    [entriesRef, moveLayerUpRaw, moveLayerDownRaw, replaceEntries],
  );

  const applyLayerListOps = useCallback(
    (ops: readonly LayerListOp[]) => {
      for (const listOp of ops) {
        switch (listOp.type) {
          case "insert": {
            const layers = entriesRef.current.map(
              (entry) => entry.committedLayer,
            );
            const index = Math.max(0, Math.min(listOp.index, layers.length));
            layers.splice(index, 0, listOp.layer);
            replaceEntries(layers);
            break;
          }
          case "remove":
            removeLayerById(listOp.layerId);
            break;
          case "move":
            applyMoveLayerListOp(listOp.fromIndex, listOp.toIndex);
            break;
          case "replace":
            replaceEntries(listOp.layers, listOp.activeLayerId);
            break;
        }
      }
    },
    [entriesRef, removeLayerById, replaceEntries, applyMoveLayerListOp],
  );

  const createCustomExecutor = useCallback(():
    | CustomCommandExecutor<TCustom>
    | undefined => {
    const handler = customCommandHandlerRef.current;
    if (!handler) return undefined;

    const createOutcome = (run: () => void): CustomCommandOutcome => {
      run();
      return { ok: true };
    };

    return {
      apply: (cmd) =>
        createOutcome(() => {
          handler.apply(cmd, {
            entries: entriesRef.current,
            findEntry,
            bumpRenderVersion,
          });
        }),
      unapply: (cmd) =>
        createOutcome(() => {
          handler.undo(cmd, {
            entries: entriesRef.current,
            findEntry,
            bumpRenderVersion,
          });
        }),
    };
  }, [entriesRef, findEntry, bumpRenderVersion]);

  const executeAndApplyHistoryOp = useCallback(
    (op: "undo" | "redo") => {
      // Toolbar / gesture history actions can race the final pointer event.
      // End the live GPU owner before history rebuild starts.
      handleDrawCancel();
      const prev = historyStateRef.current;
      if (op === "undo" ? !checkCanUndo(prev) : !checkCanRedo(prev)) return;

      const perfDebugGlobal = (
        globalThis as {
          __hpBrushPerf?: {
            recordEvent(name: string, details?: object): void;
          };
        }
      ).__hpBrushPerf;
      let result: ReturnType<typeof executeHistoryOp<TCustom>>;
      try {
        result = executeHistoryOp(op, prev, {
          layers: entriesRef.current.map((entry) => entry.committedLayer),
          tipRegistry: registryRef.current,
          customExecutor: createCustomExecutor(),
          shiftTempCanvas,
          accelerator,
        });
      } catch (error) {
        perfDebugGlobal?.recordEvent?.("historyOpError", {
          reason: `executeHistoryOp threw: ${
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error)
          }`,
        });
        throw error;
      }
      perfDebugGlobal?.recordEvent?.("historyOpResult", {
        reason: result.ok
          ? `${op} ok`
          : `${op} failed: ${JSON.stringify(result.failure ?? result).slice(0, 200)}`,
      });

      if (!result.ok) {
        warnHistoryExecutorFailure(op, result);
        return;
      }
      (
        globalThis as {
          __hpBrushPerf?: {
            recordEvent(name: string, details?: object): void;
          };
        }
      ).__hpBrushPerf?.recordEvent?.("warmUpCheck", {
        reason: `${op} executed`,
      });

      try {
        applyLayerListOps(result.layerListOps);
        if (shouldApplyActiveLayerHint(op, result, activeLayerId)) {
          setActiveLayerId(result.activeLayerIdHint ?? null);
        }
        for (const layerId of result.visibilityFixLayerIds) {
          setLayerVisible(layerId, true);
        }

        commitHistoryState(result.next);
        bumpRenderVersion();
      } catch (error) {
        (
          globalThis as {
            __hpBrushPerf?: {
              recordEvent(name: string, details?: object): void;
            };
          }
        ).__hpBrushPerf?.recordEvent?.("historyOpError", {
          reason:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
        });
        throw error;
      }

      // The rebuild usually ends with a checkpoint restore (CPU write), which
      // invalidates GPU residency. Re-upload during the idle gap right after
      // the history op instead of at the next stroke start.
      const brush = strokeStyle.brush;
      (
        globalThis as {
          __hpBrushPerf?: {
            recordEvent(name: string, details?: object): void;
          };
        }
      ).__hpBrushPerf?.recordEvent?.("warmUpCheck", {
        reason: `${op} accel=${accelerator ? 1 : 0} brush=${brush.type} mix=${
          brush.type === "stamp" && isBrushMixingActive(brush.mixing) ? 1 : 0
        } raf=${typeof requestAnimationFrame}`,
      });
      if (
        accelerator &&
        brush.type === "stamp" &&
        isBrushMixingActive(brush.mixing)
      ) {
        (
          globalThis as {
            __hpBrushPerf?: {
              enabled: boolean;
              recordEvent(name: string, details?: object): void;
            };
          }
        ).__hpBrushPerf?.recordEvent?.("warmUpScheduled", { reason: op });
        const targetLayerId = shouldApplyActiveLayerHint(
          op,
          result,
          activeLayerId,
        )
          ? (result.activeLayerIdHint ?? activeLayerId)
          : activeLayerId;
        const schedule =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame
            : (cb: () => void) => setTimeout(cb, 0);
        schedule(() => {
          const entry = entriesRef.current.find(
            (candidate) => candidate.id === targetLayerId,
          );
          (
            globalThis as {
              __hpBrushPerf?: {
                enabled: boolean;
                recordEvent(name: string, details?: object): void;
              };
            }
          ).__hpBrushPerf?.recordEvent?.("warmUpFired", {
            reason: entry ? "entry" : "no-entry",
          });
          if (entry) accelerator.warmUp(entry.committedLayer);
        });
      }
    },
    [
      activeLayerId,
      entriesRef,
      shiftTempCanvas,
      accelerator,
      strokeStyle.brush,
      createCustomExecutor,
      applyLayerListOps,
      setActiveLayerId,
      setLayerVisible,
      commitHistoryState,
      bumpRenderVersion,
      handleDrawCancel,
    ],
  );

  const handleUndo = useCallback(() => {
    executeAndApplyHistoryOp("undo");
  }, [executeAndApplyHistoryOp]);

  const handleRedo = useCallback(() => {
    executeAndApplyHistoryOp("redo");
  }, [executeAndApplyHistoryOp]);

  // ── レイヤー配列構築 ──
  const combinedRenderVersion = layerRenderVersion + session.renderVersion;

  const layers: readonly Layer[] = useMemo(
    () => entries.map((e) => e.committedLayer),
    [entries],
  );

  // プレ合成用ワークレイヤー
  const workLayer = useMemo(
    () => createLayer(layerWidth, layerHeight, { name: "__work" }),
    [layerWidth, layerHeight],
  );

  const pendingOverlay: PendingOverlay | undefined = activeLayerId
    ? { layer: pendingLayer, targetLayerId: activeLayerId, workLayer }
    : undefined;

  // ── Cumulative offset ──
  const cumulativeOffsetFromHistory = computeCumulativeOffset(historyState);
  const cumulativeX = cumulativeOffsetFromHistory.x + dragShiftRef.current.x;
  const cumulativeY = cumulativeOffsetFromHistory.y + dragShiftRef.current.y;
  const cumulativeOffset = useMemo(
    () => ({ x: cumulativeX, y: cumulativeY }),
    [cumulativeX, cumulativeY],
  );

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
    addLayer: handleAddLayer,
    removeLayer: handleRemoveLayer,
    moveLayerUp: handleMoveLayerUp,
    moveLayerDown: handleMoveLayerDown,
    duplicateLayer: handleDuplicateLayer,
    mergeLayerDown: handleMergeLayerDown,

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
    cumulativeOffset,

    // 履歴
    undo: handleUndo,
    redo: handleRedo,
    canUndo: checkCanUndo(historyState),
    canRedo: checkCanRedo(historyState),
    historyState,

    // レンダリング
    pendingLayer,
    layers,
    pendingOverlay,
    renderVersion: combinedRenderVersion,
    canDraw: session.canDraw,
    isDrawing: session.isDrawing,
    strokePoints: session.strokePoints,
  };
}
