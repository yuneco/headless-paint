import type {
  BackgroundSettings,
  Layer,
  PatternPreviewConfig,
} from "@headless-paint/engine";
import {
  createPatternTile,
  renderLayers,
  renderPatternPreview,
} from "@headless-paint/engine";
import type { InputPoint, ViewTransform } from "@headless-paint/input";
import { layerToScreen } from "@headless-paint/input";
import { useEffect, useRef } from "react";
import { type ToolType, usePointerHandler } from "../hooks/usePointerHandler";

interface PaintCanvasProps {
  layers: readonly Layer[];
  transform: ViewTransform;
  background?: BackgroundSettings;
  patternPreview?: PatternPreviewConfig;
  tool: ToolType;
  onPan: (dx: number, dy: number) => void;
  onZoom: (scale: number, centerX: number, centerY: number) => void;
  onRotate: (angleRad: number, centerX: number, centerY: number) => void;
  onStrokeStart: (point: InputPoint) => void;
  onStrokeMove: (point: InputPoint) => void;
  onStrokeEnd: () => void;
  onWrapShift?: (dx: number, dy: number) => void;
  onWrapShiftEnd?: (totalDx: number, totalDy: number) => void;
  wrapOffset?: { readonly x: number; readonly y: number };
  width: number;
  height: number;
  layerWidth: number;
  layerHeight: number;
  renderVersion?: number;
}

export function PaintCanvas({
  layers,
  transform,
  background,
  patternPreview,
  tool,
  onPan,
  onZoom,
  onRotate,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd,
  onWrapShift,
  onWrapShiftEnd,
  wrapOffset = { x: 0, y: 0 },
  width,
  height,
  layerWidth,
  layerHeight,
  renderVersion = 0,
}: PaintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderVersionはlayers内部のImageData更新を検知する再描画トリガー
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

    // パターンプレビュー（レイヤー領域外のみ、DPR未調整のtransformを使用）
    if (patternPreview) {
      const tile = createPatternTile(layers, patternPreview);
      if (tile) {
        renderPatternPreview(
          ctx,
          tile,
          patternPreview,
          transform,
          width,
          height,
          layerWidth,
          layerHeight,
        );
      }
    }

    const dprTransform = new Float32Array(transform) as ViewTransform;
    dprTransform[0] *= dpr;
    dprTransform[1] *= dpr;
    dprTransform[3] *= dpr;
    dprTransform[4] *= dpr;
    dprTransform[6] *= dpr;
    dprTransform[7] *= dpr;

    renderLayers(layers, ctx, dprTransform, { background });

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

    // ラップオフセットの元境界線（薄いグレー）
    const ox = ((wrapOffset.x % layerWidth) + layerWidth) % layerWidth;
    const oy = ((wrapOffset.y % layerHeight) + layerHeight) % layerHeight;

    if (ox !== 0 || oy !== 0) {
      ctx.save();
      ctx.strokeStyle = "#aaa";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      if (ox !== 0) {
        const top = layerToScreen({ x: ox, y: 0 }, transform);
        const bottom = layerToScreen({ x: ox, y: layerHeight }, transform);
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bottom.x, bottom.y);
        ctx.stroke();
      }

      if (oy !== 0) {
        const left = layerToScreen({ x: 0, y: oy }, transform);
        const right = layerToScreen({ x: layerWidth, y: oy }, transform);
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
      }

      ctx.restore();
    }
  }, [
    layers,
    transform,
    background,
    patternPreview,
    wrapOffset,
    width,
    height,
    layerWidth,
    layerHeight,
    renderVersion,
  ]);

  const pointerHandlers = usePointerHandler(tool, {
    transform,
    onPan,
    onZoom,
    onRotate,
    onStrokeStart,
    onStrokeMove,
    onStrokeEnd,
    onWrapShift,
    onWrapShiftEnd,
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
        display: "block",
        cursor:
          tool === "pen" || tool === "eraser"
            ? "crosshair"
            : tool === "offset"
              ? "move"
              : "grab",
        touchAction: "none",
      }}
      onPointerDown={pointerHandlers.onPointerDown}
      onPointerMove={pointerHandlers.onPointerMove}
      onPointerUp={pointerHandlers.onPointerUp}
      onPointerLeave={pointerHandlers.onPointerUp}
    />
  );
}
