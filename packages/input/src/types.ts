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
