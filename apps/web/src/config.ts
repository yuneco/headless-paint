/**
 * Webデモアプリの初期設定値
 *
 * 各hookで使用されるデフォルト値を一箇所で管理する。
 * ペン設定・スムージング設定など、UIに表示される初期値はすべてここで定義する。
 */
import type { PressureCurve } from "@headless-paint/engine";

// ── Pen ─────────────────────────────────────────

/** デフォルトのペン色 (RGBA 0-255) */
export const DEFAULT_PEN_COLOR = { r: 50, g: 50, b: 50, a: 255 };

/** デフォルトの線幅 (px) */
export const DEFAULT_LINE_WIDTH = 12;

/** デフォルトの筆圧感度 (0: 無効, 1: 最大) */
export const DEFAULT_PRESSURE_SENSITIVITY = 1.0;

/**
 * デフォルトの筆圧カーブ
 *
 * cubic-bezier(0, y1, 1, y2) の制御点。
 * 始点 (0,0) → CP1 (1/3, y1) → CP2 (2/3, y2) → 終点 (1,1) で筆圧の入出力関係を定義する。
 */
export const DEFAULT_PRESSURE_CURVE: PressureCurve = {
  y1: 0,
  y2: 0.4,
};

// ── Smoothing ───────────────────────────────────

/** スムージングのデフォルト有効状態 */
export const DEFAULT_SMOOTHING_ENABLED = true;

/** スムージングの移動平均ウィンドウサイズ (奇数, 3-13) */
export const DEFAULT_SMOOTHING_WINDOW_SIZE = 5;

// ── UI Colors ───────────────────────────────────

/** キャンバス背景色（レイヤー領域外） */
export const UI_BACKGROUND_COLOR = "#f8f8f8";

/** レイヤー境界線の色 */
export const UI_LAYER_BORDER_COLOR = "#aaa";

/** 対称ガイドラインの色 */
export const UI_SYMMETRY_GUIDE_COLOR = "rgba(119, 164, 201, 0.6)";
