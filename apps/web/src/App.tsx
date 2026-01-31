import { createLayer, drawPath } from "@headless-paint/engine";
import type { Point } from "@headless-paint/input";
import { useCallback, useMemo, useState } from "react";
import { DebugPanel } from "./components/DebugPanel";
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

export function App() {
  const [tool, setTool] = useState<ToolType>("pen");
  const { transform, handlePan, handleZoom, handleRotate, reset } =
    useViewTransform();

  const layer = useMemo(() => createLayer(LAYER_WIDTH, LAYER_HEIGHT), []);

  const [strokePoints, setStrokePoints] = useState<Point[]>([]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [renderVersion, setRenderVersion] = useState(0);

  const onStrokeStart = useCallback((point: Point) => {
    setStrokePoints([point]);
  }, []);

  const onStrokeMove = useCallback(
    (point: Point) => {
      setStrokePoints((prev) => {
        const newPoints = [...prev, point];
        // 描画
        if (newPoints.length >= 2) {
          drawPath(layer, newPoints, PEN_COLOR, PEN_WIDTH);
          setRenderVersion((n) => n + 1);
        }
        return newPoints;
      });
    },
    [layer],
  );

  const onStrokeEnd = useCallback(() => {
    setStrokePoints([]);
    setStrokeCount((n) => n + 1);
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: "0 0 16px" }}>Headless Paint</h1>

      <Toolbar currentTool={tool} onToolChange={setTool} onReset={reset} />

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
      </div>
    </div>
  );
}
