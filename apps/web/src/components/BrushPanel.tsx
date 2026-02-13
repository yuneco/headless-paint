import type {
  BrushConfig,
  BrushTipRegistry,
  StampBrushConfig,
} from "@headless-paint/engine";
import { generateBrushTip } from "@headless-paint/engine";
import { useEffect, useRef } from "react";
import { APP_BRUSH_PRESETS } from "../brush-presets";

interface BrushPanelProps {
  readonly brush: BrushConfig;
  readonly onBrushChange: (brush: BrushConfig) => void;
  readonly registry: BrushTipRegistry;
  readonly registryReady: boolean;
}

function isSameBrush(a: BrushConfig, b: BrushConfig): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "round-pen") return true;
  const sa = a as StampBrushConfig;
  const sb = b as StampBrushConfig;
  return (
    sa.tip.type === sb.tip.type &&
    sa.dynamics.spacing === sb.dynamics.spacing &&
    sa.dynamics.flow === sb.dynamics.flow
  );
}

const PREVIEW_SIZE = 32;

function BrushPreviewCanvas({
  config,
  registry,
  registryReady,
}: {
  readonly config: BrushConfig;
  readonly registry: BrushTipRegistry;
  readonly registryReady: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: registryReady はテクスチャ登録完了を検知してプレビューを再描画するトリガー
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    if (config.type === "round-pen") {
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.arc(
        PREVIEW_SIZE / 2,
        PREVIEW_SIZE / 2,
        PREVIEW_SIZE / 2 - 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    } else {
      const color = { r: 51, g: 51, b: 51, a: 255 };
      try {
        const tip = generateBrushTip(config.tip, PREVIEW_SIZE, color, registry);
        ctx.drawImage(tip, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
      } catch {
        // registry にまだテクスチャがない場合はフォールバック
        ctx.fillStyle = "#999";
        ctx.beginPath();
        ctx.arc(
          PREVIEW_SIZE / 2,
          PREVIEW_SIZE / 2,
          PREVIEW_SIZE / 2 - 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }, [config, registry, registryReady]);

  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_SIZE}
      height={PREVIEW_SIZE}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export function BrushPanel({
  brush,
  onBrushChange,
  registry,
  registryReady,
}: BrushPanelProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 4,
      }}
    >
      {APP_BRUSH_PRESETS.map((preset) => {
        const isActive = isSameBrush(brush, preset.config);
        return (
          <button
            key={preset.label}
            type="button"
            onClick={() => onBrushChange(preset.config)}
            style={{
              padding: "6px 4px",
              border: isActive ? "2px solid #007bff" : "1px solid #ccc",
              borderRadius: 4,
              backgroundColor: isActive ? "#007bff18" : "transparent",
              cursor: "pointer",
              fontSize: 10,
              fontFamily: "monospace",
              textAlign: "center",
              color: isActive ? "#007bff" : "#333",
              fontWeight: isActive ? 600 : 400,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <BrushPreviewCanvas
              config={preset.config}
              registry={registry}
              registryReady={registryReady}
            />
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
