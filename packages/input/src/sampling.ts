import type { Point, SamplingConfig, SamplingState } from "./types";

const DEFAULT_MIN_DISTANCE = 2;
const DEFAULT_MIN_TIME_INTERVAL = 0;

/**
 * 2点間の距離を計算
 */
function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 座標を採用するかどうかを判定
 * @param point 判定対象の座標（Layer Space）
 * @param timestamp イベントのタイムスタンプ（ms）
 * @param state 現在の間引き状態
 * @param config 間引き設定
 * @returns [採用するか, 更新された状態]
 */
export function shouldAcceptPoint(
  point: Point,
  timestamp: number,
  state: SamplingState,
  config: SamplingConfig,
): [boolean, SamplingState] {
  const minDistance = config.minDistance ?? DEFAULT_MIN_DISTANCE;
  const minTimeInterval = config.minTimeInterval ?? DEFAULT_MIN_TIME_INTERVAL;

  // 最初の点は常に採用
  if (state.lastPoint === null) {
    return [true, { lastPoint: point, lastTimestamp: timestamp }];
  }

  // 距離チェック
  const dist = distance(state.lastPoint, point);
  if (dist >= minDistance) {
    return [true, { lastPoint: point, lastTimestamp: timestamp }];
  }

  // 時間チェック
  if (state.lastTimestamp !== null && minTimeInterval > 0) {
    const elapsed = timestamp - state.lastTimestamp;
    if (elapsed >= minTimeInterval) {
      return [true, { lastPoint: point, lastTimestamp: timestamp }];
    }
  }

  // 不採用（状態は変更しない）
  return [false, state];
}

/**
 * 間引き状態の初期値を作成
 */
export function createSamplingState(): SamplingState {
  return { lastPoint: null, lastTimestamp: null };
}
