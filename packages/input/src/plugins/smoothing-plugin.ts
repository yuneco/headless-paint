import type {
  FilterPlugin,
  FilterState,
  FilterStepResult,
  InputPoint,
  SmoothingConfig,
} from "../types";

/**
 * スムージングフィルタの状態
 */
interface SmoothingState extends FilterState {
  readonly buffer: readonly InputPoint[];
  readonly windowSize: number;
  readonly hasCommitted: boolean;
}

/**
 * 移動平均を計算して点を生成
 */
function calculateSmoothedPoint(
  buffer: readonly InputPoint[],
  targetIndex: number,
): InputPoint {
  const windowSize = buffer.length;
  const halfWindow = Math.floor(windowSize / 2);

  // 重み付き移動平均（中央に近いほど重みが大きい）
  let sumX = 0;
  let sumY = 0;
  let sumPressure = 0;
  let totalWeight = 0;
  let hasPressure = false;

  for (let i = 0; i < windowSize; i++) {
    const point = buffer[i];
    // 距離に基づく重み（中央が最大）
    const distance = Math.abs(i - halfWindow);
    const weight = windowSize - distance;

    sumX += point.x * weight;
    sumY += point.y * weight;
    if (point.pressure !== undefined) {
      sumPressure += point.pressure * weight;
      hasPressure = true;
    }
    totalWeight += weight;
  }

  const targetPoint = buffer[targetIndex];

  return {
    x: sumX / totalWeight,
    y: sumY / totalWeight,
    pressure: hasPressure ? sumPressure / totalWeight : undefined,
    timestamp: targetPoint.timestamp,
  };
}

/**
 * エッジ対応のスムージング計算（1点分）
 * 指定 index の点を、バッファ内の利用可能な範囲で平滑化する
 */
function smoothPointAtIndex(
  buffer: readonly InputPoint[],
  index: number,
  windowSize: number,
): InputPoint {
  const halfWindow = Math.floor(windowSize / 2);
  const start = Math.max(0, index - halfWindow);
  const end = Math.min(buffer.length, index + halfWindow + 1);
  const subBuffer = buffer.slice(start, end);
  const targetIndex = index - start;

  if (subBuffer.length === 1) {
    return subBuffer[0];
  }
  return calculateSmoothedPoint(subBuffer, targetIndex);
}

/**
 * pending点（未確定点）の平滑化座標を計算
 * startIndex 以降のバッファ点のみを返す（それ以前はcommit済み）
 * バッファ全体をコンテキストとして使いつつ、出力はstartIndex以降のみ
 */
function calculatePendingPoints(
  buffer: readonly InputPoint[],
  windowSize: number,
  startIndex: number,
): InputPoint[] {
  if (buffer.length === 0 || startIndex >= buffer.length) return [];

  const result: InputPoint[] = [];
  for (let index = startIndex; index < buffer.length; index++) {
    result.push(smoothPointAtIndex(buffer, index, windowSize));
  }
  return result;
}

/**
 * スムージングフィルタプラグイン
 */
export const smoothingPlugin: FilterPlugin = {
  type: "smoothing",

  createState(config: unknown): SmoothingState {
    const smoothingConfig = config as SmoothingConfig;
    return {
      buffer: [],
      windowSize: smoothingConfig.windowSize,
      hasCommitted: false,
    };
  },

  process(state: FilterState, point: InputPoint): FilterStepResult {
    const smoothingState = state as SmoothingState;
    let buffer = [...smoothingState.buffer, point];
    const committed: InputPoint[] = [];
    const halfWindow = Math.floor(smoothingState.windowSize / 2);
    let hasCommitted = smoothingState.hasCommitted;

    // バッファが windowSize を超えた場合、点を確定してバッファをシフト
    //
    // 例: windowSize=5, halfWindow=2
    //   buffer = [P0, P1, P2, P3, P4, P5] (6点、超過)
    //   window = [P0, P1, P2, P3, P4] で P2 (center) を確定
    //   シフト後 buffer = [P1, P2, P3, P4, P5]
    //
    if (buffer.length > smoothingState.windowSize) {
      const window = buffer.slice(0, smoothingState.windowSize);

      if (!hasCommitted) {
        // 初回 commit: 先頭のエッジ点（0 〜 halfWindow）も一緒に確定
        // これらの点は center になれないため、初回に一括で commit しないと消失する
        // エッジ点は縮小ウィンドウで計算（finalize と同じ手法）
        for (let i = 0; i <= halfWindow; i++) {
          committed.push(
            smoothPointAtIndex(window, i, smoothingState.windowSize),
          );
        }
      } else {
        // 通常 commit: フルウィンドウの中央1点のみ確定
        committed.push(calculateSmoothedPoint(window, halfWindow));
      }

      buffer = buffer.slice(1); // イミュータブルにシフト
      hasCommitted = true;
    }

    // pending の開始インデックス:
    // - commit 済み: バッファ先頭 halfWindow 個は既に commit 済みなのでスキップ
    //   → pending は buffer[halfWindow] (= center) から開始
    //   → center はフルウィンドウで計算されるため、commit 時と同一座標になる
    // - 未 commit: 全バッファ点が pending
    const pendingStartIndex = hasCommitted ? halfWindow : 0;

    return {
      state: {
        buffer,
        windowSize: smoothingState.windowSize,
        hasCommitted,
      } as SmoothingState,
      committed,
      pending: calculatePendingPoints(
        buffer,
        smoothingState.windowSize,
        pendingStartIndex,
      ),
    };
  },

  finalize(state: FilterState): FilterStepResult {
    const smoothingState = state as SmoothingState;
    const buffer = smoothingState.buffer;
    const halfWindow = Math.floor(smoothingState.windowSize / 2);

    if (buffer.length === 0) {
      return {
        state: {
          buffer: [],
          windowSize: smoothingState.windowSize,
          hasCommitted: false,
        },
        committed: [],
        pending: [],
      };
    }

    // finalize: バッファに残っている全点を確定
    //
    // startIndex の決定:
    // - hasCommitted=true: streaming 中に commit 済みの点（0 〜 halfWindow-1）をスキップ
    // - hasCommitted=false: 短いストローク（windowSize 未満）で一度も commit されていない
    //   → 全点を commit
    //
    // 各点は smoothPointAtIndex で縮小ウィンドウにより平滑化
    // （バッファ端では利用可能な範囲のみ使用）
    const startIndex = smoothingState.hasCommitted ? halfWindow : 0;
    const committed: InputPoint[] = [];

    for (let i = startIndex; i < buffer.length; i++) {
      committed.push(
        smoothPointAtIndex(buffer, i, smoothingState.windowSize),
      );
    }

    return {
      state: {
        buffer: [],
        windowSize: smoothingState.windowSize,
        hasCommitted: false,
      } as SmoothingState,
      committed,
      pending: [],
    };
  },
};
