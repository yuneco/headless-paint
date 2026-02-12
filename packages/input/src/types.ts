import type { mat3 } from "gl-matrix";

/**
 * 2次元座標
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * ビュー変換行列（3x3）
 * Layer Space ↔ Screen Space の変換を表す
 */
export type ViewTransform = mat3;

/**
 * 入力座標の間引き設定
 */
export interface SamplingConfig {
  /** 最小距離（ピクセル）。デフォルト: 2 */
  readonly minDistance?: number;
  /** 最小時間間隔（ミリ秒）。デフォルト: 0 */
  readonly minTimeInterval?: number;
}

/**
 * 間引き処理の状態
 */
export interface SamplingState {
  /** 最後に採用した座標 */
  readonly lastPoint: Point | null;
  /** 最後に採用した時刻（ms） */
  readonly lastTimestamp: number | null;
}

/**
 * 変換行列から抽出した変換成分
 */
export interface TransformComponents {
  /** X軸方向のスケール */
  readonly scaleX: number;
  /** Y軸方向のスケール */
  readonly scaleY: number;
  /** 回転角度（ラジアン、正=反時計回り） */
  readonly rotation: number;
  /** X軸方向の平行移動 */
  readonly translateX: number;
  /** Y軸方向の平行移動 */
  readonly translateY: number;
}

// ============================================================
// InputPoint（入力点）
// ============================================================

/**
 * 入力点を表す型
 * 座標に加えて筆圧とタイムスタンプを持つ
 */
export interface InputPoint {
  readonly x: number;
  readonly y: number;
  /** 筆圧（0.0-1.0、オプション） */
  readonly pressure?: number;
  /** タイムスタンプ（ミリ秒） */
  readonly timestamp: number;
}

// ============================================================
// Filter Plugin（フィルタプラグイン）
// ============================================================

/**
 * フィルタの状態（各プラグインで拡張）
 */
// biome-ignore lint/suspicious/noEmptyInterface: プラグインが extends で拡張するための基底interface
export interface FilterState {}

/**
 * フィルタ処理1ステップの結果
 */
export interface FilterStepResult {
  readonly state: FilterState;
  readonly committed: readonly InputPoint[];
  readonly pending: readonly InputPoint[];
}

/**
 * フィルタプラグインのインターフェース
 */
export interface FilterPlugin {
  readonly type: string;
  createState(config: unknown): FilterState;
  process(state: FilterState, point: InputPoint): FilterStepResult;
  finalize(state: FilterState): FilterStepResult;
}

// ============================================================
// Filter Config（フィルタ設定）
// ============================================================

/**
 * フィルタの種類
 */
export type FilterType = "smoothing" | "straight-line";

/**
 * スムージングフィルタの設定
 */
export interface SmoothingConfig {
  /** 移動平均のウィンドウサイズ（3以上の奇数推奨） */
  readonly windowSize: number;
}

/**
 * 直線フィルタの設定
 */
// biome-ignore lint/suspicious/noEmptyInterface: 設定項目は現時点でないが、FilterConfig union の一貫性のため型を用意
export interface StraightLineConfig {}

/**
 * フィルタ設定（Discriminated Union）
 */
export type FilterConfig =
  | { readonly type: "smoothing"; readonly config: SmoothingConfig }
  | { readonly type: "straight-line"; readonly config: StraightLineConfig };

// ============================================================
// Filter Pipeline（フィルタパイプライン）
// ============================================================

/**
 * フィルタパイプラインの設定
 */
export interface FilterPipelineConfig {
  readonly filters: readonly FilterConfig[];
}

/**
 * コンパイル済みフィルタパイプライン
 */
export interface CompiledFilterPipeline {
  readonly config: FilterPipelineConfig;
  readonly plugins: readonly FilterPlugin[];
}

/**
 * フィルタパイプラインの状態
 */
export interface FilterPipelineState {
  readonly filterStates: readonly FilterState[];
  readonly allCommitted: readonly InputPoint[];
}

/**
 * フィルタパイプラインの出力
 */
export interface FilterOutput {
  /** 確定済みの点（座標変更なし） */
  readonly committed: readonly InputPoint[];
  /** 未確定の点（座標変更の可能性あり） */
  readonly pending: readonly InputPoint[];
}

/**
 * フィルタ処理の結果
 */
export interface FilterProcessResult {
  readonly state: FilterPipelineState;
  readonly output: FilterOutput;
}

// ============================================================
// Gesture（マルチタッチジェスチャー）
// ============================================================

/**
 * ジェスチャー入力イベント（DOM非依存）
 */
export interface GesturePointerEvent {
  readonly pointerId: number;
  readonly pointerType: "touch" | "pen" | "mouse";
  readonly x: number; // Screen Space
  readonly y: number; // Screen Space
  readonly pressure: number;
  readonly timestamp: number;
  readonly eventType: "down" | "move" | "up" | "cancel";
}

/**
 * ジェスチャー認識の設定
 */
export interface GestureConfig {
  /** 二本指切替の猶予期間（ミリ秒）。デフォルト: 150 */
  readonly graceWindowMs: number;
  /** ストローク確定の移動閾値（ピクセル）。デフォルト: 10 */
  readonly confirmDistancePx: number;
  /** Undo判定の最大移動量（ピクセル）。デフォルト: 20 */
  readonly undoMaxMovePx: number;
  /** Undo判定の最大時間（ミリ秒）。デフォルト: 300 */
  readonly undoMaxDurationMs: number;
}

/**
 * ジェスチャー状態マシンの状態（Discriminated Union）
 *
 * idle → single_down → drawing → idle
 *                    → gesture → gesture_ending → idle
 */
export type GestureState =
  | { readonly phase: "idle" }
  | {
      readonly phase: "single_down";
      readonly primaryPointerId: number;
      readonly downTimestamp: number;
      readonly downPos: Point;
      readonly lastPos: Point;
    }
  | {
      readonly phase: "drawing";
      readonly primaryPointerId: number;
      readonly downTimestamp: number;
    }
  | {
      readonly phase: "gesture";
      readonly primaryPointerId: number;
      readonly secondaryPointerId: number;
      readonly layerP1: Point;
      readonly layerP2: Point;
      readonly lastScreenP1: Point;
      readonly lastScreenP2: Point;
      readonly downTimestamp: number;
      readonly gestureMoved: boolean;
    }
  | {
      readonly phase: "gesture_ending";
      readonly remainingPointerId: number;
      readonly layerP1: Point;
      readonly layerP2: Point;
      readonly lastScreenP1: Point;
      readonly lastScreenP2: Point;
      readonly downTimestamp: number;
      readonly gestureMoved: boolean;
    };

/**
 * ジェスチャー状態マシンが発行する出力イベント
 */
export type GestureEvent =
  | { readonly type: "draw-start"; readonly point: GesturePointerEvent }
  | { readonly type: "draw-move"; readonly point: GesturePointerEvent }
  | { readonly type: "draw-confirm" }
  | { readonly type: "draw-end" }
  | { readonly type: "draw-cancel" }
  | { readonly type: "pinch-start"; readonly transform: ViewTransform }
  | { readonly type: "pinch-move"; readonly transform: ViewTransform }
  | { readonly type: "pinch-end" }
  | { readonly type: "undo" };
