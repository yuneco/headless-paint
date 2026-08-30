import type { BrushConfig, PressureCurve } from "@headless-paint/engine";
import type { InputPoint } from "@headless-paint/input";
import { useCallback, useRef, useState } from "react";

export type InputCaptureStatus = "idle" | "armed" | "capturing" | "captured";

export interface InputCaptureSettings {
  readonly brush: BrushConfig;
  readonly lineWidth: number;
  readonly pressureCurve: PressureCurve;
  readonly filterPipeline:
    | { readonly type: "causal-adaptive" }
    | {
        readonly type: "common-smoothing" | "none";
        readonly windowSize: number;
      };
}

export interface InputCapture {
  readonly status: InputCaptureStatus;
  readonly pointCount: number;
  readonly canCopy: boolean;
  readonly arm: () => void;
  readonly start: (point: InputPoint, settings: InputCaptureSettings) => void;
  readonly append: (points: readonly InputPoint[]) => void;
  readonly finalize: () => void;
  readonly copy: () => Promise<void>;
}

export function useInputCapture(): InputCapture {
  const armedRef = useRef(false);
  const activeRef = useRef(false);
  const pointsRef = useRef<InputPoint[]>([]);
  const batchSizesRef = useRef<number[]>([]);
  const settingsRef = useRef<InputCaptureSettings | null>(null);
  const [status, setStatus] = useState<InputCaptureStatus>("idle");
  const [json, setJson] = useState<string | null>(null);

  const arm = useCallback(() => {
    armedRef.current = true;
    activeRef.current = false;
    pointsRef.current = [];
    batchSizesRef.current = [];
    settingsRef.current = null;
    setJson(null);
    setStatus("armed");
  }, []);

  const start = useCallback(
    (point: InputPoint, settings: InputCaptureSettings) => {
      if (!armedRef.current) return;
      armedRef.current = false;
      activeRef.current = true;
      pointsRef.current = [point];
      batchSizesRef.current = [1];
      settingsRef.current = settings;
      setStatus("capturing");
    },
    [],
  );

  const append = useCallback((points: readonly InputPoint[]) => {
    if (!activeRef.current) return;
    pointsRef.current.push(...points);
    batchSizesRef.current.push(points.length);
  }, []);

  const finalize = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const capturedJson = JSON.stringify({
      format: "headless-paint-production-input",
      version: 1,
      settings: settingsRef.current,
      batchSizes: batchSizesRef.current,
      points: pointsRef.current,
    });
    setJson(capturedJson);
    setStatus("captured");
    console.log(`[ProductionInputCapture] ${capturedJson}`);
  }, []);

  const copy = useCallback(async () => {
    if (!json) return;
    await navigator.clipboard.writeText(json);
  }, [json]);

  return {
    status,
    pointCount: pointsRef.current.length,
    canCopy: json !== null,
    arm,
    start,
    append,
    finalize,
    copy,
  };
}
