import type { StrokePoint } from "../types";

export interface EmissionPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number | undefined;
  readonly distance: number;
  readonly emissionIndex: number;
}

interface EmissionStartState {
  readonly accumulatedDistance: number;
  readonly emissionCount: number;
}

/**
 * Catmull-Rom 補間済み点列を距離 spacing で歩き、emission ごとに callback を呼ぶ。
 */
export function walkEmissions(
  interpolated: readonly StrokePoint[],
  spacingPx: number,
  startState: EmissionStartState,
  overlapCount: number,
  emit: (point: EmissionPoint) => void,
): EmissionStartState {
  let totalDistance = startState.accumulatedDistance;
  let emissionCount = startState.emissionCount;

  if (spacingPx <= 0 || interpolated.length === 0) {
    return { accumulatedDistance: totalDistance, emissionCount };
  }

  if (totalDistance === 0 && overlapCount === 0) {
    const first = interpolated[0];
    emit({
      x: first.x,
      y: first.y,
      pressure: first.pressure,
      distance: 0,
      emissionIndex: emissionCount,
    });
    emissionCount++;
  }

  if (interpolated.length < 2) {
    return { accumulatedDistance: totalDistance, emissionCount };
  }

  let nextEmissionDistance =
    totalDistance === 0
      ? spacingPx
      : Math.ceil(totalDistance / spacingPx) * spacingPx;
  if (nextEmissionDistance <= totalDistance && totalDistance > 0) {
    nextEmissionDistance += spacingPx;
  }

  for (let i = 1; i < interpolated.length; i++) {
    const p1 = interpolated[i - 1];
    const p2 = interpolated[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    if (segmentLength === 0) continue;

    const segmentStart = totalDistance;
    const segmentEnd = totalDistance + segmentLength;

    while (nextEmissionDistance <= segmentEnd) {
      const t = (nextEmissionDistance - segmentStart) / segmentLength;
      const pressure1 = p1.pressure ?? 0.5;
      const pressure2 = p2.pressure ?? 0.5;
      emit({
        x: p1.x + dx * t,
        y: p1.y + dy * t,
        pressure: pressure1 + (pressure2 - pressure1) * t,
        distance: nextEmissionDistance,
        emissionIndex: emissionCount,
      });
      emissionCount++;
      nextEmissionDistance += spacingPx;
    }

    totalDistance = segmentEnd;
  }

  return { accumulatedDistance: totalDistance, emissionCount };
}
