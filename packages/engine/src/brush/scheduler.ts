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
  readonly lastTimestamp?: number;
  readonly nextTimeEmissionAt?: number;
}

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
