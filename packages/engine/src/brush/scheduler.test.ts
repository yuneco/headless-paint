import { describe, expect, it } from "vitest";
import type { StrokePoint } from "../types";
import { walkEmissions } from "./scheduler";

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
});
