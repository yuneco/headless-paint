import type { StrokePoint } from "./types";

const MIN_INTERPOLATION_DISTANCE = 2;
const PARAM_EPSILON = 1e-4;
const CENTRIPETAL_ALPHA = 0.5;
const DEFAULT_PRESSURE = 0.5;

function extrapolatePrevious(p1: StrokePoint, p2: StrokePoint): StrokePoint {
  return {
    x: p1.x - (p2.x - p1.x),
    y: p1.y - (p2.y - p1.y),
    pressure:
      (p1.pressure ?? DEFAULT_PRESSURE) -
      ((p2.pressure ?? DEFAULT_PRESSURE) - (p1.pressure ?? DEFAULT_PRESSURE)),
  };
}

function extrapolateNext(p1: StrokePoint, p2: StrokePoint): StrokePoint {
  return {
    x: p2.x + (p2.x - p1.x),
    y: p2.y + (p2.y - p1.y),
    pressure:
      (p2.pressure ?? DEFAULT_PRESSURE) +
      ((p2.pressure ?? DEFAULT_PRESSURE) - (p1.pressure ?? DEFAULT_PRESSURE)),
  };
}

function pointDistance(a: StrokePoint, b: StrokePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPoint(a: StrokePoint, b: StrokePoint, t: number): StrokePoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure:
      (a.pressure ?? DEFAULT_PRESSURE) +
      ((b.pressure ?? DEFAULT_PRESSURE) - (a.pressure ?? DEFAULT_PRESSURE)) * t,
  };
}

function safeParamStep(a: StrokePoint, b: StrokePoint): number {
  return Math.max(pointDistance(a, b) ** CENTRIPETAL_ALPHA, PARAM_EPSILON);
}

function interpolateSegment(
  p0: StrokePoint,
  p1: StrokePoint,
  p2: StrokePoint,
  p3: StrokePoint,
  t: number,
): StrokePoint {
  const t0 = 0;
  const t1 = t0 + safeParamStep(p0, p1);
  const t2 = t1 + safeParamStep(p1, p2);
  const t3 = t2 + safeParamStep(p2, p3);
  const target = t1 + (t2 - t1) * t;

  const a1 = lerpPoint(p0, p1, (target - t0) / (t1 - t0));
  const a2 = lerpPoint(p1, p2, (target - t1) / (t2 - t1));
  const a3 = lerpPoint(p2, p3, (target - t2) / (t3 - t2));

  const b1 = lerpPoint(a1, a2, (target - t0) / (t2 - t0));
  const b2 = lerpPoint(a2, a3, (target - t1) / (t3 - t1));

  const point = lerpPoint(b1, b2, (target - t1) / (t2 - t1));

  return {
    x: point.x,
    y: point.y,
    pressure:
      (p1.pressure ?? DEFAULT_PRESSURE) +
      ((p2.pressure ?? DEFAULT_PRESSURE) - (p1.pressure ?? DEFAULT_PRESSURE)) *
        t,
  };
}

interface InterpolationOptions {
  readonly overlapCount?: number;
  readonly futureIndependentTail?: boolean;
  readonly futureIndependentP3?: boolean;
}

export function interpolateStrokePointsCentripetal(
  points: readonly StrokePoint[],
  options: InterpolationOptions = {},
): StrokePoint[] {
  const {
    overlapCount = 0,
    futureIndependentTail = false,
    futureIndependentP3 = false,
  } = options;

  if (points.length < 2) {
    return points.map((point) => ({ ...point }));
  }

  const skipSegments = Math.max(0, overlapCount - 1);
  const result: StrokePoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[Math.min(points.length - 1, i + 1)];
    const p0 =
      i > 0 ? points[i - 1] : extrapolatePrevious(points[0], points[1]);
    const p3 = futureIndependentP3
      ? extrapolateNext(p1, p2)
      : i + 2 < points.length
        ? points[i + 2]
        : futureIndependentTail
          ? extrapolateNext(p1, p2)
          : extrapolateNext(
              points[points.length - 2],
              points[points.length - 1],
            );

    if (i >= skipSegments) {
      result.push({ x: p1.x, y: p1.y, pressure: p1.pressure });
    }

    if (i < points.length - 1 && i >= skipSegments) {
      const dist = pointDistance(p1, p2);
      const segments = Math.max(
        1,
        Math.ceil(dist / MIN_INTERPOLATION_DISTANCE),
      );

      for (let j = 1; j < segments; j++) {
        result.push(interpolateSegment(p0, p1, p2, p3, j / segments));
      }
    }
  }

  return result;
}
