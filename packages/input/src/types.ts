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
export type FilterType = "smoothing";

/**
 * スムージングフィルタの設定
 */
export interface SmoothingConfig {
  /** 移動平均のウィンドウサイズ（3以上の奇数推奨） */
  readonly windowSize: number;
}

/**
 * フィルタ設定（Discriminated Union）
 */
export type FilterConfig = { type: "smoothing"; config: SmoothingConfig };
// 将来の拡張:
// | { type: "pressure-curve"; config: PressureCurveConfig }

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
