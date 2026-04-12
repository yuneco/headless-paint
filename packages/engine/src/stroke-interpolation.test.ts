import { describe, expect, it } from "vitest";
import { interpolateStrokePointsCentripetal } from "./stroke-interpolation";
import type { StrokePoint } from "./types";

function findAnchorIndex(
  points: readonly StrokePoint[],
  anchor: StrokePoint,
): number {
  return points.findIndex(
    (point) => point.x === anchor.x && point.y === anchor.y,
  );
}

describe("interpolateStrokePointsCentripetal", () => {
  it("tail のみ future-independent にし、途中セグメントは future 点を使う", () => {
    const source: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 40, y: 0, pressure: 0.5 },
      { x: 60, y: 40, pressure: 0.5 },
      { x: 62, y: 120, pressure: 0.5 },
      { x: 20, y: 180, pressure: 0.5 },
    ];

    const defaultInterpolation = interpolateStrokePointsCentripetal(source);
    const tailOnlyInterpolation = interpolateStrokePointsCentripetal(source, {
      futureIndependentTail: true,
    });
    const fullyFutureIndependent = interpolateStrokePointsCentripetal(source, {
      futureIndependentP3: true,
    });

    const firstInteriorAnchorIndex = findAnchorIndex(
      tailOnlyInterpolation,
      source[1],
    );
    expect(firstInteriorAnchorIndex).toBeGreaterThanOrEqual(0);

    const interiorSampleIndex = firstInteriorAnchorIndex + 10;
    const interiorDelta =
      Math.abs(
        tailOnlyInterpolation[interiorSampleIndex].x -
          fullyFutureIndependent[interiorSampleIndex].x,
      ) +
      Math.abs(
        tailOnlyInterpolation[interiorSampleIndex].y -
          fullyFutureIndependent[interiorSampleIndex].y,
      );

    expect(tailOnlyInterpolation[interiorSampleIndex].x).toBeCloseTo(
      defaultInterpolation[interiorSampleIndex].x,
      6,
    );
    expect(tailOnlyInterpolation[interiorSampleIndex].y).toBeCloseTo(
      defaultInterpolation[interiorSampleIndex].y,
      6,
    );
    expect(interiorDelta).toBeGreaterThan(0.5);

    const tailAnchorIndex = findAnchorIndex(tailOnlyInterpolation, source[3]);
    expect(tailAnchorIndex).toBeGreaterThanOrEqual(0);

    const tailSampleIndex = tailAnchorIndex + 10;
    expect(tailOnlyInterpolation[tailSampleIndex].x).toBeCloseTo(
      fullyFutureIndependent[tailSampleIndex].x,
      6,
    );
    expect(tailOnlyInterpolation[tailSampleIndex].y).toBeCloseTo(
      fullyFutureIndependent[tailSampleIndex].y,
      6,
    );
  });
});
