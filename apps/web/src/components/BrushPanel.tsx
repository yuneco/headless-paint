import type { BrushConfig, BrushTipRegistry } from "@headless-paint/engine";
import { DEFAULT_BRUSH_MIXING, generateBrushTip } from "@headless-paint/engine";
import { memo, useEffect, useRef } from "react";
import { APP_BRUSH_PRESETS } from "../brush-presets";

interface BrushPanelProps {
  readonly brush: BrushConfig;
  readonly onBrushChange: (brush: BrushConfig) => void;
  readonly registry: BrushTipRegistry;
  readonly registryReady: boolean;
}

function isSameBrush(a: BrushConfig, b: BrushConfig): boolean {
  return areConfigValuesEqual(a, b);
}

function areConfigValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null) return false;
  if (typeof b !== "object" || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => areConfigValuesEqual(value, b[index]));
  }
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(right, key) && areConfigValuesEqual(left[key], right[key]),
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
    } else if (config.type === "bristle") {
      ctx.strokeStyle = "#333";
      ctx.lineCap = "round";
      for (let index = 0; index < 7; index++) {
        ctx.globalAlpha = 0.55 + (index % 3) * 0.18;
        ctx.lineWidth = index % 2 === 0 ? 2 : 1;
        const y = 7 + index * 3;
        ctx.beginPath();
        ctx.moveTo(3, y + (index % 2));
        ctx.quadraticCurveTo(16, y - 4, 29, y + 1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      const color = { r: 51, g: 51, b: 51, a: 255 };
      try {
        const tipConfig =
          config.type === "stamp" ? config.tip : config.particle;
        const tip = generateBrushTip(tipConfig, PREVIEW_SIZE, color, registry);
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

function BrushPanelComponent({
  brush,
  onBrushChange,
  registry,
  registryReady,
}: BrushPanelProps) {
  const DEFAULT_EMISSIONS_PER_SECOND = 30;

  const updateEmissionsPerSecond = (value: number | undefined) => {
    if (brush.type === "stamp") {
      onBrushChange({
        ...brush,
        dynamics: { ...brush.dynamics, emissionsPerSecond: value },
      });
    } else if (brush.type === "spray") {
      onBrushChange({
        ...brush,
        dynamics: { ...brush.dynamics, emissionsPerSecond: value },
      });
    }
  };

  const emissionsPerSecond =
    brush.type === "round-pen" || brush.type === "bristle"
      ? undefined
      : (brush.dynamics.emissionsPerSecond ?? undefined);

  const updateMixing = (
    field:
      | "pickupRatePerPx"
      | "restoreRatePerPx"
      | "diffusionRatePerPx"
      | "updateDistancePx"
      | "checkpointDistancePx",
    value: number,
  ) => {
    if (brush.type !== "stamp" && brush.type !== "bristle") return;
    onBrushChange({
      ...brush,
      mixing: {
        ...(brush.mixing ?? DEFAULT_BRUSH_MIXING),
        enabled: true,
        [field]: value,
      },
    });
  };

  const updateMixingEnabled = (enabled: boolean) => {
    if (brush.type !== "stamp" && brush.type !== "bristle") return;
    onBrushChange({
      ...brush,
      mixing: {
        ...(brush.mixing ?? DEFAULT_BRUSH_MIXING),
        enabled,
      },
    });
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
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

      {brush.type === "stamp" || brush.type === "spray" ? (
        <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={emissionsPerSecond !== undefined}
              onChange={(event) =>
                updateEmissionsPerSecond(
                  event.currentTarget.checked
                    ? DEFAULT_EMISSIONS_PER_SECOND
                    : undefined,
                )
              }
            />
            <span>Airbrush Buildup（吹きつけ）</span>
          </label>
          {emissionsPerSecond !== undefined ? (
            <label style={{ display: "grid", gap: 2 }}>
              <span>Rate {emissionsPerSecond.toFixed(0)} /sec</span>
              <input
                type="range"
                min={1}
                max={60}
                step={1}
                value={emissionsPerSecond}
                onChange={(event) =>
                  updateEmissionsPerSecond(Number(event.currentTarget.value))
                }
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {brush.type === "stamp" || brush.type === "bristle" ? (
        <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={brush.mixing?.enabled ?? false}
              onChange={(event) =>
                updateMixingEnabled(event.currentTarget.checked)
              }
            />
            <span>Color mixing（下地色の取り込み）</span>
          </label>
          {brush.mixing?.enabled ? (
            <>
              <label style={{ display: "grid", gap: 2 }}>
                <span>
                  Pickup rate {brush.mixing.pickupRatePerPx.toFixed(3)} /px
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.03}
                  step={0.001}
                  value={brush.mixing.pickupRatePerPx}
                  onChange={(event) =>
                    updateMixing(
                      "pickupRatePerPx",
                      Number(event.currentTarget.value),
                    )
                  }
                />
              </label>
              <label style={{ display: "grid", gap: 2 }}>
                <span>
                  Restore rate {brush.mixing.restoreRatePerPx.toFixed(3)} /px
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.03}
                  step={0.001}
                  value={brush.mixing.restoreRatePerPx}
                  onChange={(event) =>
                    updateMixing(
                      "restoreRatePerPx",
                      Number(event.currentTarget.value),
                    )
                  }
                />
              </label>
              <label style={{ display: "grid", gap: 2 }}>
                <span>
                  Diffusion rate {brush.mixing.diffusionRatePerPx.toFixed(2)}{" "}
                  pass/px
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.2}
                  step={0.01}
                  value={brush.mixing.diffusionRatePerPx}
                  onChange={(event) =>
                    updateMixing(
                      "diffusionRatePerPx",
                      Number(event.currentTarget.value),
                    )
                  }
                />
              </label>
              <label style={{ display: "grid", gap: 2 }}>
                <span>
                  Mix Distance{" "}
                  {(
                    brush.mixing.updateDistancePx ??
                    DEFAULT_BRUSH_MIXING.updateDistancePx
                  ).toFixed(0)}
                  px
                </span>
                <input
                  type="range"
                  min={1}
                  max={32}
                  step={1}
                  value={
                    brush.mixing.updateDistancePx ??
                    DEFAULT_BRUSH_MIXING.updateDistancePx
                  }
                  onChange={(event) =>
                    updateMixing(
                      "updateDistancePx",
                      Number(event.currentTarget.value),
                    )
                  }
                />
              </label>
              <label style={{ display: "grid", gap: 2 }}>
                <span>
                  Pickup checkpoint{" "}
                  {brush.mixing.checkpointDistancePx.toFixed(0)}px
                </span>
                <input
                  type="range"
                  min={8}
                  max={96}
                  step={1}
                  value={brush.mixing.checkpointDistancePx}
                  onChange={(event) =>
                    updateMixing(
                      "checkpointDistancePx",
                      Number(event.currentTarget.value),
                    )
                  }
                />
              </label>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const BrushPanel = memo(BrushPanelComponent);
