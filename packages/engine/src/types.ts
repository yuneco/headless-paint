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

export interface ExpandConfig {
  readonly mode: ExpandMode;
  readonly origin: Point;
  readonly angle: number;
  readonly divisions: number;
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
// StrokeStyle
// ============================================================

export interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity?: number;
  readonly pressureCurve?: PressureCurve;
  readonly compositeOperation?: GlobalCompositeOperation;
}
