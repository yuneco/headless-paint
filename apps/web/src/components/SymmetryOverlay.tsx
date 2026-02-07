import type { ExpandConfig } from "@headless-paint/engine";
import type { ViewTransform } from "@headless-paint/input";
import { layerToScreen } from "@headless-paint/input";
import { useEffect, useRef } from "react";
import { UI_SYMMETRY_GUIDE_COLOR } from "../config";

interface SymmetryOverlayProps {
  config: ExpandConfig;
  transform: ViewTransform;
  width: number;
  height: number;
}

const GUIDE_COLOR = UI_SYMMETRY_GUIDE_COLOR;
const GUIDE_DASH = [8, 4];
const ORIGIN_RADIUS = 8;

export function SymmetryOverlay({
  config,
  transform,
  width,
  height,
}: SymmetryOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (config.mode === "none") return;

    const originScreen = layerToScreen(config.origin, transform);

    ctx.strokeStyle = GUIDE_COLOR;
    ctx.fillStyle = GUIDE_COLOR;
    ctx.lineWidth = 1;

    if (config.mode !== "axial") {
      ctx.beginPath();
      ctx.arc(originScreen.x, originScreen.y, ORIGIN_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    if (config.mode === "axial") {
      ctx.setLineDash(GUIDE_DASH);
      drawAxisLine(ctx, originScreen, config.angle, width, height);
    } else if (config.mode === "radial") {
      ctx.setLineDash([]);
      for (let i = 0; i < config.divisions; i++) {
        const angle = (Math.PI * 2 * i) / config.divisions + config.angle;
        drawAxisLine(ctx, originScreen, angle, width, height);
      }
    } else if (config.mode === "kaleidoscope") {
      const totalLines = config.divisions * 2;
      for (let i = 0; i < totalLines; i++) {
        const angle = (Math.PI * 2 * i) / totalLines + config.angle;
        ctx.setLineDash(i % 2 === 0 ? [] : GUIDE_DASH);
        drawAxisLine(ctx, originScreen, angle, width, height);
      }
    }

    ctx.setLineDash([]);
  }, [config, transform, width, height]);

  if (config.mode === "none") {
    return null;
  }

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

function drawAxisLine(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  angle: number,
  width: number,
  height: number,
) {
  const length = Math.sqrt(width * width + height * height);

  const dx = Math.sin(angle) * length;
  const dy = -Math.cos(angle) * length;

  ctx.beginPath();
  ctx.moveTo(origin.x - dx, origin.y - dy);
  ctx.lineTo(origin.x + dx, origin.y + dy);
  ctx.stroke();
}
