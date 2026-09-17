import type { BrushConfig, Color } from "@headless-paint/engine";
import { useCallback, useEffect } from "react";
import { APP_BRUSH_PRESETS } from "../brush-presets";

interface UndoTimingEntry {
  readonly sequence: number;
  readonly durationMs: number;
  readonly drainMs: number;
}

interface UndoTimingDebug {
  readonly entries: UndoTimingEntry[];
  reset(): void;
  snapshot(): readonly UndoTimingEntry[];
}

interface HpDebugUi {
  setColor(hex: string): void;
  setLineWidth(px: number): void;
  selectBrush(label: string): void;
  setSymmetry?(mode: string, divisions: number): void;
}

declare global {
  var __hpUndoTiming: UndoTimingDebug | undefined;
  var __hpDebugUi: HpDebugUi | undefined;
}

function configureBrushPerfDebugFromUrl(): void {
  const perf = globalThis.__hpBrushPerf;
  if (!perf) return;
  const params = new URLSearchParams(window.location.search);
  perf.enabled = params.get("perfDebug") === "1";
  const stallThresholdMs = Number(params.get("stallThresholdMs") ?? "60");
  perf.experiments.stallThresholdMs =
    Number.isFinite(stallThresholdMs) && stallThresholdMs >= 0
      ? stallThresholdMs
      : 60;
  for (const name of Object.keys(perf.nullStages) as Array<
    keyof typeof perf.nullStages
  >) {
    perf.nullStages[name] = false;
  }
  for (const name of (params.get("nullStages") ?? "").split(",")) {
    switch (name.trim().toLowerCase()) {
      case "field":
        perf.nullStages.nullField = true;
        break;
      case "contact":
        perf.nullStages.nullContact = true;
        break;
      case "raster":
        perf.nullStages.nullRaster = true;
        break;
      case "drawsweep":
      case "draw-sweep":
        perf.nullStages.nullDrawSweep = true;
        break;
      case "fullcopy":
      case "full-copy":
        perf.nullStages.nullFullCopy = true;
        break;
      case "checkpoint":
        perf.nullStages.nullCheckpoint = true;
        break;
      case "fieldadvance":
      case "field-advance":
        perf.nullStages.nullFieldAdvance = true;
        break;
      case "upload":
      case "material-upload":
        perf.nullStages.nullMaterialUpload = true;
        break;
      case "render":
        perf.nullStages.nullRender = true;
        break;
      case "dabdraw":
      case "dab-draw":
        perf.nullStages.nullDabDraw = true;
        break;
      case "rotate":
        perf.nullStages.nullRotate = true;
        break;
    }
  }
  perf.reset();
}

function ensureUndoTimingDebug(): UndoTimingDebug {
  if (globalThis.__hpUndoTiming) return globalThis.__hpUndoTiming;
  const entries: UndoTimingEntry[] = [];
  globalThis.__hpUndoTiming = {
    entries,
    reset() {
      entries.length = 0;
    },
    snapshot() {
      return entries.map((entry) => ({ ...entry }));
    },
  };
  return globalThis.__hpUndoTiming;
}

configureBrushPerfDebugFromUrl();
ensureUndoTimingDebug();

export interface PerfDebugBridgeOptions {
  readonly setColor: (color: Color) => void;
  readonly setLineWidth: (width: number) => void;
  readonly setBrush: (brush: BrushConfig) => void;
  readonly setSymmetry: (mode: string, divisions: number) => void;
  readonly undo: () => void;
}

export function usePerfDebugBridge({
  setColor,
  setLineWidth,
  setBrush,
  setSymmetry,
  undo,
}: PerfDebugBridgeOptions): { readonly handleTimedUndo: () => void } {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("perfDebug") !== "1") {
      return;
    }
    const debugUi: HpDebugUi = {
      setColor(hex) {
        if (!/^#[0-9a-f]{6}$/i.test(hex)) {
          throw new Error(`Invalid debug color: ${hex}`);
        }
        setColor({
          r: Number.parseInt(hex.slice(1, 3), 16),
          g: Number.parseInt(hex.slice(3, 5), 16),
          b: Number.parseInt(hex.slice(5, 7), 16),
          a: 255,
        });
      },
      setLineWidth(px) {
        if (!Number.isFinite(px) || px <= 0) {
          throw new Error(`Invalid debug line width: ${px}`);
        }
        setLineWidth(px);
      },
      selectBrush(label) {
        const preset = APP_BRUSH_PRESETS.find(
          (candidate) => candidate.label === label,
        );
        if (!preset) throw new Error(`Unknown debug brush: ${label}`);
        setBrush(preset.config);
      },
      setSymmetry(mode, divisions) {
        setSymmetry(mode, divisions);
      },
    };
    globalThis.__hpDebugUi = debugUi;
    return () => {
      if (globalThis.__hpDebugUi === debugUi) {
        globalThis.__hpDebugUi = undefined;
      }
    };
  }, [setBrush, setColor, setLineWidth, setSymmetry]);

  const handleTimedUndo = useCallback(() => {
    const timing = ensureUndoTimingDebug();
    const sequence = timing.entries.length;
    const startMark = `hp-undo-${sequence}-start`;
    const endMark = `hp-undo-${sequence}-end`;
    const measureName = `hp-undo-${sequence}`;
    performance.mark(startMark);
    undo();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const drainStartedAt = performance.now();
        const canvas = document.querySelector<HTMLCanvasElement>(
          "canvas[data-headless-paint-main]",
        );
        canvas?.getContext("2d")?.getImageData(0, 0, 1, 1);
        const drainMs = performance.now() - drainStartedAt;
        performance.mark(endMark);
        const measure = performance.measure(measureName, startMark, endMark);
        timing.entries.push({
          sequence,
          durationMs: measure.duration,
          drainMs,
        });
        performance.clearMarks(startMark);
        performance.clearMarks(endMark);
        performance.clearMeasures(measureName);
      }),
    );
  }, [undo]);

  return { handleTimedUndo };
}
