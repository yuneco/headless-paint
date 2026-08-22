import { colorToStyle } from "../layer";
import { interpolateStrokePointsCentripetal } from "../stroke-interpolation";
import type {
  BristleBranchRenderState,
  BristleBrushConfig,
  BristleSweepPointState,
  BrushMixing,
  BrushMixingState,
  BrushRenderState,
  Layer,
  StrokePoint,
  StrokeStyle,
} from "../types";
import { applyDocumentGrain, createBristleMaskAtlas } from "./bristle-mask";
import { getBristleProfileAtlas } from "./bristle-profile";
import {
  getActiveMixing,
  prepareMixingState,
  updateMixingAfterDeposit,
} from "./mixing";
import { type EmissionPoint, walkEmissions } from "./scheduler";

interface ResolvedSweepPoint extends BristleSweepPointState {
  readonly breakBefore: boolean;
}

interface BristleRenderResult {
  readonly mixing?: BrushMixingState;
}

export function renderBristleBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  brush: BristleBrushConfig,
  state: BrushRenderState,
  overlapCount: number,
  sourceLayer: Layer,
): BrushRenderState {
  const branch = state.branches[0];
  if (!branch || points.length === 0 || style.lineWidth <= 0) return state;

  const interpolated = interpolateStrokePointsCentripetal(points, {
    overlapCount,
    futureIndependentTail: true,
  });
  if (interpolated.length === 0) return state;

  const emissions: EmissionPoint[] = [];
  const nextScheduler = walkEmissions(
    interpolated,
    Math.max(0.5, brush.dynamics.geometryStepPx),
    branch,
    overlapCount,
    (point) => emissions.push(point),
  );
  if (emissions.length === 0) {
    return {
      tipCanvas: state.tipCanvas,
      seed: state.seed,
      branches: [
        {
          ...branch,
          accumulatedDistance: nextScheduler.accumulatedDistance,
          emissionCount: nextScheduler.emissionCount,
        },
      ],
    };
  }

  const resolved = resolveSweepPoints(
    emissions,
    branch.bristle,
    style.lineWidth,
    brush,
  );
  const profile = getBristleProfileAtlas(
    style.lineWidth,
    brush.dynamics,
    state.seed,
  );
  const mixing = getActiveMixing(brush.mixing);
  let mixingState = mixing
    ? prepareMixingState(profile, style.color, mixing, branch.mixing)
    : undefined;
  const renderResult = renderRuns(
    layer,
    resolved.points,
    style,
    brush,
    profile,
    state.seed,
    sourceLayer,
    mixing,
    mixingState,
  );
  mixingState = renderResult.mixing;

  return {
    tipCanvas: state.tipCanvas,
    seed: state.seed,
    branches: [
      {
        accumulatedDistance: nextScheduler.accumulatedDistance,
        emissionCount: nextScheduler.emissionCount,
        distanceEmissionProgress: nextScheduler.distanceEmissionProgress,
        lastTimestamp: nextScheduler.lastTimestamp,
        nextTimeEmissionAt: nextScheduler.nextTimeEmissionAt,
        mixing: mixingState,
        bristle: resolved.state,
      },
    ],
  };
}

function resolveSweepPoints(
  emissions: readonly EmissionPoint[],
  previous: BristleBranchRenderState | undefined,
  brushSize: number,
  brush: BristleBrushConfig,
): {
  readonly points: readonly ResolvedSweepPoint[];
  readonly state: BristleBranchRenderState;
} {
  const points: ResolvedSweepPoint[] = [];
  if (previous?.lastSweepPoint) {
    points.push({
      ...previous.lastSweepPoint,
      breakBefore: false,
    });
  }

  let incomingX = previous?.incomingDirectionX;
  let incomingY = previous?.incomingDirectionY;
  let frameSign: 1 | -1 = previous?.frameSign ?? 1;
  let lag = previous?.lag;
  const spanPx = Math.max(
    brush.dynamics.geometryStepPx,
    brushSize * brush.dynamics.cuspDetectionSpanRatio,
  );
  const smoothFactor = Math.min(
    1,
    Math.max(0.02, brush.dynamics.geometryStepPx / spanPx),
  );
  const threshold = Math.max(
    0,
    Math.min(180, brush.dynamics.cuspAngleThresholdDeg),
  );

  for (const emission of emissions) {
    const pressure = Math.max(0, Math.min(1, emission.pressure ?? 0.5));
    let frameX = emission.directionX * frameSign;
    let frameY = emission.directionY * frameSign;
    if (incomingX !== undefined && incomingY !== undefined) {
      const dot = clamp(
        incomingX * emission.directionX + incomingY * emission.directionY,
        -1,
        1,
      );
      const angleDeg = (Math.acos(dot) * 180) / Math.PI;
      if (angleDeg >= threshold) {
        const incomingFrameX = incomingX * frameSign;
        const incomingFrameY = incomingY * frameSign;
        points.push({
          x: emission.x,
          y: emission.y,
          pressure,
          directionX: emission.directionX,
          directionY: emission.directionY,
          frameX: incomingFrameX,
          frameY: incomingFrameY,
          distance: emission.distance,
          breakBefore: false,
        });
        const directDot =
          incomingFrameX * emission.directionX +
          incomingFrameY * emission.directionY;
        frameSign = directDot >= 0 ? 1 : -1;
        frameX = incomingFrameX;
        frameY = incomingFrameY;
        lag = {
          startDistance: emission.distance,
          fromAngle: Math.atan2(incomingFrameY, incomingFrameX),
        };
        incomingX = emission.directionX;
        incomingY = emission.directionY;
      } else {
        const next = normalize(
          incomingX + (emission.directionX - incomingX) * smoothFactor,
          incomingY + (emission.directionY - incomingY) * smoothFactor,
        );
        incomingX = next.x;
        incomingY = next.y;
      }
    } else {
      incomingX = emission.directionX;
      incomingY = emission.directionY;
    }
    if (lag) {
      const lagLength = Math.max(
        1,
        brushSize * Math.max(0, brush.dynamics.lagLengthRatio),
      );
      const progress = clamp(
        (emission.distance - lag.startDistance) / lagLength,
        0,
        1,
      );
      const targetAngle = Math.atan2(
        emission.directionY * frameSign,
        emission.directionX * frameSign,
      );
      const angle =
        lag.fromAngle +
        shortestAngleDelta(lag.fromAngle, targetAngle) * smoothstep(progress);
      frameX = Math.cos(angle);
      frameY = Math.sin(angle);
      if (progress >= 1) lag = undefined;
    }
    points.push({
      x: emission.x,
      y: emission.y,
      pressure,
      directionX: emission.directionX,
      directionY: emission.directionY,
      frameX,
      frameY,
      distance: emission.distance,
      breakBefore: points.at(-1)?.distance === emission.distance,
    });
  }

  const last = points.at(-1);
  const state: BristleBranchRenderState = {
    lastSweepPoint: last
      ? {
          x: last.x,
          y: last.y,
          pressure: last.pressure,
          directionX: last.directionX,
          directionY: last.directionY,
          frameX: last.frameX,
          frameY: last.frameY,
          distance: last.distance,
        }
      : previous?.lastSweepPoint,
    incomingDirectionX: incomingX,
    incomingDirectionY: incomingY,
    frameSign,
    lag,
  };
  return { points, state };
}

function renderRuns(
  layer: Layer,
  points: readonly ResolvedSweepPoint[],
  style: StrokeStyle,
  brush: BristleBrushConfig,
  profile: OffscreenCanvas,
  seed: number,
  sourceLayer: Layer,
  mixing: BrushMixing | null,
  initialMixingState: BrushMixingState | undefined,
): BristleRenderResult {
  if (points.length < 2) {
    return { mixing: initialMixingState };
  }

  let mixingState = initialMixingState;
  let runStart = 0;
  let nextUpdateDistance = mixing
    ? (mixingState?.lastUpdateDistance ?? 0) + mixing.updateDistancePx
    : Number.POSITIVE_INFINITY;

  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    if (!point || point.distance + 0.0001 < nextUpdateDistance) continue;
    renderSweepRun(
      layer,
      points.slice(runStart, index + 1),
      style,
      brush,
      mixingState?.renderCanvas ?? profile,
      seed,
      !!mixing,
    );
    if (mixing && mixingState) {
      mixingState = updateMixingAfterDeposit({
        tipCanvas: profile,
        baseColor: style.color,
        x: point.x,
        y: point.y,
        directionX: point.directionX,
        directionY: point.directionY,
        stampSize: style.lineWidth,
        checkpointFootprintSize: style.lineWidth,
        stampDistance: point.distance,
        sourceLayer,
        targetLayer: layer,
        mixing,
        state: mixingState,
      });
      nextUpdateDistance =
        (mixingState.lastUpdateDistance ?? point.distance) +
        mixing.updateDistancePx;
    }
    runStart = index;
  }

  if (runStart < points.length - 1) {
    renderSweepRun(
      layer,
      points.slice(runStart),
      style,
      brush,
      mixingState?.renderCanvas ?? profile,
      seed,
      !!mixing,
    );
  }
  return { mixing: mixingState };
}

function renderSweepRun(
  layer: Layer,
  points: readonly ResolvedSweepPoint[],
  style: StrokeStyle,
  brush: BristleBrushConfig,
  paintProfile: OffscreenCanvas,
  seed: number,
  coloredProfile: boolean,
): void {
  if (points.length < 2) return;
  const margin = style.lineWidth / 2 + 4;
  const bounds = resolvePointBounds(points);
  const minX = Math.floor(bounds.minX - margin);
  const minY = Math.floor(bounds.minY - margin);
  const maxX = Math.ceil(bounds.maxX + margin);
  const maxY = Math.ceil(bounds.maxY + margin);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const ink = new OffscreenCanvas(width, height);
  const inkCtx = ink.getContext("2d");
  const mask = new OffscreenCanvas(width, height);
  const maskCtx = mask.getContext("2d");
  if (!inkCtx || !maskCtx) throw new Error("Bristle sweep requires Canvas2D");

  const maskAtlas = createBristleMaskAtlas(
    points,
    style.lineWidth,
    brush.dynamics,
    brush.pressureDynamics.coverage,
    seed,
  );
  drawSweep(inkCtx, paintProfile, points, style.lineWidth, minX, minY, false);
  if (!coloredProfile) {
    inkCtx.globalCompositeOperation = "source-in";
    inkCtx.fillStyle = colorToStyle(style.color);
    inkCtx.fillRect(0, 0, width, height);
    inkCtx.globalCompositeOperation = "source-over";
  }
  drawSweep(maskCtx, maskAtlas, points, style.lineWidth, minX, minY, true);
  applyDocumentGrain(
    maskCtx,
    minX,
    minY,
    width,
    height,
    brush.dynamics,
    averagePressure(points),
  );
  inkCtx.globalCompositeOperation = "destination-in";
  inkCtx.drawImage(mask, 0, 0);
  inkCtx.globalCompositeOperation = "source-over";

  layer.ctx.save();
  layer.ctx.globalAlpha = 1;
  layer.ctx.globalCompositeOperation = style.compositeOperation;
  layer.ctx.drawImage(ink, minX, minY);
  layer.ctx.restore();
}

function averagePressure(points: readonly ResolvedSweepPoint[]): number {
  let total = 0;
  for (const point of points) total += point.pressure;
  return points.length > 0 ? total / points.length : 0;
}

function resolvePointBounds(points: readonly ResolvedSweepPoint[]): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function drawSweep(
  ctx: OffscreenCanvasRenderingContext2D,
  atlas: OffscreenCanvas,
  points: readonly ResolvedSweepPoint[],
  brushSize: number,
  originX: number,
  originY: number,
  atlasIsMask: boolean,
): void {
  ctx.imageSmoothingEnabled = true;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    if (to.breakBefore) continue;
    const pathX = dx / length;
    const pathY = dy / length;
    const sampledFrame = normalize(
      from.frameX + to.frameX,
      from.frameY + to.frameY,
    );
    const alignment = pathX * sampledFrame.x + pathY * sampledFrame.y;
    const frame =
      Math.abs(alignment) > 0.96
        ? {
            x: pathX * (alignment >= 0 ? 1 : -1),
            y: pathY * (alignment >= 0 ? 1 : -1),
          }
        : sampledFrame;
    const overlap = segmentOverlap(from, to, brushSize);
    ctx.setTransform(
      frame.x,
      frame.y,
      -frame.y,
      frame.x,
      (from.x + to.x) / 2 - originX,
      (from.y + to.y) / 2 - originY,
    );
    if (atlasIsMask) {
      const sourceX = Math.max(0, index - 1);
      const sourceWidth = Math.min(2, atlas.width - sourceX);
      ctx.drawImage(
        atlas,
        sourceX,
        0,
        sourceWidth,
        atlas.height,
        -length / 2 - overlap,
        -brushSize / 2,
        length + overlap * 2,
        brushSize,
      );
    } else {
      ctx.drawImage(
        atlas,
        -length / 2 - overlap,
        -brushSize / 2,
        length + overlap * 2,
        brushSize,
      );
    }
  }
  ctx.resetTransform();
}

function segmentOverlap(
  from: ResolvedSweepPoint,
  to: ResolvedSweepPoint,
  brushSize: number,
): number {
  const dot = clamp(from.frameX * to.frameX + from.frameY * to.frameY, -1, 1);
  const turn = Math.min(1.2, Math.acos(dot));
  const normalOverlap = Math.min(
    brushSize * 0.5,
    Math.max(1, brushSize * 0.04) + brushSize * 0.5 * Math.tan(turn / 2),
  );
  return normalOverlap;
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function normalize(
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  const length = Math.hypot(x, y);
  return length > 0.000001 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

function smoothstep(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
