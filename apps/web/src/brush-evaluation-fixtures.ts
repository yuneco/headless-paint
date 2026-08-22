import type { InputPoint } from "@headless-paint/input";

export const BRISTLE_S_CURVE_FIXTURE_WIDTH = 900;
export const BRISTLE_S_CURVE_FIXTURE_HEIGHT = 360;

const BRISTLE_S_CURVE_SAMPLE_COUNT = 121;
const BRISTLE_S_CURVE_SAMPLE_INTERVAL_MS = 8;

/**
 * LabのCOMB評価で使った固定S字を、指定した左上座標へ配置する。
 * 筆圧はstroke両端の0.15から中央の1.0まで滑らかに往復する。
 */
export function createBristleSCurveEvaluationPoints(
  originX: number,
  originY: number,
): readonly InputPoint[] {
  return Array.from({ length: BRISTLE_S_CURVE_SAMPLE_COUNT }, (_, index) => {
    const progress = index / (BRISTLE_S_CURVE_SAMPLE_COUNT - 1);
    return {
      x: originX + 70 + progress * 760,
      y: originY + 180 + Math.sin((progress - 0.5) * Math.PI * 2) * 105,
      pressure: 0.15 + Math.sin(progress * Math.PI) ** 2 * 0.85,
      timestamp: index * BRISTLE_S_CURVE_SAMPLE_INTERVAL_MS,
    };
  });
}
