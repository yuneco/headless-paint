import { clearLayer, createLayer, drawPath } from "@headless-paint/engine";
import {
  canRedo,
  canUndo,
  createHistoryState,
  createStrokeCommand,
  pushCommand,
  rebuildLayerState,
  redo,
  undo,
} from "@headless-paint/history";
import type { HistoryConfig, HistoryState } from "@headless-paint/history";
import type { Point, StrokeSessionState } from "@headless-paint/input";
import {
  addPointToSession,
  compilePipeline,
  endStrokeSession,
  startStrokeSession,
} from "@headless-paint/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebugPanel } from "./components/DebugPanel";
import { PaintCanvas } from "./components/PaintCanvas";
import { SidebarPanel } from "./components/SidebarPanel";
import { SymmetryOverlay } from "./components/SymmetryOverlay";
import { Toolbar } from "./components/Toolbar";
import type { ToolType } from "./hooks/usePointerHandler";
import { useSymmetry } from "./hooks/useSymmetry";
import { useViewTransform } from "./hooks/useViewTransform";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const LAYER_WIDTH = 1920;
const LAYER_HEIGHT = 1080;

const PEN_COLOR = { r: 50, g: 50, b: 50, a: 255 };
const PEN_WIDTH = 3;

const HISTORY_CONFIG: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
};

export function App() {
  const [tool, setTool] = useState<ToolType>("pen");
  const { transform, handlePan, handleZoom, handleRotate, reset } =
    useViewTransform();

  const layer = useMemo(() => createLayer(LAYER_WIDTH, LAYER_HEIGHT), []);

  const [strokePoints, setStrokePoints] = useState<Point[]>([]);
  const [renderVersion, setRenderVersion] = useState(0);

  // 対称設定
  const symmetry = useSymmetry(LAYER_WIDTH, LAYER_HEIGHT);

  // 履歴管理
  const [historyState, setHistoryState] = useState<HistoryState>(() =>
    createHistoryState(LAYER_WIDTH, LAYER_HEIGHT),
  );

  // パイプライン設定（対称設定からPipelineConfigを生成）
  const compiledPipeline = useMemo(() => {
    if (symmetry.config.mode === "none") {
      return compilePipeline({ transforms: [] });
    }
    return compilePipeline({
      transforms: [{ type: "symmetry", config: symmetry.config }],
    });
  }, [symmetry.config]);

  // ストロークセッション状態
  const sessionRef = useRef<StrokeSessionState | null>(null);
  const compiledPipelineRef = useRef(compiledPipeline);
  compiledPipelineRef.current = compiledPipeline;

  const onStrokeStart = useCallback((point: Point) => {
    const result = startStrokeSession(point, compiledPipelineRef.current);
    sessionRef.current = result.state;
    setStrokePoints([point]);
  }, []);

  const onStrokeMove = useCallback(
    (point: Point) => {
      if (!sessionRef.current) return;

      const result = addPointToSession(
        sessionRef.current,
        point,
        compiledPipelineRef.current,
      );
      sessionRef.current = result.state;

      setStrokePoints((prev) => [...prev, point]);

      // 各展開ストロークを描画
      for (const strokePath of result.expandedStrokes) {
        if (strokePath.length >= 2) {
          drawPath(layer, strokePath, PEN_COLOR, PEN_WIDTH);
        }
      }
      setRenderVersion((n) => n + 1);
    },
    [layer],
  );

  const onStrokeEnd = useCallback(() => {
    if (!sessionRef.current) {
      setStrokePoints([]);
      return;
    }

    const { inputPoints, validStrokes, pipelineConfig } = endStrokeSession(
      sessionRef.current,
    );

    if (validStrokes.length > 0) {
      const command = createStrokeCommand(
        inputPoints,
        pipelineConfig,
        PEN_COLOR,
        PEN_WIDTH,
      );
      setHistoryState((prev) =>
        pushCommand(prev, command, layer, HISTORY_CONFIG),
      );
    }

    sessionRef.current = null;
    setStrokePoints([]);
  }, [layer]);

  // Undo
  const handleUndo = useCallback(() => {
    setHistoryState((prev) => {
      if (!canUndo(prev)) return prev;
      const newState = undo(prev);
      clearLayer(layer);
      rebuildLayerState(layer, newState);
      setRenderVersion((n) => n + 1);
      return newState;
    });
  }, [layer]);

  // Redo
  const handleRedo = useCallback(() => {
    setHistoryState((prev) => {
      if (!canRedo(prev)) return prev;
      const newState = redo(prev);
      clearLayer(layer);
      rebuildLayerState(layer, newState);
      setRenderVersion((n) => n + 1);
      return newState;
    });
  }, [layer]);

  // キーボードショートカット
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

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: "0 0 16px" }}>Headless Paint</h1>

      <Toolbar
        currentTool={tool}
        onToolChange={setTool}
        onReset={reset}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo(historyState)}
        canRedo={canRedo(historyState)}
      />

      <div style={{ position: "relative", marginTop: 16 }}>
        <PaintCanvas
          layer={layer}
          transform={transform}
          tool={tool}
          onPan={handlePan}
          onZoom={handleZoom}
          onRotate={handleRotate}
          onStrokeStart={onStrokeStart}
          onStrokeMove={onStrokeMove}
          onStrokeEnd={onStrokeEnd}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          renderVersion={renderVersion}
        />

        <SymmetryOverlay
          config={symmetry.config}
          transform={transform}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
        />

        <SidebarPanel
          layer={layer}
          viewTransform={transform}
          mainCanvasWidth={CANVAS_WIDTH}
          mainCanvasHeight={CANVAS_HEIGHT}
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
          symmetry={symmetry}
        />
      </div>
    </div>
  );
}
