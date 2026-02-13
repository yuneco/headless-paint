export interface Point {
  x: number;
  y: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface StrokePoint extends Point {
  pressure?: number;
}

export interface LayerMeta {
  name: string;
  visible: boolean;
  opacity: number;
  compositeOperation?: GlobalCompositeOperation;
}

export interface Layer {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly canvas: OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D;
  readonly meta: LayerMeta;
}

// ============================================================
// Expand (対称展開) 関連
// ============================================================

export type ExpandMode = "none" | "axial" | "radial" | "kaleidoscope";

export interface ExpandLevel {
  readonly mode: ExpandMode;
  readonly offset: Point; // root: 絶対座標, child: 親からの相対座標
  readonly angle: number; // root: 座標系回転角度, child: autoAngle に加算される自前角度
  readonly divisions: number;
}

export interface ExpandConfig {
  readonly levels: readonly ExpandLevel[];
}

export interface CompiledExpand {
  readonly config: ExpandConfig;
  readonly matrices: readonly Float32Array[];
  readonly outputCount: number;
}

// ============================================================
// Background
// ============================================================

export interface BackgroundSettings {
  readonly color: Color;
  readonly visible: boolean;
}

export const DEFAULT_BACKGROUND_COLOR: Color = {
  r: 255,
  g: 255,
  b: 255,
  a: 255,
};

// ============================================================
// Pressure Curve
// ============================================================

export interface PressureCurve {
  readonly y1: number;
  readonly y2: number;
}

export const DEFAULT_PRESSURE_CURVE: PressureCurve = {
  y1: 1 / 3,
  y2: 2 / 3,
};

// ============================================================
// Brush
// ============================================================

/** 手続き的円形チップ（hardness でエッジの柔らかさ制御） */
export interface CircleTipConfig {
  readonly type: "circle";
  readonly hardness: number;
}

/** 画像ベースチップ（imageId で BrushTipRegistry から解決） */
export interface ImageTipConfig {
  readonly type: "image";
  readonly imageId: string;
}

export type BrushTipConfig = CircleTipConfig | ImageTipConfig;

export interface BrushDynamics {
  readonly spacing: number;
  readonly opacityJitter: number;
  readonly sizeJitter: number;
  readonly rotationJitter: number;
  readonly scatter: number;
  readonly flow: number;
}

export const DEFAULT_BRUSH_DYNAMICS: BrushDynamics = {
  spacing: 0.25,
  opacityJitter: 0,
  sizeJitter: 0,
  rotationJitter: 0,
  scatter: 0,
  flow: 1.0,
};

/** 現在の circle+trapezoid 方式 */
export interface RoundPenBrushConfig {
  readonly type: "round-pen";
}

/** スタンプベースブラシ（汎用拡張型） */
export interface StampBrushConfig {
  readonly type: "stamp";
  readonly tip: BrushTipConfig;
  readonly dynamics: BrushDynamics;
}

export type BrushConfig = RoundPenBrushConfig | StampBrushConfig;

export const ROUND_PEN: RoundPenBrushConfig = { type: "round-pen" };

export const AIRBRUSH: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.05, flow: 0.1 },
};

export const PENCIL: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.95 },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.1,
    sizeJitter: 0.05,
    scatter: 0.02,
  },
};

export const MARKER: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.7 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.15, flow: 0.8 },
};

export interface BrushRenderState {
  readonly accumulatedDistance: number;
  readonly tipCanvas: OffscreenCanvas | null;
  readonly seed: number;
}

// ============================================================
// StrokeStyle
// ============================================================

export interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity: number;
  readonly pressureCurve: PressureCurve;
  readonly compositeOperation: GlobalCompositeOperation;
  readonly brush: BrushConfig;
}
