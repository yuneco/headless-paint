/**
 * Webデモアプリの初期設定値
 *
 * 各hookで使用されるデフォルト値を一箇所で管理する。
 * ペン設定・スムージング設定など、UIに表示される初期値はすべてここで定義する。
 */
import { ROUND_PEN } from "@headless-paint/react";
import type { PenSettingsConfig, SmoothingConfig } from "@headless-paint/react";

// ── Pen ─────────────────────────────────────────

/**
 * ペン設定の初期値
 *
 * pressureCurve は cubic-bezier(0, y1, 1, y2) の制御点。
 * 始点 (0,0) → CP1 (1/3, y1) → CP2 (2/3, y2) → 終点 (1,1) で筆圧の入出力関係を定義する。
 */
export const DEFAULT_PEN_CONFIG: Required<PenSettingsConfig> = {
  initialColor: { r: 50, g: 50, b: 50, a: 255 },
  initialLineWidth: 12,
  initialPressureSensitivity: 1.0,
  initialPressureCurve: { y1: 0, y2: 0.4 },
  initialBrush: ROUND_PEN,
};

// ── Smoothing ───────────────────────────────────

/** スムージング設定の初期値 */
export const DEFAULT_SMOOTHING_CONFIG: Required<SmoothingConfig> = {
  initialEnabled: true,
  initialWindowSize: 5,
};

// ── UI Colors ───────────────────────────────────

/** キャンバス背景色（レイヤー領域外） */
export const UI_BACKGROUND_COLOR = "#f8f8f8";

/** レイヤー境界線の色 */
export const UI_LAYER_BORDER_COLOR = "#aaa";

/** 対称ガイドラインの色 */
export const UI_SYMMETRY_GUIDE_COLOR = "rgba(119, 164, 201, 0.6)";
