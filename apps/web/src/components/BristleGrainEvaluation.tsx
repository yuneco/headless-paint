import type {
  BristleBrushConfig,
  BristleHeightMap,
  BristleSurfaceGrain,
} from "@headless-paint/engine";
import { createHeightMapFromImageData, hashSeed } from "@headless-paint/engine";
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
  const [files, setFiles] = useState<readonly string[]>([]);
  const [source, setSource] = useState("procedural");
  const [fileName, setFileName] = useState("");
  const [maxSize, setMaxSize] = useState(1024);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [options, setOptions] = useState({
    contrast: 1,
    invert: false,
    normalize: true,
  });
  const optionsRef = useRef(options);
  const optionsDirty = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalBlob = useRef<Blob | null>(null);
  const requestId = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const latest = useRef({ brush, onBrushChange });

  useEffect(() => {
    latest.current = { brush, onBrushChange };
  }, [brush, onBrushChange]);

  useEffect(() => {
    const controller = new AbortController();
    if (import.meta.env.DEV) {
      void fetch("/eval-textures/", { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("一覧を取得できませんでした");
          const names: unknown = await response.json();
          if (
            !Array.isArray(names) ||
            !names.every((name) => typeof name === "string")
          ) {
            throw new Error("テクスチャ一覧の形式が不正です");
          }
          if (!controller.signal.aborted) setFiles(names);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setListError(
              "評価用テクスチャ一覧を取得できませんでした。画像ファイルは開けます。",
            );
          }
        });
    }
    return () => {
      controller.abort();
      requestId.current += 1;
    };
  }, []);

  useEffect(() => {
    draftRef.current = grain;
    setDraft(grain);
  }, [grain]);

  const updateDraft = (
    field: "scalePx" | "hardness" | "amount" | "seed",
    value: number,
  ): void => {
    const next = { ...draftRef.current, [field]: value };
    draftRef.current = next;
    setDraft(next);
  };

  const commitGrain = (next: BristleSurfaceGrain): void => {
    draftRef.current = next;
    setDraft(next);
    const current = latest.current;
    if (isSameGrain(next, current.brush.dynamics.surfaceGrain)) return;
    current.onBrushChange({
      ...current.brush,
      dynamics: {
        ...current.brush.dynamics,
        surfaceGrain: next,
      },
    });
  };

  const commitDraft = (): void => commitGrain(draftRef.current);

  const updateOptions = (patch: Partial<typeof options>): void => {
    const next = { ...optionsRef.current, ...patch };
    optionsRef.current = next;
    optionsDirty.current = true;
    setOptions(next);
  };

  const commitOptions = (): void => {
    if (!imageData || !draftRef.current.heightMap || !optionsDirty.current)
      return;
    const heightMap = createHeightMapFromImageData(
      imageData,
      optionsRef.current,
    );
    optionsDirty.current = false;
    commitGrain({ ...draftRef.current, heightMap });
  };

  const loadImage = async (
    getBlob: () => Promise<Blob>,
    nextSource: string,
    name: string,
    size: number,
    resetScale = true,
  ): Promise<void> => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const blob = await getBlob();
      if (id !== requestId.current) return;
      const bitmap = await createImageBitmap(blob);
      let decoded: ImageData;
      try {
        if (id !== requestId.current) return;
        const ratio = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * ratio));
        const height = Math.max(1, Math.round(bitmap.height * ratio));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("画像のリサイズに失敗しました");
        context.drawImage(bitmap, 0, 0, width, height);
        decoded = context.getImageData(0, 0, width, height);
      } finally {
        bitmap.close();
      }
      const heightMap = createHeightMapFromImageData(
        decoded,
        optionsRef.current,
      );
      originalBlob.current = blob;
      optionsDirty.current = false;
      setImageData(decoded);
      setSource(nextSource);
      setFileName(name);
      setMaxSize(size);
      commitGrain({
        ...draftRef.current,
        heightMap,
        scalePx: resetScale ? 1 : draftRef.current.scalePx,
      });
    } catch (cause) {
      if (id === requestId.current) {
        setError(
          cause instanceof Error ? cause.message : "画像を読み込めませんでした",
        );
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const selectSource = (value: string): void => {
    if (value === "open") {
      fileInputRef.current?.click();
    } else if (value === "procedural") {
      requestId.current += 1;
      setLoading(false);
      setError("");
      setSource(value);
      setImageData(null);
      originalBlob.current = null;
      commitGrain({ ...draftRef.current, heightMap: undefined, scalePx: 4 });
    } else if (value.startsWith("eval:")) {
      const name = value.slice(5);
      void loadImage(
        async () => {
          const response = await fetch(
            `/eval-textures/${encodeURIComponent(name)}`,
          );
          if (!response.ok)
            throw new Error(`画像を取得できませんでした (${response.status})`);
          return response.blob();
        },
        value,
        name,
        maxSize,
      );
    }
  };

  return (
    <details open style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
        Surface grain texture（紙目テクスチャ）
      </summary>
      <div style={{ display: "grid", gap: 8, marginTop: 7 }}>
        <label>
          Source
          <select
            value={
              draft.heightMap
                ? source === "procedural"
                  ? "current"
                  : source
                : "procedural"
            }
            onChange={(event) => selectSource(event.currentTarget.value)}
          >
            <option value="procedural">Procedural</option>
            {files.map((name) => (
              <option key={name} value={`eval:${name}`}>
                {name}
              </option>
            ))}
            {source === "file" && <option value="file">{fileName}</option>}
            {draft.heightMap && source === "procedural" && (
              <option value="current">現在の高さマップ</option>
            )}
            <option value="open">画像を開く…</option>
          </select>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file)
              void loadImage(
                () => Promise.resolve(file),
                "file",
                file.name,
                maxSize,
              );
          }}
        />
        <label>
          Max size
          <select
            value={maxSize}
            disabled={loading}
            onChange={(event) => {
              const size = Number(event.currentTarget.value);
              const blob = originalBlob.current;
              if (blob && draft.heightMap) {
                void loadImage(
                  () => Promise.resolve(blob),
                  source,
                  fileName,
                  size,
                  false,
                );
              } else {
                setMaxSize(size);
              }
            }}
          >
            {[256, 512, 1024, 2048].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        {loading && <output>画像を読み込み中…</output>}
        {listError && <output>{listError}</output>}
        {error && <span role="alert">{error}</span>}
        {draft.heightMap && imageData && (
          <>
            <span>
              {imageData.width} × {imageData.height} texels
            </span>
            <GrainRange
              label="Contrast"
              value={options.contrast}
              min={0.25}
              max={8}
              step={0.05}
              onChange={(contrast) => updateOptions({ contrast })}
              onCommit={commitOptions}
            />
            <label>
              <input
                type="checkbox"
                checked={options.invert}
                onChange={(event) => {
                  updateOptions({ invert: event.currentTarget.checked });
                  commitOptions();
                }}
              />{" "}
              Invert
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.normalize}
                onChange={(event) => {
                  updateOptions({ normalize: event.currentTarget.checked });
                  commitOptions();
                }}
              />{" "}
              Normalize
            </label>
          </>
        )}
        <GrainPreview grain={draft} />
        <GrainRange
          label={
            draft.heightMap ? "Scale（px / texel）" : "Scale（粒の大きさ）"
          }
          value={draft.scalePx}
          min={0.5}
          max={draft.heightMap ? 8 : 16}
          step={0.25}
          suffix={draft.heightMap ? "" : "px"}
          onChange={(value) => updateDraft("scalePx", value)}
          onCommit={commitDraft}
        />
        <GrainRange
          label="Contact hardness（接触の硬さ）"
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
    const background = grain.heightMap ? [255, 255, 255] : [244, 239, 228];
    const paint = grain.heightMap ? [0, 0, 0] : [49, 93, 112];
    const softness = 0.01 + (1 - clamp(grain.hardness, 0, 1)) * 0.24;
    const amount = clamp(grain.amount, 0, 1);

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const sx = x / Math.max(0.5, grain.scalePx);
        const sy = y / Math.max(0.5, grain.scalePx);
        const height = grain.heightMap
          ? sampleHeightMap(grain.heightMap, sx, sy)
          : fineToothHeight(sx, sy, grain.seed);
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

function sampleHeightMap(map: BristleHeightMap, x: number, y: number): number {
  const tx = ((Math.floor(x) % map.width) + map.width) % map.width;
  const ty = ((Math.floor(y) % map.height) + map.height) % map.height;
  return map.heights[ty * map.width + tx];
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
    left.seed === right.seed &&
    left.heightMap === right.heightMap
  );
}
