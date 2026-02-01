import { clearLayer, createLayer, drawPath } from "@headless-paint/engine";
import {
  canRedo,
  canUndo,
  createBatchCommand,
  createDrawPathCommand,
  createHistoryState,
  pushCommand,
  rebuildLayerState,
  redo,
  undo,
} from "@headless-paint/history";
import type { HistoryConfig, HistoryState } from "@headless-paint/history";
import type { Point } from "@headless-paint/input";
import { expandSymmetry } from "@headless-paint/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebugPanel } from "./components/DebugPanel";
import { HistoryDebugPanel } from "./components/HistoryDebugPanel";
import { Minimap } from "./components/Minimap";
import { PaintCanvas } from "./components/PaintCanvas";
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

  // ストローク中のポイントをrefで保持（コールバック内で最新値を参照するため）
  // 対称モードでは複数のストロークパスを管理
  const symmetryStrokesRef = useRef<Point[][]>([]);
  const compiledRef = useRef(symmetry.compiled);
  compiledRef.current = symmetry.compiled;

  const onStrokeStart = useCallback((point: Point) => {
    // 対称変換で複数の開始点を生成
    const expandedPoints = expandSymmetry(point, compiledRef.current);
    symmetryStrokesRef.current = expandedPoints.map((p) => [p]);
    setStrokePoints([point]);
  }, []);

  const onStrokeMove = useCallback(
    (point: Point) => {
      // 対称変換で複数の点を生成
      const expandedPoints = expandSymmetry(point, compiledRef.current);

      // 各対称ストロークにポイントを追加
      for (let i = 0; i < symmetryStrokesRef.current.length; i++) {
        if (expandedPoints[i]) {
          symmetryStrokesRef.current[i] = [
            ...symmetryStrokesRef.current[i],
            expandedPoints[i],
          ];
        }
      }

      setStrokePoints((prev) => [...prev, point]);

      // 各対称ストロークを描画
      for (const strokePath of symmetryStrokesRef.current) {
        if (strokePath.length >= 2) {
          drawPath(layer, strokePath, PEN_COLOR, PEN_WIDTH);
        }
      }
      setRenderVersion((n) => n + 1);
    },
    [layer],
  );

  const onStrokeEnd = useCallback(() => {
    const strokes = symmetryStrokesRef.current;
    const validStrokes = strokes.filter((s) => s.length >= 2);

    if (validStrokes.length > 0) {
      if (validStrokes.length === 1) {
        // 単一ストロークの場合は通常のコマンド
        const command = createDrawPathCommand(
          validStrokes[0],
          PEN_COLOR,
          PEN_WIDTH,
        );
        setHistoryState((prev) =>
          pushCommand(prev, command, layer, HISTORY_CONFIG),
        );
      } else {
        // 複数ストロークの場合はBatchCommand
        const commands = validStrokes.map((points) =>
          createDrawPathCommand(points, PEN_COLOR, PEN_WIDTH),
        );
        const batchCommand = createBatchCommand(commands);
        setHistoryState((prev) =>
          pushCommand(prev, batchCommand, layer, HISTORY_CONFIG),
        );
      }
    }

    symmetryStrokesRef.current = [];
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

        <Minimap
          layer={layer}
          viewTransform={transform}
          mainCanvasWidth={CANVAS_WIDTH}
          mainCanvasHeight={CANVAS_HEIGHT}
        />

        <DebugPanel
          transform={transform}
          strokeCount={strokeCount}
          symmetry={symmetry}
        />

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
