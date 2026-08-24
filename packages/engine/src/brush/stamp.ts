import { calculateRadius } from "../draw";
import { interpolateStrokePointsCentripetal } from "../stroke-interpolation";
import type {
  BrushDynamics,
  BrushMixing,
  BrushMixingState,
  BrushRenderState,
  Layer,
  StampBrushConfig,
  StrokePoint,
  StrokeStyle,
} from "../types";
import {
  getActiveMixing,
  prepareMixingState,
  updateMixingAfterDeposit,
} from "./mixing";
import { brushPerfDebug } from "./perf-debug";
import { calculatePressureFlow } from "./pressure";
import { smoothStampPressure } from "./pressure-smoothing";
import { hashSeed, mulberry32 } from "./prng";
import {
  type EmissionPoint,
  timeSpacingMsFromRate,
  walkEmissions,
} from "./scheduler";

/**
 * スタンプ用の補間。
 * ストローク末尾だけ future 点の有無に依存しないよう、tail のみ p3 を外挿する。
 * 途中セグメントは実際の future 点を使うことで、曲率を滑らかに分配する。
 */
function interpolateStampStrokePoints(
  points: readonly StrokePoint[],
  overlapCount = 0,
): StrokePoint[] {
  return interpolateStrokePointsCentripetal(points, {
    overlapCount,
    futureIndependentTail: true,
  });
}

export function renderStampBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  brush: StampBrushConfig,
  state: BrushRenderState,
  overlapCount: number,
  sourceLayer: Layer,
): BrushRenderState {
  const { dynamics } = brush;
  const spacingPx = style.lineWidth * dynamics.spacing;
  const branch = state.branches[0];

  if (spacingPx <= 0 || !state.tipCanvas || points.length === 0 || !branch) {
    return state;
  }

  const interpolated = interpolateStampStrokePoints(points, overlapCount);
  if (interpolated.length === 0) return state;

  const mixing = getActiveMixing(brush.mixing);
  let mixingState = branch.mixing;
  let pressureState = branch.pressure;

  const nextBranch = walkEmissions(
    interpolated,
    spacingPx,
    branch,
    overlapCount,
    (emission) => {
      const smoothed = smoothStampPressure(
        emission.pressure,
        emission.timestamp,
        brush.pressureDynamics.smoothingMs,
        pressureState,
      );
      pressureState = smoothed.state;
      const result = stampAt(
        layer,
        state.tipCanvas as OffscreenCanvas,
        { ...emission, pressure: smoothed.value },
        style,
        dynamics,
        brush.pressureDynamics.size,
        brush.pressureDynamics.flow,
        state.seed,
        emission.emissionIndex,
        sourceLayer,
        mixing,
        mixingState,
      );
      mixingState = result.mixing;
    },
    timeSpacingMsFromRate(dynamics.emissionsPerSecond),
    dynamics.spacingSizeCoupling > 0
      ? (point) =>
          calculateAdaptiveSpacing(
            point,
            spacingPx,
            style,
            brush.pressureDynamics.size,
            dynamics.spacingSizeCoupling,
          )
      : undefined,
  );

  return {
    tipCanvas: state.tipCanvas,
    seed: state.seed,
    branches: [
      {
        accumulatedDistance: nextBranch.accumulatedDistance,
        emissionCount: nextBranch.emissionCount,
        distanceEmissionProgress: nextBranch.distanceEmissionProgress,
        lastTimestamp: nextBranch.lastTimestamp,
        nextTimeEmissionAt: nextBranch.nextTimeEmissionAt,
        pressure: pressureState,
        mixing: mixingState,
      },
    ],
  };
}

function calculateAdaptiveSpacing(
  point: StrokePoint,
  baseSpacingPx: number,
  style: StrokeStyle,
  pressureSize: number,
  coupling: number,
): number {
  const effectiveDiameter =
    calculateRadius(
      point.pressure,
      style.lineWidth,
      pressureSize,
      style.pressureCurve,
    ) * 2;
  const sizeScale = effectiveDiameter / style.lineWidth;
  const clampedCoupling = Math.min(1, Math.max(0, coupling));
  return baseSpacingPx * (1 + (sizeScale - 1) * clampedCoupling);
}

interface StampAtResult {
  readonly mixing?: BrushMixingState;
}

function stampAt(
  layer: Layer,
  tipCanvas: OffscreenCanvas,
  point: EmissionPoint,
  style: StrokeStyle,
  dynamics: BrushDynamics,
  pressureSize: number,
  pressureFlowResponse: number,
  seed: number,
  emissionIndex: number,
  sourceLayer: Layer,
  mixing: BrushMixing | null,
  mixingState: BrushMixingState | undefined,
): StampAtResult {
  const localSeed = hashSeed(seed, emissionIndex);
  const rng = mulberry32(localSeed);

  const radius = calculateRadius(
    point.pressure,
    style.lineWidth,
    pressureSize,
    style.pressureCurve,
  );
  const diameter = radius * 2;

  const sizeScale = 1 - dynamics.sizeJitter * rng();
  const stampSize = diameter * sizeScale;
  if (stampSize <= 0) {
    return { mixing: mixingState };
  }

  const pressureFlow = calculatePressureFlow(
    point.pressure,
    dynamics.flow,
    pressureFlowResponse,
    style.pressureCurve,
  );
  const opacity = pressureFlow * (1 - dynamics.opacityJitter * rng());
  if (opacity <= 0) {
    return { mixing: mixingState };
  }

  const rotationJitter = dynamics.rotationJitter * (rng() * 2 - 1);
  const scatterRange = dynamics.scatter * diameter;
  const scatterX = scatterRange * (rng() * 2 - 1);
  const scatterY = scatterRange * (rng() * 2 - 1);

  const x = point.x + scatterX;
  const y = point.y + scatterY;

  const ctx = layer.ctx;
  const dabDrawStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = style.compositeOperation;

  let drawCanvas = tipCanvas;
  let nextMixingState = mixingState;
  let rotation = rotationJitter;
  if (mixing) {
    nextMixingState = prepareMixingState(
      tipCanvas,
      style.color,
      mixing,
      mixingState,
    );
    drawCanvas = nextMixingState.renderCanvas;
    rotation += Math.atan2(point.directionY, point.directionX);
  }

  if (rotation !== 0) {
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.drawImage(
      drawCanvas,
      -stampSize / 2,
      -stampSize / 2,
      stampSize,
      stampSize,
    );
  } else {
    ctx.drawImage(
      drawCanvas,
      x - stampSize / 2,
      y - stampSize / 2,
      stampSize,
      stampSize,
    );
  }

  ctx.restore();
  if (brushPerfDebug.enabled) {
    brushPerfDebug.recordStage("dabDraw", dabDrawStartedAt);
  }
  if (mixing && nextMixingState) {
    nextMixingState = updateMixingAfterDeposit({
      tipCanvas,
      baseColor: style.color,
      x,
      y,
      directionX: point.directionX,
      directionY: point.directionY,
      stampSize,
      checkpointFootprintSize: Math.max(style.lineWidth, stampSize),
      stampDistance: point.distance,
      sourceLayer,
      targetLayer: layer,
      mixing,
      state: nextMixingState,
    });
  }
  return {
    mixing: nextMixingState,
  };
}
