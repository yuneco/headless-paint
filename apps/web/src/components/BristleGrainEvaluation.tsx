import type {
  BristleBrushConfig,
  BristleSurfaceGrain,
} from "@headless-paint/engine";
import { hashSeed } from "@headless-paint/engine";
import { useEffect, useRef, useState } from "react";

const PREVIEW_WIDTH = 232;
const PREVIEW_HEIGHT = 88;
const PREVIEW_CONTACT = 0.5;

interface BristleGrainEvaluationProps {
  readonly brush: BristleBrushConfig;
  readonly onBrushChange: (brush: BristleBrushConfig) => void;
}

export function BristleGrainEvaluation({
  brush,
  onBrushChange,
}: BristleGrainEvaluationProps) {
  const grain = brush.dynamics.surfaceGrain;
  const [draft, setDraft] = useState(grain);
  const draftRef = useRef(grain);

  useEffect(() => {
    draftRef.current = grain;
    setDraft(grain);
  }, [grain]);

  const updateDraft = (
    field: keyof BristleSurfaceGrain,
    value: number,
  ): void => {
    const next = { ...draftRef.current, [field]: value };
    draftRef.current = next;
    setDraft(next);
  };

  const commitDraft = (): void => {
    const next = draftRef.current;
    if (isSameGrain(next, brush.dynamics.surfaceGrain)) return;
    onBrushChange({
      ...brush,
      dynamics: {
        ...brush.dynamics,
        surfaceGrain: next,
      },
    });
  };

  return (
    <details open style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
        Surface grain texture（紙目テクスチャ）
      </summary>
      <div style={{ display: "grid", gap: 8, marginTop: 7 }}>
        <GrainPreview grain={draft} />
        <GrainRange
          label="Scale（粒の大きさ）"
          value={draft.scalePx}
          min={0.5}
          max={16}
          step={0.25}
          suffix="px"
          onChange={(value) => updateDraft("scalePx", value)}
          onCommit={commitDraft}
        />
        <GrainRange
          label="Contrast（凹凸境界の明瞭さ）"
          value={draft.hardness}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => updateDraft("hardness", value)}
          onCommit={commitDraft}
        />
        <GrainRange
          label="Amount（紙目の作用量）"
          value={draft.amount}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => updateDraft("amount", value)}
          onCommit={commitDraft}
        />
        <GrainRange
          label="Seed（生成パターンの個体差）"
          value={draft.seed}
          min={0}
          max={64}
          step={1}
          digits={0}
          onChange={(value) => updateDraft("seed", value)}
          onCommit={commitDraft}
        />
      </div>
    </details>
  );
}

function GrainPreview({ grain }: { readonly grain: BristleSurfaceGrain }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const image = ctx.createImageData(canvas.width, canvas.height);
    const background = [244, 239, 228] as const;
    const paint = [49, 93, 112] as const;
    const softness = 0.01 + (1 - clamp(grain.hardness, 0, 1)) * 0.24;
    const amount = clamp(grain.amount, 0, 1);

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const height = fineToothHeight(
          x / Math.max(0.5, grain.scalePx),
          y / Math.max(0.5, grain.scalePx),
          grain.seed,
        );
        const coverage = smoothstep(
          (PREVIEW_CONTACT - height + softness) / (softness * 2),
        );
        const alpha = 1 - amount + amount * coverage;
        const offset = (y * canvas.width + x) * 4;
        image.data[offset] = mix(background[0], paint[0], alpha);
        image.data[offset + 1] = mix(background[1], paint[1], alpha);
        image.data[offset + 2] = mix(background[2], paint[2], alpha);
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [grain]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="bristle-grain-preview"
      style={{
        display: "block",
        width: "100%",
        height: PREVIEW_HEIGHT,
        border: "1px solid #c9d2da",
        borderRadius: 4,
      }}
    />
  );
}

interface GrainRangeProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly suffix?: string;
  readonly digits?: number;
  readonly onChange: (value: number) => void;
  readonly onCommit: () => void;
}

function GrainRange({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  digits = 2,
  onChange,
  onCommit,
}: GrainRangeProps) {
  return (
    <label style={{ display: "grid", gap: 3 }}>
      <span>
        {label}: {value.toFixed(digits)}
        {suffix}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </label>
  );
}

function fineToothHeight(x: number, y: number, seed: number): number {
  // 評価専用preview。engineのbristle-mask.tsにあるFine tooth式と同期する。
  // 公開preview APIを増やさない代わりに、周波数比とmix比をここでも固定する。
  return clamp(
    valueNoise2d(x, y, seed) * 0.68 +
      valueNoise2d(x * 2.3, y * 2.3, seed + 17) * 0.32,
    0,
    1,
  );
}

function valueNoise2d(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const top =
    hashUnit(seed, x0, y0) * (1 - tx) + hashUnit(seed, x0 + 1, y0) * tx;
  const bottom =
    hashUnit(seed, x0, y0 + 1) * (1 - tx) + hashUnit(seed, x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function hashUnit(seed: number, x: number, y: number): number {
  return hashSeed(hashSeed(seed, x), y) / 0x100000000;
}

function smoothstep(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mix(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount);
}

function isSameGrain(
  left: BristleSurfaceGrain,
  right: BristleSurfaceGrain,
): boolean {
  return (
    left.scalePx === right.scalePx &&
    left.amount === right.amount &&
    left.hardness === right.hardness &&
    left.seed === right.seed
  );
}
