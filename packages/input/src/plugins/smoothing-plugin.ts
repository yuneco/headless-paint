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
 * pending点（未確定点）の平滑化座標を計算
 */
function calculatePendingPoints(buffer: readonly InputPoint[]): InputPoint[] {
  if (buffer.length === 0) return [];

  // 各点について、その点までのバッファで平滑化
  return buffer.map((_, index) => {
    const subBuffer = buffer.slice(0, index + 1);
    if (subBuffer.length === 1) {
      return subBuffer[0];
    }
    return calculateSmoothedPoint(subBuffer, subBuffer.length - 1);
  });
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
    };
  },

  process(state: FilterState, point: InputPoint): FilterStepResult {
    const smoothingState = state as SmoothingState;
    const newBuffer = [...smoothingState.buffer, point];
    const committed: InputPoint[] = [];

    // バッファがwindowSizeを超えた場合、最も古い点を確定
    if (newBuffer.length > smoothingState.windowSize) {
      // ウィンドウ全体を使って平滑化した点を確定
      const smoothedPoint = calculateSmoothedPoint(
        newBuffer.slice(0, smoothingState.windowSize),
        Math.floor(smoothingState.windowSize / 2),
      );
      committed.push(smoothedPoint);
      newBuffer.shift();
    }

    return {
      state: {
        buffer: newBuffer,
        windowSize: smoothingState.windowSize,
      } as SmoothingState,
      committed,
      pending: calculatePendingPoints(newBuffer),
    };
  },

  finalize(state: FilterState): FilterStepResult {
    const smoothingState = state as SmoothingState;
    const buffer = smoothingState.buffer;

    if (buffer.length === 0) {
      return {
        state: { buffer: [], windowSize: smoothingState.windowSize },
        committed: [],
        pending: [],
      };
    }

    // 残りのバッファを全て確定
    // 各点について、可能な範囲での平滑化を適用
    const committed: InputPoint[] = [];

    for (let i = 0; i < buffer.length; i++) {
      // 中央から端に向かって、ウィンドウを縮小しながら平滑化
      const start = Math.max(0, i - Math.floor(smoothingState.windowSize / 2));
      const end = Math.min(
        buffer.length,
        i + Math.floor(smoothingState.windowSize / 2) + 1,
      );
      const subBuffer = buffer.slice(start, end);
      const targetIndex = i - start;
      committed.push(calculateSmoothedPoint(subBuffer, targetIndex));
    }

    return {
      state: {
        buffer: [],
        windowSize: smoothingState.windowSize,
      } as SmoothingState,
      committed,
      pending: [],
    };
  },
};
