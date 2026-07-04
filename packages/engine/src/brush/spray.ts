import { calculateRadius, evaluateParametricCurve } from "../draw";
import { interpolateStrokePointsCentripetal } from "../stroke-interpolation";
import type {
  BrushRenderState,
  Layer,
  SprayBrushConfig,
  StrokePoint,
  StrokeStyle,
} from "../types";
import { SPRAY_MAX_PARTICLES_PER_EMISSION } from "../types";
import { sampleDensityProfileRadius } from "./density-curve";
import { calculatePressureFlow } from "./pressure";
import { hashSeed, mulberry32 } from "./prng";
import { timeSpacingMsFromRate, walkEmissions } from "./scheduler";

const TWO_PI = Math.PI * 2;

function interpolateSprayStrokePoints(
  points: readonly StrokePoint[],
  overlapCount = 0,
): StrokePoint[] {
  return interpolateStrokePointsCentripetal(points, {
    overlapCount,
    futureIndependentTail: true,
  });
}

function calculateParticleSize(
  baseSize: number,
  jitter: number,
  mode: SprayBrushConfig["dynamics"]["sizeJitterMode"],
  u1: number,
  u2: number,
  u3: number,
): number {
  switch (mode) {
    case "lognormal": {
      const sigma = 2 * jitter;
      const gaussian = u1 + u2 + u3 - 1.5;
      const scale = Math.max(0.25, Math.min(4, 2 ** (sigma * gaussian)));
      return baseSize * scale;
    }
    case "bimodal": {
      const p = 0.7 * jitter;
      if (u1 < p) {
        return baseSize * (0.2 + 0.3 * u2);
      }
      return baseSize;
    }
  }
}

export function renderSprayBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  brush: SprayBrushConfig,
  state: BrushRenderState,
  overlapCount: number,
): BrushRenderState {
  const { dynamics } = brush;
  const spacingPx = style.lineWidth * dynamics.spacing;
  const branch = state.branches[0];

  if (spacingPx <= 0 || !state.tipCanvas || points.length === 0 || !branch) {
    return state;
  }

  const interpolated = interpolateSprayStrokePoints(points, overlapCount);
  if (interpolated.length === 0) return state;

  const ctx = layer.ctx;
  const previousAlpha = ctx.globalAlpha;
  const previousCompositeOperation = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = style.compositeOperation;

  const nextBranch = walkEmissions(
    interpolated,
    spacingPx,
    branch,
    overlapCount,
    (emission) => {
      sprayAt(
        ctx,
        state.tipCanvas as OffscreenCanvas,
        emission,
        style,
        brush,
        state.seed,
        emission.emissionIndex,
      );
    },
    timeSpacingMsFromRate(dynamics.emissionsPerSecond),
  );

  ctx.globalAlpha = previousAlpha;
  ctx.globalCompositeOperation = previousCompositeOperation;

  return {
    tipCanvas: state.tipCanvas,
    seed: state.seed,
    branches: [
      {
        accumulatedDistance: nextBranch.accumulatedDistance,
        emissionCount: nextBranch.emissionCount,
        lastTimestamp: nextBranch.lastTimestamp,
        nextTimeEmissionAt: nextBranch.nextTimeEmissionAt,
      },
    ],
  };
}

function sprayAt(
  ctx: OffscreenCanvasRenderingContext2D,
  tipCanvas: OffscreenCanvas,
  point: StrokePoint,
  style: StrokeStyle,
  brush: SprayBrushConfig,
  seed: number,
  emissionIndex: number,
): void {
  const { dynamics, pressureDynamics } = brush;
  const radius = calculateRadius(
    point.pressure,
    style.lineWidth,
    pressureDynamics.size,
    style.pressureCurve,
  );
  if (radius <= 0 || dynamics.density <= 0 || dynamics.particleSize <= 0) {
    return;
  }

  const rng = mulberry32(hashSeed(seed, emissionIndex));
  const baseCount = (dynamics.density * Math.PI * radius * radius) / 1000;
  const pressureValue = evaluateParametricCurve(
    point.pressure ?? 0.5,
    style.pressureCurve,
  );
  const densityScale =
    1 * (1 - pressureDynamics.density) +
    pressureValue * pressureDynamics.density;
  const particleCountFloat = baseCount * densityScale;
  const wholeCount = Math.floor(particleCountFloat);
  const fractionalCount = particleCountFloat - wholeCount;
  const roundedCount = wholeCount + (rng() < fractionalCount ? 1 : 0);
  const particleCount = Math.min(
    SPRAY_MAX_PARTICLES_PER_EMISSION,
    roundedCount,
  );
  if (particleCount <= 0) return;

  const pressureFlow = calculatePressureFlow(
    point.pressure,
    dynamics.flow,
    pressureDynamics.flow,
    style.pressureCurve,
  );

  for (let i = 0; i < particleCount; i++) {
    const u = rng();
    const v = rng();
    const sizeU1 = rng();
    const sizeU2 = rng();
    const sizeU3 = rng();
    const z = rng();
    const r =
      radius * sampleDensityProfileRadius(u, dynamics.radialDistribution);
    const theta = TWO_PI * v;
    const particleSize = calculateParticleSize(
      dynamics.particleSize,
      dynamics.particleSizeJitter,
      dynamics.sizeJitterMode,
      sizeU1,
      sizeU2,
      sizeU3,
    );
    const opacity = pressureFlow * (1 - dynamics.opacityJitter * z);

    if (particleSize <= 0 || opacity <= 0) continue;

    const x = point.x + Math.cos(theta) * r;
    const y = point.y + Math.sin(theta) * r;
    ctx.globalAlpha = opacity;
    ctx.drawImage(
      tipCanvas,
      x - particleSize / 2,
      y - particleSize / 2,
      particleSize,
      particleSize,
    );
  }
}
