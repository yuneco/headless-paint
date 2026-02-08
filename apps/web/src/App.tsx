import {
  DEFAULT_BACKGROUND_COLOR,
  appendToCommittedLayer,
  clearLayer,
  createLayer,
  renderPendingLayer,
  wrapShiftLayer,
} from "@headless-paint/engine";
import type {
  BackgroundSettings,
  CompiledExpand,
  Layer,
} from "@headless-paint/engine";
import {
  createFilterPipelineState,
  finalizePipeline,
  processPoint,
} from "@headless-paint/input";
import type {
  CompiledFilterPipeline,
  FilterPipelineState,
  InputPoint,
} from "@headless-paint/input";
import {
  addPointToSession,
  canRedo,
  canUndo,
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
  startStrokeSession,
  undo,
} from "@headless-paint/stroke";
import type {
  HistoryConfig,
  HistoryState,
  StrokeSessionState,
} from "@headless-paint/stroke";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebugPanel } from "./components/DebugPanel";
import { PaintCanvas } from "./components/PaintCanvas";
import { SidebarPanel } from "./components/SidebarPanel";
import { SymmetryOverlay } from "./components/SymmetryOverlay";
import { Toolbar } from "./components/Toolbar";
import { useExpand } from "./hooks/useExpand";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLayers } from "./hooks/useLayers";
import { usePatternPreview } from "./hooks/usePatternPreview";
import { usePenSettings } from "./hooks/usePenSettings";
import type { ToolType } from "./hooks/usePointerHandler";
import { useSmoothing } from "./hooks/useSmoothing";
import { useViewTransform } from "./hooks/useViewTransform";
import { useWindowSize } from "./hooks/useWindowSize";

const LAYER_WIDTH = 1024;
const LAYER_HEIGHT = 1024;

const HISTORY_CONFIG: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
};

export function App() {
  const [tool, setTool] = useState<ToolType>("pen");
  const { width: viewWidth, height: viewHeight } = useWindowSize();
  const { transform, handlePan, handleZoom, handleRotate, setInitialFit } =
    useViewTransform();

  const fitToView = useCallback(() => {
    setInitialFit(viewWidth, viewHeight, LAYER_WIDTH, LAYER_HEIGHT);
  }, [viewWidth, viewHeight, setInitialFit]);

  // 初回マウント時にレイヤーがビュー中央にフィットするよう初期化
  const initialFitDone = useRef(false);
  useEffect(() => {
    if (!initialFitDone.current) {
      fitToView();
      initialFitDone.current = true;
    }
  }, [fitToView]);

  // レイヤー管理
  const layerManager = useLayers(LAYER_WIDTH, LAYER_HEIGHT);
  const {
    entries,
    entriesRef,
    activeLayerId,
    activeEntry,
    addLayer,
    removeLayer: removeLayerById,
    reinsertLayer,
    setActiveLayerId,
    toggleVisibility,
    setLayerVisible,
    moveLayerUp,
    moveLayerDown,
    findEntry,
    getLayerIndex,
    renderVersion,
    bumpRenderVersion,
  } = layerManager;

  // 共有 pending layer
  const pendingLayer = useMemo(
    () => createLayer(LAYER_WIDTH, LAYER_HEIGHT),
    [],
  );

  const [strokePoints, setStrokePoints] = useState<InputPoint[]>([]);

  const [background, setBackground] = useState<BackgroundSettings>({
    color: DEFAULT_BACKGROUND_COLOR,
    visible: true,
  });

  const expand = useExpand(LAYER_WIDTH, LAYER_HEIGHT);
  const smoothing = useSmoothing();
  const { compiledFilterPipeline } = smoothing;

  const [historyState, setHistoryState] = useState<HistoryState>(() =>
    createHistoryState(LAYER_WIDTH, LAYER_HEIGHT),
  );

  const penSettings = usePenSettings();
  const { strokeStyle } = penSettings;
  const patternPreview = usePatternPreview();

  const handleToolChange = useCallback(
    (newTool: ToolType) => {
      setTool(newTool);
      penSettings.setEraser(newTool === "eraser");
    },
    [penSettings.setEraser],
  );

  const shiftTempCanvas = useMemo(
    () => new OffscreenCanvas(LAYER_WIDTH, LAYER_HEIGHT),
    [],
  );

  const dragShiftRef = useRef({ x: 0, y: 0 });

  const sessionRef = useRef<{
    strokeSession: StrokeSessionState;
    filterState: FilterPipelineState;
    inputPoints: InputPoint[];
    compiledExpand: CompiledExpand;
    compiledFilterPipeline: CompiledFilterPipeline;
    layerId: string;
  } | null>(null);

  const expandRef = useRef(expand);
  expandRef.current = expand;

  // 描画可否判定
  const canDraw = activeEntry?.committedLayer.meta.visible ?? false;

  const onStrokeStart = useCallback(
    (inputPoint: InputPoint) => {
      if (!activeEntry || !activeEntry.committedLayer.meta.visible) return;

      const compiled = expandRef.current.compiled;
      const filterState = createFilterPipelineState(compiledFilterPipeline);
      const filterResult = processPoint(
        filterState,
        inputPoint,
        compiledFilterPipeline,
      );

      const strokeResult = startStrokeSession(
        filterResult.output,
        strokeStyle,
        expandRef.current.config,
      );

      sessionRef.current = {
        strokeSession: strokeResult.state,
        filterState: filterResult.state,
        inputPoints: [inputPoint],
        compiledExpand: compiled,
        compiledFilterPipeline,
        layerId: activeEntry.id,
      };

      pendingLayer.meta.compositeOperation = strokeStyle.compositeOperation;

      appendToCommittedLayer(
        activeEntry.committedLayer,
        strokeResult.renderUpdate.newlyCommitted,
        strokeStyle,
        compiled,
      );
      renderPendingLayer(
        pendingLayer,
        strokeResult.renderUpdate.currentPending,
        strokeStyle,
        compiled,
      );

      setStrokePoints([inputPoint]);
      bumpRenderVersion();
    },
    [
      activeEntry,
      pendingLayer,
      compiledFilterPipeline,
      strokeStyle,
      bumpRenderVersion,
    ],
  );

  const onStrokeMove = useCallback(
    (inputPoint: InputPoint) => {
      if (!sessionRef.current) return;

      const currentEntry = findEntry(sessionRef.current.layerId);
      if (!currentEntry) return;

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

      appendToCommittedLayer(
        currentEntry.committedLayer,
        strokeResult.renderUpdate.newlyCommitted,
        strokeStyle,
        sessionRef.current.compiledExpand,
      );
      renderPendingLayer(
        pendingLayer,
        strokeResult.renderUpdate.currentPending,
        strokeStyle,
        sessionRef.current.compiledExpand,
      );

      setStrokePoints((prev) => [...prev, inputPoint]);
      bumpRenderVersion();
    },
    [pendingLayer, strokeStyle, findEntry, bumpRenderVersion],
  );

  const onStrokeEnd = useCallback(() => {
    if (!sessionRef.current) {
      setStrokePoints([]);
      return;
    }

    const {
      inputPoints,
      strokeSession,
      filterState,
      compiledFilterPipeline,
      layerId,
    } = sessionRef.current;

    const currentEntry = findEntry(layerId);
    if (!currentEntry) {
      sessionRef.current = null;
      setStrokePoints([]);
      return;
    }

    const finalOutput = finalizePipeline(filterState, compiledFilterPipeline);
    const finalStrokeResult = addPointToSession(strokeSession, finalOutput);

    appendToCommittedLayer(
      currentEntry.committedLayer,
      finalStrokeResult.renderUpdate.newlyCommitted,
      strokeStyle,
      sessionRef.current.compiledExpand,
    );

    const totalPoints = finalStrokeResult.state.allCommitted.length;

    if (totalPoints >= 2) {
      const command = createStrokeCommand(
        layerId,
        inputPoints,
        compiledFilterPipeline.config,
        strokeSession.expand,
        strokeStyle.color,
        strokeStyle.lineWidth,
        strokeStyle.pressureSensitivity,
        strokeStyle.pressureCurve,
        strokeStyle.compositeOperation,
      );
      setHistoryState((prev) =>
        pushCommand(prev, command, currentEntry.committedLayer, HISTORY_CONFIG),
      );
    }

    clearLayer(pendingLayer);
    pendingLayer.meta.compositeOperation = undefined;
    bumpRenderVersion();

    sessionRef.current = null;
    setStrokePoints([]);
  }, [pendingLayer, strokeStyle, findEntry, bumpRenderVersion]);

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
    setHistoryState((prev) => pushCommand(prev, command, null, HISTORY_CONFIG));
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
      return pushCommand(prev, command, null, HISTORY_CONFIG);
    });
  }, [entriesRef, shiftTempCanvas, bumpRenderVersion]);

  // レイヤー構造操作ハンドラ
  const handleAddLayer = useCallback(() => {
    const { entry, insertIndex } = addLayer();
    const command = createAddLayerCommand(
      entry.id,
      insertIndex,
      LAYER_WIDTH,
      LAYER_HEIGHT,
      entry.committedLayer.meta,
    );
    setHistoryState((prev) => pushCommand(prev, command, null, HISTORY_CONFIG));
  }, [addLayer]);

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
        pushCommand(prev, command, entry.committedLayer, HISTORY_CONFIG),
      );
      removeLayerById(layerId);
    },
    [findEntry, getLayerIndex, removeLayerById],
  );

  const handleMoveLayerUp = useCallback(
    (layerId: string) => {
      const result = moveLayerUp(layerId);
      if (!result) return;
      const command = createReorderLayerCommand(
        layerId,
        result.fromIndex,
        result.toIndex,
      );
      setHistoryState((prev) =>
        pushCommand(prev, command, null, HISTORY_CONFIG),
      );
    },
    [moveLayerUp],
  );

  const handleMoveLayerDown = useCallback(
    (layerId: string) => {
      const result = moveLayerDown(layerId);
      if (!result) return;
      const command = createReorderLayerCommand(
        layerId,
        result.fromIndex,
        result.toIndex,
      );
      setHistoryState((prev) =>
        pushCommand(prev, command, null, HISTORY_CONFIG),
      );
    },
    [moveLayerDown],
  );

  const handleToggleBackground = useCallback(() => {
    setBackground((prev) => ({ ...prev, visible: !prev.visible }));
    bumpRenderVersion();
  }, [bumpRenderVersion]);

  const handleUndo = useCallback(() => {
    setHistoryState((prev) => {
      if (!canUndo(prev)) return prev;
      const undoneCommand = prev.commands[prev.currentIndex];
      const newState = undo(prev);

      if (undoneCommand.type === "wrap-shift") {
        // グローバル: 全レイヤーに逆シフト（リビルド不要の高速パス）
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
              rebuildLayerFromHistory(entry.committedLayer, newState);
            }
            break;
          }
          case "reorder-layer": {
            // 逆方向に移動
            const currentEntries = layerManager.entries;
            const currentIndex = currentEntries.findIndex(
              (e) => e.id === undoneCommand.layerId,
            );
            if (currentIndex !== -1) {
              if (undoneCommand.toIndex > undoneCommand.fromIndex) {
                moveLayerDown(undoneCommand.layerId);
              } else {
                moveLayerUp(undoneCommand.layerId);
              }
            }
            break;
          }
        }
      } else {
        // レイヤー描画コマンド: 影響レイヤーのみリビルド
        const affectedIds = getAffectedLayerIds(
          prev,
          newState.currentIndex,
          prev.currentIndex,
        );
        for (const id of affectedIds) {
          const e = findEntry(id);
          if (!e) continue;
          rebuildLayerFromHistory(e.committedLayer, newState);
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
    moveLayerUp,
    moveLayerDown,
    setLayerVisible,
    bumpRenderVersion,
    layerManager.entries,
  ]);

  const handleRedo = useCallback(() => {
    setHistoryState((prev) => {
      if (!canRedo(prev)) return prev;
      const newState = redo(prev);
      const redoneCommand = newState.commands[newState.currentIndex];

      if (redoneCommand.type === "wrap-shift") {
        // グローバル: 全レイヤーに順シフト（リビルド不要の高速パス）
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
              moveLayerUp(redoneCommand.layerId);
            } else {
              moveLayerDown(redoneCommand.layerId);
            }
            break;
          }
        }
      } else {
        // レイヤー描画コマンド: 影響レイヤーのみリビルド
        const affectedIds = getAffectedLayerIds(
          newState,
          prev.currentIndex,
          newState.currentIndex,
        );
        for (const id of affectedIds) {
          const e = findEntry(id);
          if (!e) continue;
          rebuildLayerFromHistory(e.committedLayer, newState);
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
    moveLayerUp,
    moveLayerDown,
    setLayerVisible,
    bumpRenderVersion,
  ]);

  useKeyboardShortcuts({
    tool,
    setTool: handleToolChange,
    sessionRef,
    onUndo: handleUndo,
    onRedo: handleRedo,
    expandMode: expand.config.levels[0].mode,
    setExpandMode: expand.setMode,
    expandDivisions: expand.config.levels[0].divisions,
    setExpandDivisions: expand.setDivisions,
    lineWidth: penSettings.lineWidth,
    setLineWidth: penSettings.setLineWidth,
  });

  const strokeCount = historyState.currentIndex + 1;
  const cumulativeOffset = computeCumulativeOffset(historyState);
  const currentOffset = {
    x: cumulativeOffset.x + dragShiftRef.current.x,
    y: cumulativeOffset.y + dragShiftRef.current.y,
  };

  // レイヤー配列構築: 全committed + pending をアクティブレイヤーの直後に挿入
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderVersionはlayers内部のcanvas更新を検知する再描画トリガー
  const layers: Layer[] = useMemo(() => {
    const result: Layer[] = [];
    for (const entry of entries) {
      result.push(entry.committedLayer);
      if (entry.id === activeLayerId) {
        result.push(pendingLayer);
      }
    }
    return result;
  }, [entries, activeLayerId, pendingLayer, renderVersion]);

  // レイヤーID→表示名の解決関数
  const layerIdToName = useCallback(
    (layerId: string) => {
      const entry = entries.find((e) => e.id === layerId);
      if (!entry) return "?";
      const idx = entries.indexOf(entry);
      return `L${idx + 1}`;
    },
    [entries],
  );

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <PaintCanvas
        layers={layers}
        transform={transform}
        background={background}
        patternPreview={patternPreview.config}
        tool={tool}
        onPan={handlePan}
        onZoom={handleZoom}
        onRotate={handleRotate}
        onStrokeStart={canDraw ? onStrokeStart : undefined}
        onStrokeMove={canDraw ? onStrokeMove : undefined}
        onStrokeEnd={canDraw ? onStrokeEnd : undefined}
        onWrapShift={handleWrapShift}
        onWrapShiftEnd={handleWrapShiftEnd}
        wrapOffset={currentOffset}
        width={viewWidth}
        height={viewHeight}
        layerWidth={LAYER_WIDTH}
        layerHeight={LAYER_HEIGHT}
        renderVersion={renderVersion}
      />

      <SymmetryOverlay
        config={expand.config}
        transform={transform}
        width={viewWidth}
        height={viewHeight}
        onSubOffsetChange={expand.setSubOffset}
      />

      {/* ツールバーを上部中央にオーバーレイ配置 */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
        }}
      >
        <Toolbar
          currentTool={tool}
          onToolChange={handleToolChange}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo(historyState)}
          canRedo={canRedo(historyState)}
          color={penSettings.color}
          onColorChange={penSettings.setColor}
        />
      </div>

      <SidebarPanel
        layers={layers}
        viewTransform={transform}
        mainCanvasWidth={viewWidth}
        mainCanvasHeight={viewHeight}
        renderVersion={renderVersion}
        historyState={historyState}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo(historyState)}
        canRedo={canRedo(historyState)}
        entries={entries}
        activeLayerId={activeLayerId}
        background={background}
        onSelectLayer={setActiveLayerId}
        onAddLayer={handleAddLayer}
        onRemoveLayer={handleRemoveLayer}
        onToggleVisibility={toggleVisibility}
        onToggleBackground={handleToggleBackground}
        onMoveUp={handleMoveLayerUp}
        onMoveDown={handleMoveLayerDown}
        layerIdToName={layerIdToName}
      />

      <DebugPanel
        transform={transform}
        strokeCount={strokeCount}
        expand={expand}
        smoothing={smoothing}
        penSettings={penSettings}
        patternPreview={patternPreview}
        layerOffset={currentOffset}
        onResetOffset={handleResetOffset}
      />
    </div>
  );
}
