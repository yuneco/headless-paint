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
  maxWidth?: number;
  renderVersion?: number;
}

export function Minimap({
  layer,
  viewTransform,
  mainCanvasWidth,
  mainCanvasHeight,
  maxWidth = 200,
  renderVersion,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // レイヤーのアスペクト比に合わせてミニマップサイズを計算
  const aspectRatio = layer.width / layer.height;
  const width = maxWidth;
  const height = maxWidth / aspectRatio;
  const scale = maxWidth / layer.width;

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

    // レイヤー全体を表示するための変換
    const minimapTransform = zoom(createViewTransform(), scale, 0, 0);

    // DPRを考慮した変換行列を作成
    // renderLayerWithTransform内でsetTransformを使用するため、
    // ctx.scale(dpr, dpr)がリセットされる。事前にDPRを適用する必要がある
    const dprTransform = new Float32Array(minimapTransform) as ViewTransform;
    dprTransform[0] *= dpr;
    dprTransform[1] *= dpr;
    dprTransform[3] *= dpr;
    dprTransform[4] *= dpr;
    dprTransform[6] *= dpr;
    dprTransform[7] *= dpr;

    renderLayerWithTransform(layer, ctx, dprTransform);

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
  }, [
    layer,
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
