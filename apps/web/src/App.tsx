import { clearLayer, createLayer, drawPath } from "@headless-paint/engine";
import {
  canRedo,
  canUndo,
  createDrawPathCommand,
  createHistoryState,
  pushCommand,
  rebuildLayerState,
  redo,
  undo,
} from "@headless-paint/history";
import type { HistoryConfig, HistoryState } from "@headless-paint/history";
import type { Point } from "@headless-paint/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebugPanel } from "./components/DebugPanel";
import { HistoryDebugPanel } from "./components/HistoryDebugPanel";
import { Minimap } from "./components/Minimap";
import { PaintCanvas } from "./components/PaintCanvas";
import { Toolbar } from "./components/Toolbar";
import type { ToolType } from "./hooks/usePointerHandler";
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

  // 履歴管理
  const [historyState, setHistoryState] = useState<HistoryState>(() =>
    createHistoryState(LAYER_WIDTH, LAYER_HEIGHT),
  );

  // ストローク中のポイントをrefで保持（コールバック内で最新値を参照するため）
  const strokePointsRef = useRef<Point[]>([]);

  const onStrokeStart = useCallback((point: Point) => {
    strokePointsRef.current = [point];
    setStrokePoints([point]);
  }, []);

  const onStrokeMove = useCallback(
    (point: Point) => {
      strokePointsRef.current = [...strokePointsRef.current, point];
      setStrokePoints(strokePointsRef.current);

      if (strokePointsRef.current.length >= 2) {
        drawPath(layer, strokePointsRef.current, PEN_COLOR, PEN_WIDTH);
        setRenderVersion((n) => n + 1);
      }
    },
    [layer],
  );

  const onStrokeEnd = useCallback(() => {
    const points = strokePointsRef.current;
    if (points.length >= 2) {
      const command = createDrawPathCommand(points, PEN_COLOR, PEN_WIDTH);
      setHistoryState((prev) => pushCommand(prev, command, layer, HISTORY_CONFIG));
    }
    strokePointsRef.current = [];
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

        <Minimap
          layer={layer}
          viewTransform={transform}
          mainCanvasWidth={CANVAS_WIDTH}
          mainCanvasHeight={CANVAS_HEIGHT}
        />

        <DebugPanel transform={transform} strokeCount={strokeCount} />

        <HistoryDebugPanel
          historyState={historyState}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo(historyState)}
          canRedo={canRedo(historyState)}
        />
      </div>
    </div>
  );
}
