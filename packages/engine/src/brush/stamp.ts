import { calculateRadius } from "../draw";
import { interpolateStrokePointsCentripetal } from "../stroke-interpolation";
import type {
  BrushDynamics,
  BrushMixing,
  BrushRenderState,
  Layer,
  StampBrushConfig,
  StrokePoint,
  StrokeStyle,
} from "../types";
import {
  getActiveMixing,
  getMixingUpdateSpacing,
  renderMixedTip,
  shouldUpdateMixedTip,
} from "./mixing";
import { calculatePressureFlow } from "./pressure";
import { hashSeed, mulberry32 } from "./prng";
import { walkEmissions } from "./scheduler";

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

  const ctx = layer.ctx;
  const mixing = getActiveMixing(brush.mixing);
  let colorBuffer = branch.mixing?.colorBuffer;
  let mixedCanvas = branch.mixing?.mixedCanvas;
  let lastMixingUpdateDistance = branch.mixing?.lastMixingUpdateDistance;
  const mixingUpdateSpacing = mixing
    ? getMixingUpdateSpacing(spacingPx, mixing)
    : spacingPx;

  const nextBranch = walkEmissions(
    interpolated,
    spacingPx,
    branch,
    overlapCount,
    (emission) => {
      const result = stampAt(
        ctx,
        state.tipCanvas as OffscreenCanvas,
        emission,
        style,
        dynamics,
        state.seed,
        emission.emissionIndex,
        sourceLayer,
        mixing,
        colorBuffer,
        mixedCanvas,
        emission.distance,
        lastMixingUpdateDistance,
        mixingUpdateSpacing,
      );
      colorBuffer = result.colorBuffer;
      mixedCanvas = result.mixedCanvas;
      lastMixingUpdateDistance = result.lastMixingUpdateDistance;
    },
  );

  return {
    tipCanvas: state.tipCanvas,
    seed: state.seed,
    branches: [
      {
        accumulatedDistance: nextBranch.accumulatedDistance,
        emissionCount: nextBranch.emissionCount,
        mixing:
          colorBuffer || mixedCanvas || lastMixingUpdateDistance !== undefined
            ? {
                colorBuffer,
                mixedCanvas,
                lastMixingUpdateDistance,
              }
            : undefined,
      },
    ],
  };
}

interface StampAtResult {
  readonly colorBuffer?: OffscreenCanvas;
  readonly mixedCanvas?: OffscreenCanvas;
  readonly lastMixingUpdateDistance?: number;
}

function stampAt(
  ctx: OffscreenCanvasRenderingContext2D,
  tipCanvas: OffscreenCanvas,
  point: StrokePoint,
  style: StrokeStyle,
  dynamics: BrushDynamics,
  seed: number,
  emissionIndex: number,
  sourceLayer: Layer,
  mixing: BrushMixing | null,
  colorBuffer: OffscreenCanvas | undefined,
  mixedCanvas: OffscreenCanvas | undefined,
  stampDistance: number,
  lastMixingUpdateDistance: number | undefined,
  mixingUpdateSpacing: number,
): StampAtResult {
  const localSeed = hashSeed(seed, emissionIndex);
  const rng = mulberry32(localSeed);

  const radius = calculateRadius(
    point.pressure,
    style.lineWidth,
    style.brush.pressureDynamics.size,
    style.pressureCurve,
  );
  const diameter = radius * 2;

  const sizeScale = 1 - dynamics.sizeJitter * rng();
  const stampSize = diameter * sizeScale;
  if (stampSize <= 0) {
    return { colorBuffer, mixedCanvas, lastMixingUpdateDistance };
  }

  const pressureFlow = calculatePressureFlow(
    point.pressure,
    dynamics.flow,
    style.brush.pressureDynamics.flow,
    style.pressureCurve,
  );
  const opacity = pressureFlow * (1 - dynamics.opacityJitter * rng());
  if (opacity <= 0) {
    return { colorBuffer, mixedCanvas, lastMixingUpdateDistance };
  }

  const rotation = dynamics.rotationJitter * (rng() * 2 - 1);
  const scatterRange = dynamics.scatter * diameter;
  const scatterX = scatterRange * (rng() * 2 - 1);
  const scatterY = scatterRange * (rng() * 2 - 1);

  const x = point.x + scatterX;
  const y = point.y + scatterY;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = style.compositeOperation;

  let drawCanvas = tipCanvas;
  let nextColorBuffer = colorBuffer;
  let nextMixedCanvas = mixedCanvas;
  let nextLastMixingUpdateDistance = lastMixingUpdateDistance;
  if (mixing) {
    const shouldUpdate = shouldUpdateMixedTip(
      colorBuffer,
      mixedCanvas,
      stampDistance,
      lastMixingUpdateDistance,
      mixingUpdateSpacing,
    );
    if (shouldUpdate) {
      const mixed = renderMixedTip(
        tipCanvas,
        style.color,
        x,
        y,
        stampSize,
        sourceLayer,
        mixing,
        colorBuffer,
        mixedCanvas,
      );
      drawCanvas = mixed.canvas;
      nextColorBuffer = mixed.colorBuffer;
      nextMixedCanvas = mixed.mixedCanvas;
      nextLastMixingUpdateDistance = stampDistance;
    } else {
      drawCanvas = mixedCanvas ?? tipCanvas;
    }
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
  return {
    colorBuffer: nextColorBuffer,
    mixedCanvas: nextMixedCanvas,
    lastMixingUpdateDistance: nextLastMixingUpdateDistance,
  };
}
