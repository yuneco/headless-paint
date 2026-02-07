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
  createHistoryState,
  createStrokeCommand,
  createWrapShiftCommand,
  pushCommand,
  rebuildLayerState,
  redo,
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

  const committedLayer = useMemo(
    () => createLayer(LAYER_WIDTH, LAYER_HEIGHT),
    [],
  );
  const pendingLayer = useMemo(
    () => createLayer(LAYER_WIDTH, LAYER_HEIGHT),
    [],
  );

  const [strokePoints, setStrokePoints] = useState<InputPoint[]>([]);
  const [renderVersion, setRenderVersion] = useState(0);

  const [background] = useState<BackgroundSettings>({
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
  } | null>(null);

  const expandRef = useRef(expand);
  expandRef.current = expand;

  const onStrokeStart = useCallback(
    (inputPoint: InputPoint) => {
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
      };

      pendingLayer.meta.compositeOperation = strokeStyle.compositeOperation;

      appendToCommittedLayer(
        committedLayer,
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
      setRenderVersion((n) => n + 1);
    },
    [committedLayer, pendingLayer, compiledFilterPipeline, strokeStyle],
  );

  const onStrokeMove = useCallback(
    (inputPoint: InputPoint) => {
      if (!sessionRef.current) return;

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
        committedLayer,
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
      setRenderVersion((n) => n + 1);
    },
    [committedLayer, pendingLayer, strokeStyle],
  );

  const onStrokeEnd = useCallback(() => {
    if (!sessionRef.current) {
      setStrokePoints([]);
      return;
    }

    const { inputPoints, strokeSession, filterState, compiledFilterPipeline } =
      sessionRef.current;

    const finalOutput = finalizePipeline(filterState, compiledFilterPipeline);

    // finalize で確定した残りの点を session に反映し、描画更新を取得
    const finalStrokeResult = addPointToSession(strokeSession, finalOutput);

    // finalize で新たに確定した点を committed layer に描画
    appendToCommittedLayer(
      committedLayer,
      finalStrokeResult.renderUpdate.newlyCommitted,
      strokeStyle,
      sessionRef.current.compiledExpand,
    );

    const totalPoints = finalStrokeResult.state.allCommitted.length;

    if (totalPoints >= 2) {
      const command = createStrokeCommand(
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
        pushCommand(prev, command, committedLayer, HISTORY_CONFIG),
      );
    }

    clearLayer(pendingLayer);
    pendingLayer.meta.compositeOperation = undefined;
    setRenderVersion((n) => n + 1);

    sessionRef.current = null;
    setStrokePoints([]);
  }, [committedLayer, pendingLayer, strokeStyle]);

  const handleWrapShift = useCallback(
    (dx: number, dy: number) => {
      wrapShiftLayer(committedLayer, dx, dy, shiftTempCanvas);
      dragShiftRef.current = {
        x: dragShiftRef.current.x + dx,
        y: dragShiftRef.current.y + dy,
      };
      setRenderVersion((n) => n + 1);
    },
    [committedLayer, shiftTempCanvas],
  );

  const handleWrapShiftEnd = useCallback(
    (totalDx: number, totalDy: number) => {
      dragShiftRef.current = { x: 0, y: 0 };
      if (totalDx === 0 && totalDy === 0) return;
      const command = createWrapShiftCommand(totalDx, totalDy);
      setHistoryState((prev) =>
        pushCommand(prev, command, committedLayer, HISTORY_CONFIG),
      );
    },
    [committedLayer],
  );

  const handleResetOffset = useCallback(() => {
    setHistoryState((prev) => {
      const { x, y } = computeCumulativeOffset(prev);
      if (x === 0 && y === 0) return prev;
      wrapShiftLayer(committedLayer, -x, -y, shiftTempCanvas);
      const command = createWrapShiftCommand(-x, -y);
      setRenderVersion((n) => n + 1);
      return pushCommand(prev, command, committedLayer, HISTORY_CONFIG);
    });
  }, [committedLayer, shiftTempCanvas]);

  const handleUndo = useCallback(() => {
    setHistoryState((prev) => {
      if (!canUndo(prev)) return prev;
      const newState = undo(prev);
      clearLayer(committedLayer);
      rebuildLayerState(committedLayer, newState);
      setRenderVersion((n) => n + 1);
      return newState;
    });
  }, [committedLayer]);

  const handleRedo = useCallback(() => {
    setHistoryState((prev) => {
      if (!canRedo(prev)) return prev;
      const newState = redo(prev);
      clearLayer(committedLayer);
      rebuildLayerState(committedLayer, newState);
      setRenderVersion((n) => n + 1);
      return newState;
    });
  }, [committedLayer]);

  useKeyboardShortcuts({
    tool,
    setTool: handleToolChange,
    sessionRef,
    onUndo: handleUndo,
    onRedo: handleRedo,
    expandMode: expand.config.mode,
    setExpandMode: expand.setMode,
    expandDivisions: expand.config.divisions,
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

  const layers: Layer[] = useMemo(
    () => [committedLayer, pendingLayer],
    [committedLayer, pendingLayer],
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
        onStrokeStart={onStrokeStart}
        onStrokeMove={onStrokeMove}
        onStrokeEnd={onStrokeEnd}
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
          onReset={fitToView}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo(historyState)}
          canRedo={canRedo(historyState)}
          color={penSettings.color}
          onColorChange={penSettings.setColor}
        />
      </div>

      <SidebarPanel
        layer={committedLayer}
        viewTransform={transform}
        mainCanvasWidth={viewWidth}
        mainCanvasHeight={viewHeight}
        renderVersion={renderVersion}
        historyState={historyState}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo(historyState)}
        canRedo={canRedo(historyState)}
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
