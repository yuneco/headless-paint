import { useEffect, useRef } from "react";
import type { ExpandConfig } from "@headless-paint/engine";
import type { ViewTransform } from "@headless-paint/input";
import { layerToScreen } from "@headless-paint/input";

interface SymmetryOverlayProps {
  config: ExpandConfig;
  transform: ViewTransform;
  width: number;
  height: number;
}

const GUIDE_COLOR = "rgba(100, 100, 255, 0.6)";
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
    ctx.lineWidth = 2;

    if (config.mode !== "axial") {
      ctx.beginPath();
      ctx.arc(originScreen.x, originScreen.y, ORIGIN_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.setLineDash(GUIDE_DASH);

    if (config.mode === "axial") {
      drawAxisLine(ctx, originScreen, config.angle, width, height);
    } else {
      const divisions =
        config.mode === "kaleidoscope" ? config.divisions * 2 : config.divisions;

      for (let i = 0; i < divisions; i++) {
        const angle = (Math.PI * 2 * i) / divisions + config.angle;
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
