import { evaluateParametricCurve } from "../draw";
import type { StrokeStyle } from "../types";

export function calculatePressureFlow(
  pressure: number | undefined,
  baseFlow: number,
  pressureFlow: number,
  pressureCurve: StrokeStyle["pressureCurve"],
): number {
  const p = evaluateParametricCurve(pressure ?? 0.5, pressureCurve);
  const uniformFlow = baseFlow;
  const variableFlow = baseFlow * p;
  return uniformFlow * (1 - pressureFlow) + variableFlow * pressureFlow;
}
