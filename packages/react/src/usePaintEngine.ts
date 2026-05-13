import {
  createLayer,
  transformLayer,
  wrapShiftLayer,
} from "@headless-paint/core";
import type {
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
  applyDuplicateLayerCommand,
  applyMergeLayerDownCommand,
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
  getAffectedLayerIds,
  getCommandAt,
  isCustomCommand,
  isStructuralCommand,
  mergeLayerDownAtomic,
  pushCommand,
  rebuildLayerFromHistory,
  redo,
  undo,
} from "@headless-paint/core";
import type {
  Command,
  HistoryConfig,
  HistoryState,
} from "@headless-paint/core";
import type { mat3 } from "gl-matrix";
import { useCallback, useMemo, useRef, useState } from "react";
import type { InitialLayer, LayerEntry } from "./useLayers";
import { useLayers } from "./useLayers";
import type {
  StrokeCompleteData,
  StrokeStartOptions,
} from "./useStrokeSession";
import { useStrokeSession } from "./useStrokeSession";

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
  } = config;

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
    reinsertLayer,
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

  const session = useStrokeSession({
    layer: activeEntry?.committedLayer ?? null,
    pendingLayer,
    strokeStyle,
    compiledFilterPipeline,
    expandConfig,
    compiledExpand,
    onStrokeComplete,
    registry,
  });

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
  const handleUndo = useCallback(() => {
    const prev = historyStateRef.current;
    if (!checkCanUndo(prev)) return;
    const undoneCommand = getCommandAt(prev, prev.currentIndex);
    if (!undoneCommand) return;
    const newState = undo(prev);

    if (isCustomCommand(undoneCommand)) {
      customCommandHandlerRef.current?.undo(undoneCommand, {
        entries: entriesRef.current,
        findEntry,
        bumpRenderVersion,
      });
    } else if (undoneCommand.type === "wrap-shift") {
      for (const entry of entriesRef.current) {
        wrapShiftLayer(
          entry.committedLayer,
          -undoneCommand.dx,
          -undoneCommand.dy,
          shiftTempCanvas,
        );
      }
    } else if (isStructuralCommand(undoneCommand)) {
      switch (undoneCommand.type) {
        case "add-layer":
          removeLayerById(undoneCommand.layerId);
          break;
        case "remove-layer": {
          const entry = reinsertLayer(
            undoneCommand.layerId,
            undoneCommand.removedIndex,
            undoneCommand.meta,
          );
          const result = rebuildLayerFromHistory(
            entry.committedLayer,
            newState,
            registryRef.current,
          );
          if (!result.ok) {
            console.warn(
              `[headless-paint] undo skipped remove-layer rebuild: ${result.reason} layerId=${result.layerId}`,
            );
          }
          break;
        }
        case "reorder-layer": {
          if (undoneCommand.toIndex > undoneCommand.fromIndex) {
            moveLayerDownRaw(undoneCommand.layerId);
          } else {
            moveLayerUpRaw(undoneCommand.layerId);
          }
          break;
        }
        case "duplicate-layer":
          removeLayerById(undoneCommand.layerId);
          setActiveLayerId(undoneCommand.sourceLayerId);
          break;
        case "merge-layer-down": {
          const sourceEntry = reinsertLayer(
            undoneCommand.sourceLayerId,
            undoneCommand.sourceIndex,
            undoneCommand.sourceMeta,
          );
          const targetEntry = findEntry(undoneCommand.targetLayerId);
          if (targetEntry) {
            targetEntry.committedLayer.meta.name =
              undoneCommand.targetMetaBefore.name;
            targetEntry.committedLayer.meta.visible =
              undoneCommand.targetMetaBefore.visible;
            targetEntry.committedLayer.meta.opacity =
              undoneCommand.targetMetaBefore.opacity;
            targetEntry.committedLayer.meta.alphaLocked =
              undoneCommand.targetMetaBefore.alphaLocked;
            targetEntry.committedLayer.meta.compositeOperation =
              undoneCommand.targetMetaBefore.compositeOperation;
          }
          for (const entry of [sourceEntry, targetEntry]) {
            if (!entry) continue;
            const result = rebuildLayerFromHistory(
              entry.committedLayer,
              newState,
              registryRef.current,
            );
            if (!result.ok) {
              console.warn(
                `[headless-paint] undo skipped merge-layer-down rebuild: ${result.reason} layerId=${result.layerId}`,
              );
              return;
            }
          }
          setActiveLayerId(undoneCommand.sourceLayerId);
          break;
        }
      }
    } else {
      const affected = getAffectedLayerIds(
        prev,
        newState.currentIndex,
        prev.currentIndex,
      );
      const ids =
        affected.type === "all"
          ? entriesRef.current.map((e) => e.id)
          : affected.layerIds;
      for (const id of ids) {
        const e = findEntry(id);
        if (!e) continue;
        const result = rebuildLayerFromHistory(
          e.committedLayer,
          newState,
          registryRef.current,
        );
        if (!result.ok) {
          console.warn(
            `[headless-paint] undo skipped layer rebuild: ${result.reason} layerId=${result.layerId}`,
          );
          return;
        }
        if (!e.committedLayer.meta.visible) {
          setLayerVisible(e.id, true);
        }
      }
    }

    bumpRenderVersion();
    commitHistoryState(newState);
  }, [
    entriesRef,
    shiftTempCanvas,
    findEntry,
    removeLayerById,
    reinsertLayer,
    moveLayerUpRaw,
    moveLayerDownRaw,
    setLayerVisible,
    setActiveLayerId,
    commitHistoryState,
    bumpRenderVersion,
  ]);

  const handleRedo = useCallback(() => {
    const prev = historyStateRef.current;
    if (!checkCanRedo(prev)) return;
    const newState = redo(prev);
    const redoneCommand = getCommandAt(newState, newState.currentIndex);
    if (!redoneCommand) return;

    if (isCustomCommand(redoneCommand)) {
      customCommandHandlerRef.current?.apply(redoneCommand, {
        entries: entriesRef.current,
        findEntry,
        bumpRenderVersion,
      });
    } else if (redoneCommand.type === "wrap-shift") {
      for (const entry of entriesRef.current) {
        wrapShiftLayer(
          entry.committedLayer,
          redoneCommand.dx,
          redoneCommand.dy,
          shiftTempCanvas,
        );
      }
    } else if (isStructuralCommand(redoneCommand)) {
      switch (redoneCommand.type) {
        case "add-layer":
          reinsertLayer(
            redoneCommand.layerId,
            redoneCommand.insertIndex,
            redoneCommand.meta,
          );
          break;
        case "remove-layer":
          removeLayerById(redoneCommand.layerId);
          break;
        case "reorder-layer": {
          if (redoneCommand.toIndex > redoneCommand.fromIndex) {
            moveLayerUpRaw(redoneCommand.layerId);
          } else {
            moveLayerDownRaw(redoneCommand.layerId);
          }
          break;
        }
        case "duplicate-layer": {
          const result = applyDuplicateLayerCommand(
            entriesRef.current.map((e) => e.committedLayer),
            redoneCommand,
          );
          if (!result) {
            console.warn(
              `[headless-paint] redo skipped duplicate-layer apply: layerId=${redoneCommand.layerId}`,
            );
            return;
          }
          replaceEntries(result.layers, redoneCommand.layerId);
          break;
        }
        case "merge-layer-down": {
          const result = applyMergeLayerDownCommand(
            entriesRef.current.map((e) => e.committedLayer),
            redoneCommand,
          );
          if (!result) {
            console.warn(
              `[headless-paint] redo skipped merge-layer-down apply: sourceLayerId=${redoneCommand.sourceLayerId}`,
            );
            return;
          }
          replaceEntries(result.layers, redoneCommand.targetLayerId);
          break;
        }
      }
    } else {
      const affected = getAffectedLayerIds(
        newState,
        prev.currentIndex,
        newState.currentIndex,
      );
      const ids =
        affected.type === "all"
          ? entriesRef.current.map((e) => e.id)
          : affected.layerIds;
      for (const id of ids) {
        const e = findEntry(id);
        if (!e) continue;
        const result = rebuildLayerFromHistory(
          e.committedLayer,
          newState,
          registryRef.current,
        );
        if (!result.ok) {
          console.warn(
            `[headless-paint] redo skipped layer rebuild: ${result.reason} layerId=${result.layerId}`,
          );
          return;
        }
        if (!e.committedLayer.meta.visible) {
          setLayerVisible(e.id, true);
        }
      }
    }

    bumpRenderVersion();
    commitHistoryState(newState);
  }, [
    entriesRef,
    shiftTempCanvas,
    findEntry,
    removeLayerById,
    reinsertLayer,
    replaceEntries,
    moveLayerUpRaw,
    moveLayerDownRaw,
    setLayerVisible,
    commitHistoryState,
    bumpRenderVersion,
  ]);

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
