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
  /** 入力時刻(ms)。時間ベースemission（吹きつけ）に使用。ない場合は距離ベースのみ */
  timestamp?: number;
}

export interface LayerMeta {
  name: string;
  visible: boolean;
  opacity: number;
  alphaLocked: boolean;
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
// Content Bounds (レイヤー内容境界)
// ============================================================

/** レイヤー内容の非透明ピクセル境界矩形 */
export interface ContentBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ============================================================
// Layer Transform Preview
// ============================================================

/** レイヤー変換プレビュー（PendingOverlay と同様の一時的レンダリング状態） */
export interface LayerTransformPreview {
  readonly layerId: string;
  readonly matrix: Float32Array;
}

// ============================================================
// Pending Overlay (プレ合成)
// ============================================================

/** pending レイヤーのプレ合成情報 */
export interface PendingOverlay {
  /** pending レイヤー */
  readonly layer: Layer;
  /** グループ化する committed レイヤーの ID */
  readonly targetLayerId: string;
  /** プレ合成用ワークレイヤー（呼び出し側で事前確保） */
  readonly workLayer: Layer;
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
// Parametric Curve / Pressure Curve
// ============================================================

export interface ParametricCurve {
  readonly y1: number;
  readonly y2: number;
}

export type PressureCurve = ParametricCurve;

export interface DensityProfileCurve {
  readonly startY: number;
  readonly control1: Point;
  readonly control2: Point;
  readonly endY: number;
}

export const DEFAULT_PRESSURE_CURVE: PressureCurve = {
  y1: 1 / 3,
  y2: 2 / 3,
};

export interface PressureDynamics {
  readonly size: number;
  readonly flow: number;
}

export const DEFAULT_PRESSURE_DYNAMICS: PressureDynamics = {
  size: 1,
  flow: 0,
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
  /**
   * 距離emissionの間隔を筆圧反映後のtip径へ追従させる割合。
   * 0は基準lineWidth固定、1は実効tip径へ完全追従する。
   */
  readonly spacingSizeCoupling: number;
  readonly opacityJitter: number;
  readonly sizeJitter: number;
  readonly rotationJitter: number;
  readonly scatter: number;
  readonly flow: number;
  /** 吹きつけ: 時間ベースemissionのレート。未指定 or 0以下でOFF（従来の距離ベースのみ） */
  readonly emissionsPerSecond?: number;
}

export const DEFAULT_BRUSH_DYNAMICS: BrushDynamics = {
  spacing: 0.25,
  spacingSizeCoupling: 0,
  opacityJitter: 0,
  sizeJitter: 0,
  rotationJitter: 0,
  scatter: 0,
  flow: 1.0,
};

export interface SprayDynamics {
  readonly spacing: number;
  readonly density: number;
  readonly particleSize: number;
  readonly particleSizeJitter: number;
  readonly sizeJitterMode: SpraySizeJitterMode;
  readonly opacityJitter: number;
  readonly flow: number;
  readonly radialDistribution: DensityProfileCurve;
  /** 吹きつけ: 時間ベースemissionのレート。未指定 or 0以下でOFF（従来の距離ベースのみ） */
  readonly emissionsPerSecond?: number;
}

export type SpraySizeJitterMode = "lognormal" | "bimodal";

export interface SprayPressureDynamics {
  readonly size: number;
  readonly flow: number;
  readonly density: number;
}

export const DEFAULT_RADIAL_DISTRIBUTION: DensityProfileCurve = {
  startY: 1,
  control1: { x: 1 / 3, y: 1 },
  control2: { x: 2 / 3, y: 1 },
  endY: 1,
};

export const SPRAY_MAX_PARTICLES_PER_EMISSION = 512;

export const DEFAULT_SPRAY_DYNAMICS: SprayDynamics = {
  spacing: 0.1,
  density: 5,
  particleSize: 2,
  particleSizeJitter: 0,
  sizeJitterMode: "bimodal",
  opacityJitter: 0,
  flow: 0.35,
  radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
};

export const DEFAULT_SPRAY_PRESSURE_DYNAMICS: SprayPressureDynamics = {
  size: 1,
  flow: 0,
  density: 0,
};

export interface BrushMixing {
  readonly enabled: boolean;
  /** 1px進むごとの下地色pickup rate。距離dの係数は1-exp(-rate*d) */
  readonly pickupRatePerPx: number;
  /** 1px進むごとの元色restore rate。距離dの係数は1-exp(-rate*d) */
  readonly restoreRatePerPx: number;
  /** 1px進むごとの色場diffusion pass量 */
  readonly diffusionRatePerPx: number;
  readonly updateDistancePx: number;
  readonly checkpointDistancePx: number;
  readonly fieldColumns: number;
  readonly fieldRows: number;
}

export const BRUSH_MIXING_MIN_FIELD_DIMENSION = 2;
export const BRUSH_MIXING_MAX_FIELD_DIMENSION = 64;
export const BRUSH_MIXING_MAX_CHECKPOINT_DISTANCE_PX = 256;

export const DEFAULT_BRUSH_MIXING: BrushMixing = {
  enabled: false,
  pickupRatePerPx: 0.007,
  restoreRatePerPx: 0.004,
  diffusionRatePerPx: 0.05,
  updateDistancePx: 15,
  checkpointDistancePx: 36,
  fieldColumns: 18,
  fieldRows: 8,
};

/** 現在の circle+trapezoid 方式 */
export interface RoundPenBrushConfig {
  readonly type: "round-pen";
  readonly pressureDynamics: PressureDynamics;
}

/** スタンプベースブラシ（汎用拡張型） */
export interface StampBrushConfig {
  readonly type: "stamp";
  readonly tip: BrushTipConfig;
  readonly dynamics: BrushDynamics;
  readonly pressureDynamics: PressureDynamics;
  readonly mixing?: BrushMixing;
}

/** 散布ブラシ。lineWidth は散布領域の直径を意味する */
export interface SprayBrushConfig {
  readonly type: "spray";
  readonly particle: BrushTipConfig;
  readonly dynamics: SprayDynamics;
  readonly pressureDynamics: SprayPressureDynamics;
}

export interface BristleSurfaceGrain {
  readonly scalePx: number;
  readonly amount: number;
  readonly hardness: number;
  readonly seed: number;
}

export interface BristleDynamics {
  readonly bristleCount: number;
  readonly bristleFill: number;
  readonly bristleWidthVariation: number;
  readonly bristleSpacingVariation: number;
  readonly geometryStepPx: number;
  readonly transverseMaskCellPx: number;
  readonly dropoutLengthPx: number;
  readonly dropoutWidthPx: number;
  readonly depositHardness: number;
  readonly edgeTextureAmount: number;
  readonly edgeTextureLengthPx: number;
  readonly cuspAngleThresholdDeg: number;
  readonly cuspDetectionSpanRatio: number;
  readonly lagLengthRatio: number;
  readonly surfaceGrain: BristleSurfaceGrain;
}

export interface BristlePressureDynamics {
  readonly coverage: number;
}

export const DEFAULT_BRISTLE_DYNAMICS: BristleDynamics = {
  bristleCount: 57,
  bristleFill: 1.8,
  bristleWidthVariation: 0.62,
  bristleSpacingVariation: 0.72,
  geometryStepPx: 1,
  transverseMaskCellPx: 0.82,
  dropoutLengthPx: 58,
  dropoutWidthPx: 1,
  depositHardness: 1,
  edgeTextureAmount: 0.12,
  edgeTextureLengthPx: 7,
  cuspAngleThresholdDeg: 65,
  cuspDetectionSpanRatio: 0.14,
  lagLengthRatio: 0.3,
  surfaceGrain: {
    scalePx: 4,
    amount: 1,
    hardness: 0.75,
    seed: 1,
  },
};

export const DEFAULT_BRISTLE_PRESSURE_DYNAMICS: BristlePressureDynamics = {
  coverage: 1,
};

export interface BristleBrushConfig {
  readonly type: "bristle";
  readonly dynamics: BristleDynamics;
  readonly pressureDynamics: BristlePressureDynamics;
  readonly mixing?: BrushMixing;
}

export type BrushConfig =
  | RoundPenBrushConfig
  | StampBrushConfig
  | SprayBrushConfig
  | BristleBrushConfig;

export const ROUND_PEN: RoundPenBrushConfig = {
  type: "round-pen",
  pressureDynamics: DEFAULT_PRESSURE_DYNAMICS,
};

export const AIRBRUSH: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.05,
    flow: 0.1,
    emissionsPerSecond: 30,
  },
  pressureDynamics: { size: 0, flow: 1 },
};

export const SPRAY_AIRBRUSH: SprayBrushConfig = {
  type: "spray",
  particle: { type: "circle", hardness: 1.0 },
  dynamics: {
    ...DEFAULT_SPRAY_DYNAMICS,
    spacing: 0.1,
    density: 5,
    particleSize: 2,
    particleSizeJitter: 0.35,
    sizeJitterMode: "bimodal",
    opacityJitter: 0.3,
    flow: 0.35,
    radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
    emissionsPerSecond: 30,
  },
  pressureDynamics: { size: 0.2, flow: 1, density: 0.5 },
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
  pressureDynamics: { size: 1, flow: 0 },
};

export const MARKER: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.7 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.15, flow: 0.8 },
  pressureDynamics: { size: 0.2, flow: 0.5 },
};

export const ROUGH_BRISTLE: BristleBrushConfig = {
  type: "bristle",
  dynamics: DEFAULT_BRISTLE_DYNAMICS,
  pressureDynamics: DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
  mixing: {
    ...DEFAULT_BRUSH_MIXING,
    enabled: false,
  },
};

export interface BristleSweepPointState {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly directionX: number;
  readonly directionY: number;
  readonly frameX: number;
  readonly frameY: number;
  readonly distance: number;
}

export interface BristleLagState {
  readonly startDistance: number;
  readonly fromAngle: number;
}

export interface BristleBranchRenderState {
  readonly lastSweepPoint?: BristleSweepPointState;
  readonly incomingDirectionX?: number;
  readonly incomingDirectionY?: number;
  readonly frameSign?: 1 | -1;
  readonly lag?: BristleLagState;
}

export interface BrushMixingState {
  readonly field: Float32Array;
  readonly fieldCanvas: OffscreenCanvas;
  readonly fieldPixels: ImageData;
  readonly sampleCanvas: OffscreenCanvas;
  readonly renderCanvas: OffscreenCanvas;
  readonly checkpointCanvas?: OffscreenCanvas;
  readonly checkpointOriginX?: number;
  readonly checkpointOriginY?: number;
  readonly lastUpdateDistance?: number;
  readonly lastCheckpointDistance?: number;
}

export interface BrushBranchRenderState {
  readonly accumulatedDistance: number;
  readonly emissionCount: number;
  /** 可変spacing時の、次の距離emissionまでの正規化進捗（0以上1未満） */
  readonly distanceEmissionProgress?: number;
  /** 時間emission: この分岐で最後に処理した入力時刻 */
  readonly lastTimestamp?: number;
  /** 時間emission: 次にemissionを配置する予定時刻 */
  readonly nextTimeEmissionAt?: number;
  readonly mixing?: BrushMixingState;
  readonly bristle?: BristleBranchRenderState;
}

export interface BrushRenderState {
  readonly tipCanvas: OffscreenCanvas | null;
  readonly seed: number;
  readonly branches: readonly BrushBranchRenderState[];
}

// ============================================================
// StrokeStyle
// ============================================================

export interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureCurve: PressureCurve;
  readonly compositeOperation: GlobalCompositeOperation;
  readonly brush: BrushConfig;
}
