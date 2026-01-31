import { useEffect, useRef } from "react";
import type { Layer } from "@headless-paint/engine";
import { renderLayerWithTransform } from "@headless-paint/engine";
import {
  type ViewTransform,
  createViewTransform,
  zoom,
  screenToLayer,
} from "@headless-paint/input";

interface MinimapProps {
  layer: Layer;
  viewTransform: ViewTransform;
  mainCanvasWidth: number;
  mainCanvasHeight: number;
  width?: number;
  height?: number;
}

export function Minimap({
  layer,
  viewTransform,
  mainCanvasWidth,
  mainCanvasHeight,
  width = 200,
  height = 150,
}: MinimapProps) {
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

    // 背景
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    // ミニマップ用のスケールを計算
    const scaleX = width / layer.width;
    const scaleY = height / layer.height;
    const scale = Math.min(scaleX, scaleY);

    // レイヤー全体を表示するための変換
    const minimapTransform = zoom(createViewTransform(), scale, 0, 0);
    renderLayerWithTransform(layer, ctx, minimapTransform);

    // メインビューの表示範囲を赤枠で表示
    // メインキャンバスの4隅をLayer Spaceに変換
    const corners = [
      { x: 0, y: 0 },
      { x: mainCanvasWidth, y: 0 },
      { x: mainCanvasWidth, y: mainCanvasHeight },
      { x: 0, y: mainCanvasHeight },
    ];

    ctx.save();
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.beginPath();

    let hasValidPoints = false;
    corners.forEach((corner, i) => {
      const layerPoint = screenToLayer(corner, viewTransform);
      if (!layerPoint) return;

      hasValidPoints = true;
      // Layer Space → Minimap Space
      const mx = layerPoint.x * scale;
      const my = layerPoint.y * scale;

      if (i === 0) {
        ctx.moveTo(mx, my);
      } else {
        ctx.lineTo(mx, my);
      }
    });

    if (hasValidPoints) {
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    // 枠線
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);
  }, [layer, viewTransform, mainCanvasWidth, mainCanvasHeight, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        position: "absolute",
        top: 16,
        right: 16,
        borderRadius: 4,
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      }}
    />
  );
}
