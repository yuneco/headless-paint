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
  readonly distanceEmissionProgress?: number;
  readonly lastTimestamp?: number;
  readonly nextTimeEmissionAt?: number;
}

export type DistanceSpacingAt = (point: StrokePoint) => number;

const MIN_DISTANCE_SPACING_PX = 0.5;
const MAX_EMISSIONS_PER_WALK = 4096;

/**
 * emissionsPerSecond（吹きつけレート）を時間間隔(ms)に変換する。
 * 未指定 or 0以下は時間emission無効を意味する undefined を返す。
 */
export function timeSpacingMsFromRate(
  emissionsPerSecond: number | undefined,
): number | undefined {
  if (
    emissionsPerSecond === undefined ||
    !Number.isFinite(emissionsPerSecond) ||
    emissionsPerSecond <= 0
  ) {
    return undefined;
  }
  return 1000 / emissionsPerSecond;
}

/**
 * Catmull-Rom 補間済み点列を歩き、emission ごとに callback を呼ぶ。
 *
 * - 距離emission: 累積距離が spacingPx に達するごとに配置（従来動作）
 * - 時間emission: timeSpacingMs が有効かつ点列が timestamp を持つ場合、
 *   入力時刻が timeSpacingMs 進むごとに配置（静止中の吹きつけ）
 *
 * 両者はセグメント内の発生位置順に merge され、単一の emissionIndex 空間を
 * 消費する。これにより incremental / replay で PRNG 列が一致する。
 * 時間emissionのスケジュールは state（lastTimestamp / nextTimeEmissionAt）に
 * 保持され、overlap 再入力（timestamp が lastTimestamp 以前の区間）では
 * 二重配置されない。
 */
export function walkEmissions(
  interpolated: readonly StrokePoint[],
  spacingPx: number,
  startState: EmissionStartState,
  overlapCount: number,
  emit: (point: EmissionPoint) => void,
  timeSpacingMs?: number,
  spacingAt?: DistanceSpacingAt,
): EmissionStartState {
  if (spacingAt) {
    return walkAdaptiveEmissions(
      interpolated,
      spacingPx,
      startState,
      overlapCount,
      emit,
      timeSpacingMs,
      spacingAt,
    );
  }

  return walkFixedEmissions(
    interpolated,
    spacingPx,
    startState,
    overlapCount,
    emit,
    timeSpacingMs,
  );
}

function walkFixedEmissions(
  interpolated: readonly StrokePoint[],
  spacingPx: number,
  startState: EmissionStartState,
  overlapCount: number,
  emit: (point: EmissionPoint) => void,
  timeSpacingMs?: number,
): EmissionStartState {
  let totalDistance = startState.accumulatedDistance;
  let emissionCount = startState.emissionCount;
  let lastTimestamp = startState.lastTimestamp;
  let nextTimeEmissionAt = startState.nextTimeEmissionAt;

  const timeEnabled = timeSpacingMs !== undefined && timeSpacingMs > 0;

  if (spacingPx <= 0 || interpolated.length === 0) {
    return {
      accumulatedDistance: totalDistance,
      emissionCount,
      lastTimestamp,
      nextTimeEmissionAt,
    };
  }

  // ストローク開始点で時間スケジュールを初期化する
  if (
    timeEnabled &&
    nextTimeEmissionAt === undefined &&
    interpolated[0].timestamp !== undefined
  ) {
    lastTimestamp = interpolated[0].timestamp;
    nextTimeEmissionAt = interpolated[0].timestamp + timeSpacingMs;
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
    return {
      accumulatedDistance: totalDistance,
      emissionCount,
      lastTimestamp,
      nextTimeEmissionAt,
    };
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

    const segmentStart = totalDistance;
    const segmentEnd = totalDistance + segmentLength;

    const t1 = p1.timestamp;
    const t2 = p2.timestamp;
    // overlap 再入力区間（t2 <= lastTimestamp）と非単調 timestamp は時間対象外
    const segmentHasTime =
      timeEnabled &&
      nextTimeEmissionAt !== undefined &&
      t1 !== undefined &&
      t2 !== undefined &&
      t2 >= t1 &&
      (lastTimestamp === undefined || t2 > lastTimestamp);

    const pressure1 = p1.pressure ?? 0.5;
    const pressure2 = p2.pressure ?? 0.5;

    while (true) {
      const distReady = segmentLength > 0 && nextEmissionDistance <= segmentEnd;
      const timeReady =
        segmentHasTime &&
        nextTimeEmissionAt !== undefined &&
        nextTimeEmissionAt <= (t2 as number);

      if (!distReady && !timeReady) break;

      const fracDist = distReady
        ? (nextEmissionDistance - segmentStart) / segmentLength
        : Number.POSITIVE_INFINITY;
      const fracTime = timeReady
        ? Math.min(
            1,
            Math.max(
              0,
              (t2 as number) > (t1 as number)
                ? ((nextTimeEmissionAt as number) - (t1 as number)) /
                    ((t2 as number) - (t1 as number))
                : 1,
            ),
          )
        : Number.POSITIVE_INFINITY;

      if (fracDist <= fracTime) {
        emit({
          x: p1.x + dx * fracDist,
          y: p1.y + dy * fracDist,
          pressure: pressure1 + (pressure2 - pressure1) * fracDist,
          distance: nextEmissionDistance,
          emissionIndex: emissionCount,
        });
        emissionCount++;
        nextEmissionDistance += spacingPx;
      } else {
        emit({
          x: p1.x + dx * fracTime,
          y: p1.y + dy * fracTime,
          pressure: pressure1 + (pressure2 - pressure1) * fracTime,
          distance: segmentStart + segmentLength * fracTime,
          emissionIndex: emissionCount,
        });
        emissionCount++;
        nextTimeEmissionAt =
          (nextTimeEmissionAt as number) + (timeSpacingMs as number);
      }
    }

    totalDistance = segmentEnd;
    if (
      t2 !== undefined &&
      (lastTimestamp === undefined || t2 > lastTimestamp)
    ) {
      lastTimestamp = t2;
    }
  }

  return {
    accumulatedDistance: totalDistance,
    emissionCount,
    lastTimestamp,
    nextTimeEmissionAt,
  };
}

/**
 * 局所spacingを「1pxあたりのemission進捗」へ変換して積分する。
 * 点間ではその密度が線形に変化するとみなし、チャンク境界を跨いでも
 * distanceEmissionProgressを引き継ぐことで同じemission列を得る。
 */
function walkAdaptiveEmissions(
  interpolated: readonly StrokePoint[],
  fallbackSpacingPx: number,
  startState: EmissionStartState,
  overlapCount: number,
  emit: (point: EmissionPoint) => void,
  timeSpacingMs: number | undefined,
  spacingAt: DistanceSpacingAt,
): EmissionStartState {
  let totalDistance = startState.accumulatedDistance;
  let emissionCount = startState.emissionCount;
  let distanceEmissionProgress = normalizeProgress(
    startState.distanceEmissionProgress ?? 0,
  );
  let lastTimestamp = startState.lastTimestamp;
  let nextTimeEmissionAt = startState.nextTimeEmissionAt;
  let callbackCount = 0;

  const timeEnabled = timeSpacingMs !== undefined && timeSpacingMs > 0;
  if (fallbackSpacingPx <= 0 || interpolated.length === 0) {
    return {
      accumulatedDistance: totalDistance,
      emissionCount,
      distanceEmissionProgress,
      lastTimestamp,
      nextTimeEmissionAt,
    };
  }

  if (
    timeEnabled &&
    nextTimeEmissionAt === undefined &&
    interpolated[0].timestamp !== undefined
  ) {
    lastTimestamp = interpolated[0].timestamp;
    nextTimeEmissionAt = interpolated[0].timestamp + timeSpacingMs;
  }

  const emitCapped = (point: EmissionPoint) => {
    if (callbackCount < MAX_EMISSIONS_PER_WALK) {
      emit(point);
      callbackCount++;
    }
    emissionCount++;
  };

  if (totalDistance === 0 && overlapCount === 0) {
    const first = interpolated[0];
    emitCapped({
      x: first.x,
      y: first.y,
      pressure: first.pressure,
      distance: 0,
      emissionIndex: emissionCount,
    });
  }

  for (let i = 1; i < interpolated.length; i++) {
    const p1 = interpolated[i - 1];
    const p2 = interpolated[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segmentLength = Math.hypot(dx, dy);
    const segmentStart = totalDistance;

    const spacing1 = sanitizeSpacing(spacingAt(p1), fallbackSpacingPx);
    const spacing2 = sanitizeSpacing(spacingAt(p2), fallbackSpacingPx);
    const density1 = 1 / spacing1;
    const density2 = 1 / spacing2;
    const segmentPhase =
      segmentLength > 0 ? (segmentLength * (density1 + density2)) / 2 : 0;
    const distanceFractions: number[] = [];
    const phaseEnd = distanceEmissionProgress + segmentPhase;

    for (let threshold = 1; threshold <= phaseEnd + 1e-9; threshold++) {
      const targetPhase = threshold - distanceEmissionProgress;
      if (targetPhase <= 0 || targetPhase > segmentPhase + 1e-9) continue;
      distanceFractions.push(
        solvePhaseFraction(targetPhase, segmentLength, density1, density2),
      );
    }
    distanceEmissionProgress = normalizeProgress(phaseEnd);

    const t1 = p1.timestamp;
    const t2 = p2.timestamp;
    const segmentHasTime =
      timeEnabled &&
      nextTimeEmissionAt !== undefined &&
      t1 !== undefined &&
      t2 !== undefined &&
      t2 >= t1 &&
      (lastTimestamp === undefined || t2 > lastTimestamp);
    const timeFractions: number[] = [];
    if (segmentHasTime) {
      while (
        nextTimeEmissionAt !== undefined &&
        nextTimeEmissionAt <= (t2 as number)
      ) {
        timeFractions.push(
          Math.min(
            1,
            Math.max(
              0,
              (t2 as number) > (t1 as number)
                ? (nextTimeEmissionAt - (t1 as number)) /
                    ((t2 as number) - (t1 as number))
                : 1,
            ),
          ),
        );
        nextTimeEmissionAt += timeSpacingMs as number;
      }
    }

    const pressure1 = p1.pressure ?? 0.5;
    const pressure2 = p2.pressure ?? 0.5;
    let distanceIndex = 0;
    let timeIndex = 0;
    while (
      distanceIndex < distanceFractions.length ||
      timeIndex < timeFractions.length
    ) {
      const distanceFraction =
        distanceFractions[distanceIndex] ?? Number.POSITIVE_INFINITY;
      const timeFraction = timeFractions[timeIndex] ?? Number.POSITIVE_INFINITY;
      const fraction = Math.min(distanceFraction, timeFraction);
      emitCapped({
        x: p1.x + dx * fraction,
        y: p1.y + dy * fraction,
        pressure: pressure1 + (pressure2 - pressure1) * fraction,
        distance: segmentStart + segmentLength * fraction,
        emissionIndex: emissionCount,
      });
      if (distanceFraction <= timeFraction) {
        distanceIndex++;
      } else {
        timeIndex++;
      }
    }

    totalDistance += segmentLength;
    if (
      t2 !== undefined &&
      (lastTimestamp === undefined || t2 > lastTimestamp)
    ) {
      lastTimestamp = t2;
    }
  }

  return {
    accumulatedDistance: totalDistance,
    emissionCount,
    distanceEmissionProgress,
    lastTimestamp,
    nextTimeEmissionAt,
  };
}

function sanitizeSpacing(value: number, fallback: number): number {
  const finite = Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.max(MIN_DISTANCE_SPACING_PX, finite);
}

function normalizeProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value % 1) + 1) % 1;
  return normalized < 1e-9 || normalized > 1 - 1e-9 ? 0 : normalized;
}

function solvePhaseFraction(
  targetPhase: number,
  segmentLength: number,
  density1: number,
  density2: number,
): number {
  if (segmentLength <= 0) return 0;
  const normalizedTarget = targetPhase / segmentLength;
  const densityDelta = density2 - density1;
  if (Math.abs(densityDelta) < 1e-9) {
    return Math.min(1, Math.max(0, normalizedTarget / density1));
  }
  const discriminant = Math.max(
    0,
    density1 * density1 + 2 * densityDelta * normalizedTarget,
  );
  const denominator = density1 + Math.sqrt(discriminant);
  const fraction = denominator > 0 ? (2 * normalizedTarget) / denominator : 0;
  return Math.min(1, Math.max(0, fraction));
}
