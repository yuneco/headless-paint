import type { DensityProfileCurve } from "../types";

const LUT_SIZE = 128;
const INTEGRATION_STEPS = 512;
const BEZIER_SOLVE_ITERATIONS = 14;
const MAX_CACHE_ENTRIES = 32;

const lutCache = new Map<string, readonly number[]>();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cubicBezier(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
}

function curveKey(curve: DensityProfileCurve): string {
  return [
    curve.startY,
    curve.control1.x,
    curve.control1.y,
    curve.control2.x,
    curve.control2.y,
    curve.endY,
  ].join(",");
}

function evaluateDensityAt(x: number, curve: DensityProfileCurve): number {
  const c1x = clamp01(curve.control1.x);
  const c2x = clamp01(curve.control2.x);
  const targetX = clamp01(x);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BEZIER_SOLVE_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const bezierX = cubicBezier(mid, 0, c1x, c2x, 1);
    if (bezierX < targetX) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const t = (lo + hi) / 2;
  const y = cubicBezier(
    t,
    clamp01(curve.startY),
    clamp01(curve.control1.y),
    clamp01(curve.control2.y),
    clamp01(curve.endY),
  );
  return Math.max(0, y);
}

function buildInverseCdfLut(curve: DensityProfileCurve): readonly number[] {
  const xs = new Array<number>(INTEGRATION_STEPS + 1);
  const cdf = new Array<number>(INTEGRATION_STEPS + 1);
  const pdf = new Array<number>(INTEGRATION_STEPS + 1);

  for (let i = 0; i <= INTEGRATION_STEPS; i++) {
    const x = i / INTEGRATION_STEPS;
    xs[i] = x;
    pdf[i] = evaluateDensityAt(x, curve) * x;
  }

  cdf[0] = 0;
  for (let i = 1; i <= INTEGRATION_STEPS; i++) {
    const dx = xs[i] - xs[i - 1];
    cdf[i] = cdf[i - 1] + ((pdf[i - 1] + pdf[i]) * dx) / 2;
  }

  const total = cdf[INTEGRATION_STEPS];
  if (total <= 0) {
    return Array.from({ length: LUT_SIZE }, (_, i) =>
      Math.sqrt(i / (LUT_SIZE - 1)),
    );
  }

  for (let i = 1; i <= INTEGRATION_STEPS; i++) {
    cdf[i] /= total;
  }

  const lut = new Array<number>(LUT_SIZE);
  let sourceIndex = 1;
  for (let i = 0; i < LUT_SIZE; i++) {
    const target = i / (LUT_SIZE - 1);
    while (sourceIndex < INTEGRATION_STEPS && cdf[sourceIndex] < target) {
      sourceIndex++;
    }
    const previousIndex = Math.max(0, sourceIndex - 1);
    const cdf0 = cdf[previousIndex];
    const cdf1 = cdf[sourceIndex];
    const x0 = xs[previousIndex];
    const x1 = xs[sourceIndex];
    const localT = cdf1 === cdf0 ? 0 : (target - cdf0) / (cdf1 - cdf0);
    lut[i] = x0 + (x1 - x0) * localT;
  }

  return lut;
}

function getInverseCdfLut(curve: DensityProfileCurve): readonly number[] {
  const key = curveKey(curve);
  const cached = lutCache.get(key);
  if (cached) return cached;
  const lut = buildInverseCdfLut(curve);
  if (lutCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = lutCache.keys().next().value;
    if (oldestKey !== undefined) {
      lutCache.delete(oldestKey);
    }
  }
  lutCache.set(key, lut);
  return lut;
}

export function sampleDensityProfileRadius(
  u: number,
  curve: DensityProfileCurve,
): number {
  const lut = getInverseCdfLut(curve);
  const x = clamp01(u) * (LUT_SIZE - 1);
  const index = Math.floor(x);
  const nextIndex = Math.min(LUT_SIZE - 1, index + 1);
  const t = x - index;
  return lut[index] + (lut[nextIndex] - lut[index]) * t;
}
