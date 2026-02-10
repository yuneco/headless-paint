import type { Point } from "@headless-paint/input";
import { useEffect, useRef } from "react";

interface TouchDebugOverlayProps {
  readonly enabled: boolean;
  readonly touchPoints: ReadonlyMap<number, Point>; // pointerId → screen position
  readonly gesturePhase: string;
  readonly width: number;
  readonly height: number;
}

export function TouchDebugOverlay({
  enabled,
  touchPoints,
  gesturePhase,
  width,
  height,
}: TouchDebugOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (!enabled) return;

    // タッチポイントの描画
    const RADIUS = 30;

    for (const [pointerId, pos] of touchPoints) {
      // pointer ID ごとに固定色 (golden angle spacing)
      const hue = (pointerId * 137.5) % 360;
      const fillColor = `hsla(${hue}, 70%, 50%, 0.3)`;
      const strokeColor = `hsl(${hue}, 70%, 50%)`;

      // 半透明の円
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // ラベル
      ctx.fillStyle = strokeColor;
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`P${pointerId}`, pos.x, pos.y);
    }

    // ジェスチャーフェーズの表示（画面上部）
    if (gesturePhase !== "idle") {
      const phaseColors: Record<string, string> = {
        single_down: "#f59e0b",
        drawing: "#10b981",
        gesture: "#3b82f6",
        gesture_ending: "#8b5cf6",
      };
      const bgColor = phaseColors[gesturePhase] ?? "#6b7280";

      const text = `touch: ${gesturePhase}`;
      ctx.font = "bold 14px monospace";
      const metrics = ctx.measureText(text);
      const padding = 8;
      const boxWidth = metrics.width + padding * 2;
      const boxHeight = 24;
      const boxX = (width - boxWidth) / 2;
      const boxY = 60;

      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, width / 2, boxY + boxHeight / 2);
    }
  }, [enabled, touchPoints, gesturePhase, width, height]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
      }}
    />
  );
}
