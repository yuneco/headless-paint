import type {
  FilterPlugin,
  FilterState,
  FilterStepResult,
  InputPoint,
} from "../types";

interface Direction {
  readonly x: number;
  readonly y: number;
}

interface CausalAdaptiveState extends FilterState {
  readonly previousRaw?: InputPoint;
  readonly previousFiltered?: InputPoint;
  readonly previousDirection?: Direction;
}

/**
 * 未来点を待たず、低速時の細かな揺れだけを強く抑える入力補正。
 * 高速入力と急旋回ではraw inputへ近づくため、pendingを生成しない。
 */
export const causalAdaptivePlugin: FilterPlugin = {
  type: "causal-adaptive",

  createState(): CausalAdaptiveState {
    return {};
  },

  process(state: FilterState, point: InputPoint): FilterStepResult {
    const causal = state as CausalAdaptiveState;
    const previousRaw = causal.previousRaw;
    const previousFiltered = causal.previousFiltered;
    if (!previousRaw || !previousFiltered) {
      return {
        state: {
          previousRaw: point,
          previousFiltered: point,
        } satisfies CausalAdaptiveState,
        committed: [point],
        pending: [],
      };
    }

    const dt = Math.max(1, point.timestamp - previousRaw.timestamp);
    const dx = point.x - previousRaw.x;
    const dy = point.y - previousRaw.y;
    const distance = Math.hypot(dx, dy);
    const speed = distance / dt;
    const direction =
      distance > 0.01
        ? { x: dx / distance, y: dy / distance }
        : causal.previousDirection;
    let cornerFactor = 0;
    if (direction && causal.previousDirection) {
      const dot = clamp(
        direction.x * causal.previousDirection.x +
          direction.y * causal.previousDirection.y,
        -1,
        1,
      );
      cornerFactor = Math.max(0, (Math.acos(dot) - 0.55) / 1.2);
    }
    const speedFactor = clamp(speed / 2.4, 0, 1);
    const response = clamp(
      0.28 + speedFactor * 0.52 + cornerFactor * 0.4,
      0.28,
      0.95,
    );
    const filtered: InputPoint = {
      ...point,
      x: previousFiltered.x + (point.x - previousFiltered.x) * response,
      y: previousFiltered.y + (point.y - previousFiltered.y) * response,
    };
    return {
      state: {
        previousRaw: point,
        previousFiltered: filtered,
        previousDirection: direction,
      } satisfies CausalAdaptiveState,
      committed: [filtered],
      pending: [],
    };
  },

  finalize(state: FilterState): FilterStepResult {
    return { state, committed: [], pending: [] };
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
