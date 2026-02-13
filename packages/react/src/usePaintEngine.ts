import { createLayer, wrapShiftLayer } from "@headless-paint/engine";
import type {
  BrushTipRegistry,
  CompiledExpand,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import type { CompiledFilterPipeline, InputPoint } from "@headless-paint/input";
import {
  canRedo as checkCanRedo,
  canUndo as checkCanUndo,
  computeCumulativeOffset,
  createAddLayerCommand,
  createHistoryState,
  createRemoveLayerCommand,
  createReorderLayerCommand,
  createStrokeCommand,
  createWrapShiftCommand,
  getAffectedLayerIds,
  isStructuralCommand,
  pushCommand,
  rebuildLayerFromHistory,
  redo,
  restoreFromCheckpoint,
  undo,
} from "@headless-paint/stroke";
import type { HistoryConfig, HistoryState } from "@headless-paint/stroke";
import { useCallback, useMemo, useRef, useState } from "react";
import type { LayerEntry } from "./useLayers";
import { useLayers } from "./useLayers";
import type {
  StrokeCompleteData,
  StrokeStartOptions,
} from "./useStrokeSession";
import { useStrokeSession } from "./useStrokeSession";

export interface PaintEngineConfig {
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly strokeStyle: StrokeStyle;
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  readonly expandConfig: ExpandConfig;
  readonly compiledExpand: CompiledExpand;
  readonly historyConfig?: HistoryConfig;
  readonly registry?: BrushTipRegistry;
}

export interface PaintEngineResult {
  // ── レイヤー ──
  readonly entries: readonly LayerEntry[];
  readonly activeLayerId: string | null;
  readonly activeEntry: LayerEntry | undefined;
  readonly setActiveLayerId: (id: string | null) => void;
  readonly toggleVisibility: (layerId: string) => void;
  readonly renameLayer: (layerId: string, name: string) => void;

  // ── レイヤー操作（履歴に自動記録される） ──
  readonly addLayer: () => void;
  readonly removeLayer: (layerId: string) => void;
  readonly moveLayerUp: (layerId: string) => void;
  readonly moveLayerDown: (layerId: string) => void;

  // ── ストローク ──
  readonly onStrokeStart: (
    point: InputPoint,
    options?: StrokeStartOptions,
  ) => void;
  readonly onStrokeMove: (point: InputPoint) => void;
  readonly onStrokeEnd: () => void;
  readonly onDrawConfirm: () => void;
  readonly onDrawCancel: () => void;

  // ── Wrap shift ──
  readonly onWrapShift: (dx: number, dy: number) => void;
  readonly onWrapShiftEnd: (totalDx: number, totalDy: number) => void;
  readonly onResetOffset: () => void;
  readonly cumulativeOffset: { readonly x: number; readonly y: number };

  // ── 履歴 ──
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly historyState: HistoryState;

  // ── レンダリング ──
  readonly pendingLayer: Layer;
  readonly layers: readonly Layer[];
  readonly renderVersion: number;
  readonly canDraw: boolean;
  readonly strokePoints: readonly InputPoint[];
}

const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
};

export function usePaintEngine(config: PaintEngineConfig): PaintEngineResult {
  const {
    layerWidth,
    layerHeight,
    strokeStyle,
    compiledFilterPipeline,
    expandConfig,
    compiledExpand,
    historyConfig = DEFAULT_HISTORY_CONFIG,
    registry,
  } = config;

  const registryRef = useRef(registry);
  registryRef.current = registry;

  // ── レイヤー管理 ──
  const layerManager = useLayers(layerWidth, layerHeight);
  const {
    entries,
    entriesRef,
    activeLayerId,
    activeEntry,
    addLayer: addLayerRaw,
    removeLayer: removeLayerById,
    reinsertLayer,
    setActiveLayerId,
    toggleVisibility,
    renameLayer,
    setLayerVisible,
    moveLayerUp: moveLayerUpRaw,
    moveLayerDown: moveLayerDownRaw,
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
  const [historyState, setHistoryState] = useState<HistoryState>(() =>
    createHistoryState(layerWidth, layerHeight),
  );

  const historyConfigRef = useRef(historyConfig);
  historyConfigRef.current = historyConfig;

  // ── Wrap shift ──
  const shiftTempCanvas = useMemo(
    () => new OffscreenCanvas(layerWidth, layerHeight),
    [layerWidth, layerHeight],
  );

  const dragShiftRef = useRef({ x: 0, y: 0 });

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
      );
      setHistoryState((prev) =>
        pushCommand(
          prev,
          command,
          currentEntry.committedLayer,
          historyConfigRef.current,
        ),
      );
    },
    [findEntry, activeLayerId],
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
    setHistoryState((prev) =>
      pushCommand(prev, command, null, historyConfigRef.current),
    );
  }, [addLayerRaw, layerWidth, layerHeight]);

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
      setHistoryState((prev) =>
        pushCommand(
          prev,
          command,
          entry.committedLayer,
          historyConfigRef.current,
        ),
      );
      removeLayerById(layerId);
    },
    [findEntry, getLayerIndex, removeLayerById],
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
      setHistoryState((prev) =>
        pushCommand(prev, command, null, historyConfigRef.current),
      );
    },
    [moveLayerUpRaw],
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
      setHistoryState((prev) =>
        pushCommand(prev, command, null, historyConfigRef.current),
      );
    },
    [moveLayerDownRaw],
  );

  // ── Wrap shift ──
  const handleWrapShift = useCallback(
    (dx: number, dy: number) => {
      for (const entry of entriesRef.current) {
        wrapShiftLayer(entry.committedLayer, dx, dy, shiftTempCanvas);
      }
      dragShiftRef.current = {
        x: dragShiftRef.current.x + dx,
        y: dragShiftRef.current.y + dy,
      };
      bumpRenderVersion();
    },
    [entriesRef, shiftTempCanvas, bumpRenderVersion],
  );

  const handleWrapShiftEnd = useCallback((totalDx: number, totalDy: number) => {
    dragShiftRef.current = { x: 0, y: 0 };
    if (totalDx === 0 && totalDy === 0) return;
    const command = createWrapShiftCommand(totalDx, totalDy);
    setHistoryState((prev) =>
      pushCommand(prev, command, null, historyConfigRef.current),
    );
  }, []);

  const handleResetOffset = useCallback(() => {
    setHistoryState((prev) => {
      const { x, y } = computeCumulativeOffset(prev);
      if (x === 0 && y === 0) return prev;
      for (const entry of entriesRef.current) {
        wrapShiftLayer(entry.committedLayer, -x, -y, shiftTempCanvas);
      }
      const command = createWrapShiftCommand(-x, -y);
      bumpRenderVersion();
      return pushCommand(prev, command, null, historyConfigRef.current);
    });
  }, [entriesRef, shiftTempCanvas, bumpRenderVersion]);

  // ── Undo/Redo ──
  const handleUndo = useCallback(() => {
    setHistoryState((prev) => {
      if (!checkCanUndo(prev)) return prev;
      const undoneCommand = prev.commands[prev.currentIndex];
      const newState = undo(prev);

      if (undoneCommand.type === "wrap-shift") {
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
            const cp = newState.checkpoints.find(
              (c) =>
                c.layerId === undoneCommand.layerId &&
                c.commandIndex === prev.currentIndex,
            );
            if (cp) {
              restoreFromCheckpoint(entry.committedLayer, cp);
            } else {
              rebuildLayerFromHistory(
                entry.committedLayer,
                newState,
                registryRef.current,
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
        }
      } else {
        const affectedIds = getAffectedLayerIds(
          prev,
          newState.currentIndex,
          prev.currentIndex,
        );
        for (const id of affectedIds) {
          const e = findEntry(id);
          if (!e) continue;
          rebuildLayerFromHistory(
            e.committedLayer,
            newState,
            registryRef.current,
          );
          if (!e.committedLayer.meta.visible) {
            setLayerVisible(e.id, true);
          }
        }
      }

      bumpRenderVersion();
      return newState;
    });
  }, [
    entriesRef,
    shiftTempCanvas,
    findEntry,
    removeLayerById,
    reinsertLayer,
    moveLayerUpRaw,
    moveLayerDownRaw,
    setLayerVisible,
    bumpRenderVersion,
  ]);

  const handleRedo = useCallback(() => {
    setHistoryState((prev) => {
      if (!checkCanRedo(prev)) return prev;
      const newState = redo(prev);
      const redoneCommand = newState.commands[newState.currentIndex];

      if (redoneCommand.type === "wrap-shift") {
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
        }
      } else {
        const affectedIds = getAffectedLayerIds(
          newState,
          prev.currentIndex,
          newState.currentIndex,
        );
        for (const id of affectedIds) {
          const e = findEntry(id);
          if (!e) continue;
          rebuildLayerFromHistory(
            e.committedLayer,
            newState,
            registryRef.current,
          );
          if (!e.committedLayer.meta.visible) {
            setLayerVisible(e.id, true);
          }
        }
      }

      bumpRenderVersion();
      return newState;
    });
  }, [
    entriesRef,
    shiftTempCanvas,
    findEntry,
    removeLayerById,
    reinsertLayer,
    moveLayerUpRaw,
    moveLayerDownRaw,
    setLayerVisible,
    bumpRenderVersion,
  ]);

  // ── レイヤー配列構築 ──
  const combinedRenderVersion = layerRenderVersion + session.renderVersion;

  // biome-ignore lint/correctness/useExhaustiveDependencies: combinedRenderVersion は canvas 更新を検知する再描画トリガー
  const layers: readonly Layer[] = useMemo(() => {
    const result: Layer[] = [];
    for (const entry of entries) {
      result.push(entry.committedLayer);
      if (entry.id === activeLayerId) {
        result.push(pendingLayer);
      }
    }
    return result;
  }, [entries, activeLayerId, pendingLayer, combinedRenderVersion]);

  // ── Cumulative offset ──
  const cumulativeOffsetFromHistory = computeCumulativeOffset(historyState);
  const cumulativeOffset = {
    x: cumulativeOffsetFromHistory.x + dragShiftRef.current.x,
    y: cumulativeOffsetFromHistory.y + dragShiftRef.current.y,
  };

  return {
    // レイヤー
    entries,
    activeLayerId,
    activeEntry,
    setActiveLayerId,
    toggleVisibility,
    renameLayer,

    // レイヤー操作（履歴付き）
    addLayer: handleAddLayer,
    removeLayer: handleRemoveLayer,
    moveLayerUp: handleMoveLayerUp,
    moveLayerDown: handleMoveLayerDown,

    // ストローク
    onStrokeStart: session.onStrokeStart,
    onStrokeMove: session.onStrokeMove,
    onStrokeEnd: session.onStrokeEnd,
    onDrawConfirm: session.onDrawConfirm,
    onDrawCancel: session.onDrawCancel,

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
    renderVersion: combinedRenderVersion,
    canDraw: session.canDraw,
    strokePoints: session.strokePoints,
  };
}
