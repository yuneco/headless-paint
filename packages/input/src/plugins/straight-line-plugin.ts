import type {
  FilterPlugin,
  FilterState,
  FilterStepResult,
  InputPoint,
} from "../types";

/**
 * 直線フィルタの状態
 */
interface StraightLineState extends FilterState {
  readonly startPoint: InputPoint | null;
  readonly lastPoint: InputPoint | null;
  readonly pressures: readonly number[];
}

/**
 * 中央値を計算する
 * 偶数個の場合は中央2値の平均
 */
function computeMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * 筆圧を中央値に置換した点を生成する
 */
function withMedianPressure(
  point: InputPoint,
  medianPressure: number,
): InputPoint {
  return {
    x: point.x,
    y: point.y,
    pressure: medianPressure,
    timestamp: point.timestamp,
  };
}

/**
 * 直線フィルタプラグイン
 *
 * 入力点を直線（始点→終点の2点）に集約する。
 * 描画中は committed を空に保ち、pending に始点→現在点のプレビューを出力する。
 * finalize 時に2点を committed として確定する。
 * 筆圧はストローク中の全入力の中央値を適用する。
 */
export const straightLinePlugin: FilterPlugin = {
  type: "straight-line",

  createState(_config: unknown): StraightLineState {
    return {
      startPoint: null,
      lastPoint: null,
      pressures: [],
    };
  },

  process(state: FilterState, point: InputPoint): FilterStepResult {
    const slState = state as StraightLineState;
    const pressure = point.pressure ?? 0.5;
    const pressures = [...slState.pressures, pressure];
    const median = computeMedian(pressures);

    if (slState.startPoint === null) {
      // 1点目: pending に保持
      const newState: StraightLineState = {
        startPoint: point,
        lastPoint: point,
        pressures,
      };
      return {
        state: newState,
        committed: [],
        pending: [withMedianPressure(point, median)],
      };
    }

    // N点目: committed=[], pending=[start', current']
    const newState: StraightLineState = {
      startPoint: slState.startPoint,
      lastPoint: point,
      pressures,
    };
    return {
      state: newState,
      committed: [],
      pending: [
        withMedianPressure(slState.startPoint, median),
        withMedianPressure(point, median),
      ],
    };
  },

  finalize(state: FilterState): FilterStepResult {
    const slState = state as StraightLineState;

    if (slState.startPoint === null) {
      return {
        state: { startPoint: null, lastPoint: null, pressures: [] },
        committed: [],
        pending: [],
      };
    }

    const median = computeMedian(slState.pressures);
    const lastPoint = slState.lastPoint ?? slState.startPoint;

    // 1点のみの場合
    if (
      slState.startPoint.x === lastPoint.x &&
      slState.startPoint.y === lastPoint.y &&
      slState.startPoint.timestamp === lastPoint.timestamp
    ) {
      return {
        state: { startPoint: null, lastPoint: null, pressures: [] },
        committed: [withMedianPressure(slState.startPoint, median)],
        pending: [],
      };
    }

    // 2点を確定
    return {
      state: { startPoint: null, lastPoint: null, pressures: [] },
      committed: [
        withMedianPressure(slState.startPoint, median),
        withMedianPressure(lastPoint, median),
      ],
      pending: [],
    };
  },
};
