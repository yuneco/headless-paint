import {
  appendToCommittedLayer,
  clearLayer,
  createLayer,
  renderPendingLayer,
} from "@headless-paint/engine";
import type { CompiledExpand, Layer } from "@headless-paint/engine";
import {
  createFilterPipelineState,
  finalizePipeline,
  processPoint,
} from "@headless-paint/input";
import type {
  CompiledFilterPipeline,
  FilterPipelineState,
  InputPoint,
  Point,
} from "@headless-paint/input";
import {
  addPointToSession,
  canRedo,
  canUndo,
  createHistoryState,
  createStrokeCommand,
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
  StrokeStyle,
} from "@headless-paint/stroke";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebugPanel } from "./components/DebugPanel";
import { PaintCanvas } from "./components/PaintCanvas";
import { SidebarPanel } from "./components/SidebarPanel";
import { SymmetryOverlay } from "./components/SymmetryOverlay";
import { Toolbar } from "./components/Toolbar";
import { useExpand } from "./hooks/useExpand";
import { useSmoothing } from "./hooks/useSmoothing";
import type { ToolType } from "./hooks/usePointerHandler";
import { useViewTransform } from "./hooks/useViewTransform";
import { useWindowSize } from "./hooks/useWindowSize";

const LAYER_WIDTH = 1024;
const LAYER_HEIGHT = 1024;

const PEN_COLOR = { r: 50, g: 50, b: 50, a: 255 };
const PEN_WIDTH = 3;

const HISTORY_CONFIG: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
};

export function App() {
  const [tool, setTool] = useState<ToolType>("pen");
  const { width: viewWidth, height: viewHeight } = useWindowSize();
  const {
    transform,
    handlePan,
    handleZoom,
    handleRotate,
    setInitialFit,
  } = useViewTransform();

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

  const [strokePoints, setStrokePoints] = useState<Point[]>([]);
  const [renderVersion, setRenderVersion] = useState(0);

  const expand = useExpand(LAYER_WIDTH, LAYER_HEIGHT);
  const smoothing = useSmoothing();
  const { compiledFilterPipeline } = smoothing;

  const [historyState, setHistoryState] = useState<HistoryState>(() =>
    createHistoryState(LAYER_WIDTH, LAYER_HEIGHT),
  );

  const strokeStyle: StrokeStyle = useMemo(
    () => ({
      color: PEN_COLOR,
      lineWidth: PEN_WIDTH,
    }),
    [],
  );

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
    (point: Point) => {
      const inputPoint: InputPoint = {
        x: point.x,
        y: point.y,
        timestamp: Date.now(),
      };

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

      setStrokePoints([point]);
      setRenderVersion((n) => n + 1);
    },
    [committedLayer, pendingLayer, compiledFilterPipeline, strokeStyle],
  );

  const onStrokeMove = useCallback(
    (point: Point) => {
      if (!sessionRef.current) return;

      const inputPoint: InputPoint = {
        x: point.x,
        y: point.y,
        timestamp: Date.now(),
      };

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

      setStrokePoints((prev) => [...prev, point]);
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
      );
      setHistoryState((prev) =>
        pushCommand(prev, command, committedLayer, HISTORY_CONFIG),
      );
    }

    clearLayer(pendingLayer);
    setRenderVersion((n) => n + 1);

    sessionRef.current = null;
    setStrokePoints([]);
  }, [committedLayer, pendingLayer, strokeStyle]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);

  const strokeCount = historyState.currentIndex + 1;

  const layers: Layer[] = useMemo(
    () => [committedLayer, pendingLayer],
    [committedLayer, pendingLayer],
  );

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <PaintCanvas
        layers={layers}
        transform={transform}
        tool={tool}
        onPan={handlePan}
        onZoom={handleZoom}
        onRotate={handleRotate}
        onStrokeStart={onStrokeStart}
        onStrokeMove={onStrokeMove}
        onStrokeEnd={onStrokeEnd}
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
          onToolChange={setTool}
          onReset={fitToView}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo(historyState)}
          canRedo={canRedo(historyState)}
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
      />
    </div>
  );
}
