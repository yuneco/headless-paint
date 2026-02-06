import { useEffect, useRef } from "react";
import type { Layer } from "@headless-paint/engine";
import { renderLayers } from "@headless-paint/engine";
import type { Point, ViewTransform } from "@headless-paint/input";
import { layerToScreen } from "@headless-paint/input";
import { usePointerHandler, type ToolType } from "../hooks/usePointerHandler";

interface PaintCanvasProps {
  layers: readonly Layer[];
  transform: ViewTransform;
  tool: ToolType;
  onPan: (dx: number, dy: number) => void;
  onZoom: (scale: number, centerX: number, centerY: number) => void;
  onRotate: (angleRad: number, centerX: number, centerY: number) => void;
  onStrokeStart: (point: Point) => void;
  onStrokeMove: (point: Point) => void;
  onStrokeEnd: () => void;
  width: number;
  height: number;
  layerWidth: number;
  layerHeight: number;
  renderVersion?: number;
}

export function PaintCanvas({
  layers,
  transform,
  tool,
  onPan,
  onZoom,
  onRotate,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd,
  width,
  height,
  layerWidth,
  layerHeight,
  renderVersion = 0,
}: PaintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, width, height);

    const dprTransform = new Float32Array(transform) as ViewTransform;
    dprTransform[0] *= dpr;
    dprTransform[1] *= dpr;
    dprTransform[3] *= dpr;
    dprTransform[4] *= dpr;
    dprTransform[6] *= dpr;
    dprTransform[7] *= dpr;

    renderLayers(layers, ctx, dprTransform);

    const layerCorners = [
      { x: 0, y: 0 },
      { x: layerWidth, y: 0 },
      { x: layerWidth, y: layerHeight },
      { x: 0, y: layerHeight },
    ];

    ctx.save();
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();

    layerCorners.forEach((corner, i) => {
      const screenPoint = layerToScreen(corner, transform);

      if (i === 0) {
        ctx.moveTo(screenPoint.x, screenPoint.y);
      } else {
        ctx.lineTo(screenPoint.x, screenPoint.y);
      }
    });

    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }, [layers, transform, width, height, layerWidth, layerHeight, renderVersion]);

  const pointerHandlers = usePointerHandler(tool, {
    transform,
    onPan,
    onZoom,
    onRotate,
    onStrokeStart,
    onStrokeMove,
    onStrokeEnd,
    canvasWidth: width,
    canvasHeight: height,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      pointerHandlers.onWheel(e);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [pointerHandlers]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        border: "1px solid #ccc",
        cursor: tool === "pen" ? "crosshair" : "grab",
        touchAction: "none",
      }}
      onPointerDown={pointerHandlers.onPointerDown}
      onPointerMove={pointerHandlers.onPointerMove}
      onPointerUp={pointerHandlers.onPointerUp}
      onPointerLeave={pointerHandlers.onPointerUp}
    />
  );
}
