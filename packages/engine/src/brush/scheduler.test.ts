import { describe, expect, it } from "vitest";
import type { StrokePoint } from "../types";
import {
  type EmissionPoint,
  timeSpacingMsFromRate,
  walkEmissions,
} from "./scheduler";

describe("walkEmissions", () => {
  it("ストローク開始 emission を overlap なしの先頭点に出す", () => {
    const emissions: number[] = [];

    const result = walkEmissions(
      [{ x: 10, y: 20, pressure: 0.5 }],
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      (point) => {
        emissions.push(point.emissionIndex);
        expect(point.x).toBe(10);
        expect(point.y).toBe(20);
        expect(point.distance).toBe(0);
      },
    );

    expect(emissions).toEqual([0]);
    expect(result).toEqual({ accumulatedDistance: 0, emissionCount: 1 });
  });

  it("overlap 文脈だけの単一点では emission を出さない", () => {
    const emissions: number[] = [];

    const result = walkEmissions(
      [{ x: 10, y: 20, pressure: 0.5 }],
      5,
      { accumulatedDistance: 10, emissionCount: 4 },
      1,
      (point) => {
        emissions.push(point.emissionIndex);
      },
    );

    expect(emissions).toEqual([]);
    expect(result).toEqual({ accumulatedDistance: 10, emissionCount: 4 });
  });

  it("spacing ごとに距離 emission を走査する", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0 },
      { x: 10, y: 0, pressure: 1 },
    ];
    const mutableEmissions: [number, number, number | undefined][] = [];

    const result = walkEmissions(
      points,
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      (point) => {
        mutableEmissions.push([point.emissionIndex, point.x, point.pressure]);
      },
    );

    expect(mutableEmissions).toEqual([
      [0, 0, 0],
      [1, 5, 0.5],
      [2, 10, 1],
    ]);
    expect(result).toEqual({ accumulatedDistance: 10, emissionCount: 3 });
  });

  it("開始点を含め全emissionへ実際の進行方向を渡す", () => {
    const directions: [number, number][] = [];

    walkEmissions(
      [
        { x: 0, y: 0, pressure: 1 },
        { x: 10, y: 0, pressure: 1 },
      ],
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      (point) => {
        directions.push([point.directionX, point.directionY]);
      },
    );

    expect(directions).toEqual([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
  });

  it("停止点を飛ばして最初の移動方向を開始emissionへ使う", () => {
    const directions: [number, number][] = [];

    walkEmissions(
      [
        { x: 4, y: 8, pressure: 1 },
        { x: 4, y: 8, pressure: 1 },
        { x: 4, y: 18, pressure: 1 },
      ],
      20,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      (point) => directions.push([point.directionX, point.directionY]),
    );

    expect(directions[0]?.[0]).toBeCloseTo(0);
    expect(directions[0]?.[1]).toBeCloseTo(1);
  });

  it("同一座標で timestamp が進むと時間 emission を出す", () => {
    const points: StrokePoint[] = [
      { x: 10, y: 10, pressure: 0.8, timestamp: 0 },
      { x: 10, y: 10, pressure: 0.8, timestamp: 100 },
    ];
    const emissions: { x: number; y: number; index: number }[] = [];

    const result = walkEmissions(
      points,
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      (point) => {
        emissions.push({ x: point.x, y: point.y, index: point.emissionIndex });
      },
      25,
    );

    // ストローク開始 emission + 時間 emission (ts=25,50,75,100)
    expect(emissions).toHaveLength(5);
    expect(emissions.map((e) => e.index)).toEqual([0, 1, 2, 3, 4]);
    for (const emission of emissions) {
      expect(emission.x).toBe(10);
      expect(emission.y).toBe(10);
    }
    expect(result.accumulatedDistance).toBe(0);
    expect(result.emissionCount).toBe(5);
    expect(result.lastTimestamp).toBe(100);
    expect(result.nextTimeEmissionAt).toBe(125);
  });

  it("timestamp がない点列では時間 emission を出さない", () => {
    const points: StrokePoint[] = [
      { x: 10, y: 10, pressure: 0.8 },
      { x: 10, y: 10, pressure: 0.8 },
    ];
    const emissions: number[] = [];

    const result = walkEmissions(
      points,
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      (point) => {
        emissions.push(point.emissionIndex);
      },
      25,
    );

    expect(emissions).toEqual([0]);
    expect(result.emissionCount).toBe(1);
    expect(result.nextTimeEmissionAt).toBeUndefined();
  });

  it("移動セグメントで距離 emission と時間 emission を発生順に merge する", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0, timestamp: 0 },
      { x: 10, y: 0, pressure: 1, timestamp: 100 },
    ];
    const emissions: { x: number; distance: number; index: number }[] = [];

    walkEmissions(
      points,
      4,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      (point) => {
        emissions.push({
          x: point.x,
          distance: point.distance,
          index: point.emissionIndex,
        });
      },
      30,
    );

    // 開始(x=0) → 時間ts30(x=3) → 距離d4(x=4) → 時間ts60(x=6) →
    // 距離d8(x=8) → 時間ts90(x=9) の順
    expect(emissions.map((e) => e.x)).toEqual([0, 3, 4, 6, 8, 9]);
    expect(emissions.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5]);
    // 時間 emission の distance は補間位置の累積距離
    expect(emissions[1].distance).toBeCloseTo(3);
    expect(emissions[3].distance).toBeCloseTo(6);
  });

  it("incremental（overlap 再入力）と一括で emission 列が一致する", () => {
    const p0: StrokePoint = { x: 0, y: 0, pressure: 0.5, timestamp: 0 };
    const p1: StrokePoint = { x: 3, y: 0, pressure: 0.5, timestamp: 40 };
    const p2: StrokePoint = { x: 3, y: 0, pressure: 0.5, timestamp: 140 };

    const collect = () => {
      const list: { x: number; index: number }[] = [];
      return {
        list,
        emit: (point: { x: number; emissionIndex: number }) => {
          list.push({ x: point.x, index: point.emissionIndex });
        },
      };
    };

    // 一括
    const batch = collect();
    const batchResult = walkEmissions(
      [p0, p1, p2],
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      batch.emit,
      25,
    );

    // 分割: [p0,p1] → overlap 1 で [p1,p2]
    const inc = collect();
    const mid = walkEmissions(
      [p0, p1],
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      inc.emit,
      25,
    );
    const incResult = walkEmissions([p1, p2], 5, mid, 1, inc.emit, 25);

    expect(inc.list).toEqual(batch.list);
    expect(incResult).toEqual(batchResult);
  });

  it("時間 emission 有効でも state を引き継げば overlap 区間で二重配置しない", () => {
    const p0: StrokePoint = { x: 10, y: 10, pressure: 0.5, timestamp: 0 };
    const p1: StrokePoint = { x: 10, y: 10, pressure: 0.5, timestamp: 50 };
    const emissions: number[] = [];
    const emit = (point: { emissionIndex: number }) => {
      emissions.push(point.emissionIndex);
    };

    const mid = walkEmissions(
      [p0, p1],
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      emit,
      25,
    );
    // 同じ区間を overlap として再入力しても新規 emission は出ない
    const result = walkEmissions([p0, p1], 5, mid, 1, emit, 25);

    // 開始 + ts=25, 50 の3つのみ
    expect(emissions).toEqual([0, 1, 2]);
    expect(result.emissionCount).toBe(3);
  });

  it("局所spacingへ追従して距離emissionを増やす", () => {
    const emissions: number[] = [];
    const result = walkEmissions(
      [
        { x: 0, y: 0, pressure: 0.25 },
        { x: 10, y: 0, pressure: 0.25 },
      ],
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      (point) => emissions.push(point.x),
      undefined,
      () => 2.5,
    );

    expect(emissions).toHaveLength(5);
    expect(emissions[0]).toBe(0);
    expect(emissions[1]).toBeCloseTo(2.5, 5);
    expect(emissions[2]).toBeCloseTo(5, 5);
    expect(emissions[3]).toBeCloseTo(7.5, 5);
    expect(emissions[4]).toBeCloseTo(10, 5);
    expect(result.distanceEmissionProgress).toBe(0);
  });

  it("可変spacingでもincrementalと一括のemission列が一致する", () => {
    const p0: StrokePoint = { x: 0, y: 0, pressure: 0.2 };
    const p1: StrokePoint = { x: 6, y: 0, pressure: 0.5 };
    const p2: StrokePoint = { x: 14, y: 0, pressure: 1 };
    const spacingAt = (point: StrokePoint) => 1 + (point.pressure ?? 0.5) * 4;
    const collect = () => {
      const values: { x: number; pressure: number | undefined }[] = [];
      return {
        values,
        emit: (point: EmissionPoint) =>
          values.push({ x: point.x, pressure: point.pressure }),
      };
    };

    const batch = collect();
    const batchState = walkEmissions(
      [p0, p1, p2],
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      batch.emit,
      undefined,
      spacingAt,
    );

    const incremental = collect();
    const mid = walkEmissions(
      [p0, p1],
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      incremental.emit,
      undefined,
      spacingAt,
    );
    const incrementalState = walkEmissions(
      [p1, p2],
      5,
      mid,
      1,
      incremental.emit,
      undefined,
      spacingAt,
    );

    expect(incremental.values).toEqual(batch.values);
    expect(incrementalState).toEqual(batchState);
  });

  it("極端な局所spacingでも1回のcallback数を制限する", () => {
    let callbacks = 0;
    const result = walkEmissions(
      [
        { x: 0, y: 0, pressure: 0 },
        { x: 3_000, y: 0, pressure: 0 },
      ],
      5,
      { accumulatedDistance: 0, emissionCount: 0 },
      0,
      () => callbacks++,
      undefined,
      () => 0.01,
    );

    expect(callbacks).toBe(4096);
    expect(result.emissionCount).toBe(6001);
    expect(result.accumulatedDistance).toBe(3000);
  });
});

describe("timeSpacingMsFromRate", () => {
  it("正のレートを ms 間隔に変換する", () => {
    expect(timeSpacingMsFromRate(40)).toBe(25);
  });

  it("未指定・0以下・非有限は undefined（無効）", () => {
    expect(timeSpacingMsFromRate(undefined)).toBeUndefined();
    expect(timeSpacingMsFromRate(0)).toBeUndefined();
    expect(timeSpacingMsFromRate(-5)).toBeUndefined();
    expect(timeSpacingMsFromRate(Number.NaN)).toBeUndefined();
    expect(timeSpacingMsFromRate(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
