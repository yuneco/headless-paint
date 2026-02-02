import { useEffect, useRef } from "react";
import type { Layer } from "@headless-paint/engine";
import { renderLayerWithTransform } from "@headless-paint/engine";
import type { Point, ViewTransform } from "@headless-paint/input";
import { layerToScreen } from "@headless-paint/input";
import { usePointerHandler, type ToolType } from "../hooks/usePointerHandler";

interface PaintCanvasProps {
  layer: Layer;
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
  /** 再描画トリガー用のバージョン番号 */
  renderVersion?: number;
}

export function PaintCanvas({
  layer,
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
  renderVersion = 0,
}: PaintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // DPR対応
    const dpr = window.devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // クリア
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, width, height);

    // DPRを考慮した変換行列を作成
    // setTransformはスケーリングをリセットするため、DPRを変換行列に含める
    const dprTransform = new Float32Array(transform) as ViewTransform;
    dprTransform[0] *= dpr;
    dprTransform[1] *= dpr;
    dprTransform[3] *= dpr;
    dprTransform[4] *= dpr;
    dprTransform[6] *= dpr;
    dprTransform[7] *= dpr;

    // レイヤー描画
    renderLayerWithTransform(layer, ctx, dprTransform);

    // レイヤーの外形矩形を描画
    const layerCorners = [
      { x: 0, y: 0 },
      { x: layer.width, y: 0 },
      { x: layer.width, y: layer.height },
      { x: 0, y: layer.height },
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
  }, [layer, transform, width, height, renderVersion]);

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

  // wheelイベントはpassive: falseで登録する必要がある（preventDefaultを使うため）
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
