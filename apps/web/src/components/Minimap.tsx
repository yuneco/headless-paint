import type { Layer } from "@headless-paint/engine";
import { renderLayers } from "@headless-paint/engine";
import {
  type ViewTransform,
  createViewTransform,
  screenToLayer,
  zoom,
} from "@headless-paint/input";
import { useEffect, useRef } from "react";

interface MinimapProps {
  layers: readonly Layer[];
  viewTransform: ViewTransform;
  mainCanvasWidth: number;
  mainCanvasHeight: number;
  maxWidth?: number;
  renderVersion?: number;
}

export function Minimap({
  layers,
  viewTransform,
  mainCanvasWidth,
  mainCanvasHeight,
  maxWidth = 200,
  renderVersion,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 最初のレイヤーのサイズを基準にする（全レイヤー同サイズ前提）
  const layerWidth = layers[0]?.width ?? 1024;
  const layerHeight = layers[0]?.height ?? 1024;

  const aspectRatio = layerWidth / layerHeight;
  const width = maxWidth;
  const height = maxWidth / aspectRatio;
  const scale = maxWidth / layerWidth;

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderVersionはlayer内部のImageData更新を検知する再描画トリガー
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    // 背景
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 全可視レイヤーを合成表示
    const minimapTransform = zoom(createViewTransform(), scale * dpr, 0, 0);
    renderLayers(layers, ctx, minimapTransform);

    // メインビューの表示範囲を赤枠で表示
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const corners = [
      { x: 0, y: 0 },
      { x: mainCanvasWidth, y: 0 },
      { x: mainCanvasWidth, y: mainCanvasHeight },
      { x: 0, y: mainCanvasHeight },
    ];

    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.beginPath();

    let hasValidPoints = false;
    corners.forEach((corner, i) => {
      const layerPoint = screenToLayer(corner, viewTransform);
      if (!layerPoint) return;

      hasValidPoints = true;
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
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);
    ctx.restore();
  }, [
    layers,
    viewTransform,
    mainCanvasWidth,
    mainCanvasHeight,
    width,
    height,
    scale,
    renderVersion,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        display: "block",
      }}
    />
  );
}
