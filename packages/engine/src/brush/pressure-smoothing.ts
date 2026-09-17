import type { BrushPressureState } from "../types";

export interface SmoothedPressure {
  readonly value: number;
  readonly state?: BrushPressureState;
}

/**
 * emission時刻だけを使う因果的な一次ローパス。
 * 無効設定・時刻欠落・時刻逆行時は入力値をそのまま返す。
 */
export function smoothStampPressure(
  pressure: number | undefined,
  timestamp: number | undefined,
  smoothingMs: number | undefined,
  previous: BrushPressureState | undefined,
): SmoothedPressure {
  const value = sanitizePressure(pressure);
  const duration = sanitizeDuration(smoothingMs);
  if (duration <= 0 || timestamp === undefined || !Number.isFinite(timestamp)) {
    return { value };
  }
  if (!previous || timestamp < previous.timestamp) {
    return { value, state: { value, timestamp } };
  }
  if (timestamp === previous.timestamp) {
    return { value: previous.value, state: previous };
  }

  const elapsed = timestamp - previous.timestamp;
  const alpha = 1 - Math.exp(-elapsed / duration);
  const smoothed = previous.value + (value - previous.value) * alpha;
  return {
    value: smoothed,
    state: { value: smoothed, timestamp },
  };
}

function sanitizePressure(value: number | undefined): number {
  const finite = value !== undefined && Number.isFinite(value) ? value : 0.5;
  return Math.min(1, Math.max(0, finite));
}

function sanitizeDuration(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}
