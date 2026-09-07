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
import { getFineToothHeightTile, rasterizeBristleMask } from "./bristle-mask";
import { getBristleProfileAtlas } from "./bristle-profile";
import {
  type BrushAccelerator,
  getActiveGpuStrokeSurface,
} from "./gpu/accelerator";
import type { GpuSweepSegment } from "./gpu/gpu-stroke-surface";
import {
  type MixingUpdateInput,
  finalizeBristleMixingCheckpoint,
  getActiveMixing,
  prepareBristleMixingFlush,
  prepareBristleMixingInterpolationProfiles,
  prepareInitialMixingCheckpoint,
  prepareMixingState,
  stageBristleMixingCheckpoint,
  updateMixingAfterDeposit,
} from "./mixing";
import { brushPerfDebug, perfSample, perfStage } from "./perf-debug";
import { type EmissionPoint, walkEmissions } from "./scheduler";

interface ResolvedSweepPoint extends BristleSweepPointState {
  readonly breakBefore: boolean;
}

interface BristleRenderResult {
  readonly mixing?: BrushMixingState;
}

interface BristleEndInkCache {
  readonly canvas: OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D;
}

// The render canvas survives immutable mixing-state updates, but is replaced
// when mixing is initialized again. Scratch pixels never become mixing state.
const BRISTLE_END_INK_CACHE = new WeakMap<
  OffscreenCanvas,
  BristleEndInkCache
>();

function prepareEndInk(
  owner: OffscreenCanvas,
  width: number,
  height: number,
): BristleEndInkCache {
  let cached = BRISTLE_END_INK_CACHE.get(owner);
  if (!cached) {
    const canvas = perfStage(
      "canvasAlloc",
      () => new OffscreenCanvas(width, height),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Bristle interpolation requires Canvas2D");
    cached = { canvas, ctx };
    BRISTLE_END_INK_CACHE.set(owner, cached);
  } else {
    const { canvas, ctx } = cached;
    if (width > canvas.width || height > canvas.height) {
      perfStage("canvasAlloc", () => {
        if (width > canvas.width) {
          canvas.width = Math.max(width, canvas.width * 2);
        }
        if (height > canvas.height) {
          canvas.height = Math.max(height, canvas.height * 2);
        }
      });
    } else {
      // drawSweep leaves the transform at identity. Ignore pixels outside the
      // current run; the final copy uses an explicit source rectangle.
      ctx.clearRect(0, 0, width, height);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  return cached;
}

export function renderBristleBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  brush: BristleBrushConfig,
  state: BrushRenderState,
  overlapCount: number,
  sourceLayer: Layer,
  accelerator?: BrushAccelerator | null,
): BrushRenderState {
  const branch = state.branches[0];
  if (!branch || points.length === 0 || style.lineWidth <= 0) return state;
  if (brushPerfDebug.nullStages.nullRender) return state;

  const interpolated = perfStage("interpolate", () =>
    interpolateStrokePointsCentripetal(points, {
      overlapCount,
      futureIndependentTail: true,
    }),
  );
  if (interpolated.length === 0) return state;

  const emissions: EmissionPoint[] = [];
  const nextScheduler = perfStage("walkEmissions", () =>
    walkEmissions(
      interpolated,
      Math.max(0.5, brush.dynamics.geometryStepPx),
      branch,
      overlapCount,
      (point) => emissions.push(point),
    ),
  );
  perfSample("emissions", emissions.length);
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

  const resolved = perfStage("sweepResolve", () =>
    resolveSweepPoints(emissions, branch.bristle, style.lineWidth, brush),
  );
  const profile = getBristleProfileAtlas(
    style.lineWidth,
    brush.dynamics,
    state.seed,
  );
  const mixing = getActiveMixing(brush.mixing);
  let mixingState = mixing
    ? prepareMixingState(
        profile,
        style.color,
        mixing,
        branch.mixing,
        accelerator,
      )
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
    accelerator,
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
  accelerator?: BrushAccelerator | null,
): BristleRenderResult {
  if (points.length < 2) {
    return { mixing: initialMixingState };
  }

  if (mixing && initialMixingState && !getActiveGpuStrokeSurface(accelerator)) {
    return renderCpuMixingRuns(
      layer,
      points,
      style,
      brush,
      profile,
      seed,
      sourceLayer,
      mixing,
      initialMixingState,
    );
  }

  let mixingState = initialMixingState;
  let runStart = 0;
  let nextUpdateDistance = mixing
    ? (mixingState?.lastUpdateDistance ?? 0) + mixing.updateDistancePx
    : Number.POSITIVE_INFINITY;

  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    if (!point || point.distance + 0.0001 < nextUpdateDistance) continue;
    const mixingUpdateInput =
      mixing && mixingState
        ? createMixingUpdateInput(
            point,
            profile,
            style,
            sourceLayer,
            layer,
            mixing,
            mixingState,
          )
        : null;
    if (
      mixingUpdateInput &&
      mixingState &&
      getActiveGpuStrokeSurface(accelerator)
    ) {
      mixingState = prepareInitialMixingCheckpoint(
        mixingUpdateInput,
        mixingState,
        accelerator,
      );
    }
    renderSweepRun(
      layer,
      points.slice(runStart, index + 1),
      style,
      brush,
      mixingState?.renderCanvas ?? profile,
      profile,
      seed,
      !!mixing,
      accelerator,
    );
    if (mixingUpdateInput && mixingState) {
      mixingState = updateMixingAfterDeposit(
        { ...mixingUpdateInput, state: mixingState },
        accelerator,
      );
      nextUpdateDistance =
        (mixingState.lastUpdateDistance ?? point.distance) +
        mixingUpdateInput.mixing.updateDistancePx;
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
      profile,
      seed,
      !!mixing,
      accelerator,
    );
  }
  return { mixing: mixingState };
}

interface CpuMixingSweepRun {
  readonly points: readonly ResolvedSweepPoint[];
  readonly updateInput?: MixingUpdateInput;
}

function renderCpuMixingRuns(
  layer: Layer,
  points: readonly ResolvedSweepPoint[],
  style: StrokeStyle,
  brush: BristleBrushConfig,
  profile: OffscreenCanvas,
  seed: number,
  sourceLayer: Layer,
  mixing: BrushMixing,
  initialMixingState: BrushMixingState,
): BristleRenderResult {
  const runs: CpuMixingSweepRun[] = [];
  const updateInputs: MixingUpdateInput[] = [];
  let runStart = 0;
  let nextUpdateDistance =
    (initialMixingState.lastUpdateDistance ?? 0) + mixing.updateDistancePx;

  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    if (!point || point.distance + 0.0001 < nextUpdateDistance) continue;
    const updateInput = createMixingUpdateInput(
      point,
      profile,
      style,
      sourceLayer,
      layer,
      mixing,
      initialMixingState,
    );
    runs.push({ points: points.slice(runStart, index + 1), updateInput });
    updateInputs.push(updateInput);
    nextUpdateDistance = point.distance + mixing.updateDistancePx;
    runStart = index;
  }
  if (runStart < points.length - 1) {
    runs.push({ points: points.slice(runStart) });
  }

  if (updateInputs.length === 0) {
    for (const run of runs) {
      renderSweepRun(
        layer,
        run.points,
        style,
        brush,
        initialMixingState.renderCanvas,
        profile,
        seed,
        true,
      );
    }
    return { mixing: initialMixingState };
  }

  const flush = prepareBristleMixingFlush(updateInputs, initialMixingState);
  let mixingState = flush.state;
  let updateIndex = 0;
  let mixWeight = 0;
  const runWeights = runs.map((run) => {
    const startWeight = mixWeight;
    const update = run.updateInput ? flush.updates[updateIndex++] : undefined;
    if (update) mixWeight = update.mixWeight;
    return [startWeight, mixWeight] as const;
  });
  const paintProfiles = prepareBristleMixingInterpolationProfiles(
    mixingState,
    profile,
    flush.startField,
    flush.endField,
    runWeights,
  );
  updateIndex = 0;
  let stagedCheckpoint = false;
  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    if (!run) continue;
    const update = run.updateInput ? flush.updates[updateIndex++] : undefined;
    renderSweepRun(
      layer,
      run.points,
      style,
      brush,
      paintProfiles?.canvases[runIndex]?.[0] ?? mixingState.renderCanvas,
      profile,
      seed,
      true,
      undefined,
      paintProfiles?.canvases[runIndex]?.[1],
      mixingState.renderCanvas,
    );
    if (update?.capturesCheckpoint) {
      mixingState = stageBristleMixingCheckpoint(update.input, mixingState);
      stagedCheckpoint = true;
    }
  }
  if (stagedCheckpoint) {
    mixingState = finalizeBristleMixingCheckpoint(mixingState);
  }
  return { mixing: mixingState };
}

function renderSweepRun(
  layer: Layer,
  points: readonly ResolvedSweepPoint[],
  style: StrokeStyle,
  brush: BristleBrushConfig,
  paintProfile: OffscreenCanvas,
  profileAtlas: OffscreenCanvas,
  seed: number,
  coloredProfile: boolean,
  accelerator?: BrushAccelerator | null,
  endPaintProfile?: OffscreenCanvas,
  endInkOwner?: OffscreenCanvas,
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
  perfSample("bboxAreas", width * height);
  const gpuSurface = getActiveGpuStrokeSurface(accelerator);
  if (gpuSurface) {
    const simpleMask = {
      dropoutLengthPx: Math.max(4, brush.dynamics.dropoutLengthPx),
      dropoutWidthPx: Math.max(0.5, brush.dynamics.dropoutWidthPx),
      pressureCoverageResponse: clamp(brush.pressureDynamics.coverage, 0, 1),
    };
    gpuSurface.pushBristleChunk({
      segments: createGpuSweepSegments(points, style.lineWidth, brush),
      simpleMask,
      profileAtlas,
      grain: {
        amount: brushPerfDebug.nullStages.nullContact
          ? 0
          : clamp(brush.dynamics.surfaceGrain.amount, 0, 1),
        softness:
          0.01 + (1 - clamp(brush.dynamics.surfaceGrain.hardness, 0, 1)) * 0.24,
        grainSeed: brush.dynamics.surfaceGrain.seed,
        strokeSeed: seed,
        toothHeights: getFineToothHeightTile(
          brush.dynamics.surfaceGrain.seed,
          brush.dynamics.surfaceGrain.scalePx,
        ),
      },
      bboxRect: { left: minX, top: minY, right: maxX, bottom: maxY },
      brushSize: style.lineWidth,
      depositHardness: brush.dynamics.depositHardness,
      color: style.color,
      useMaterialField: coloredProfile,
    });
    return;
  }
  const ink = perfStage(
    "canvasAlloc",
    () => new OffscreenCanvas(width, height),
  );
  const inkCtx = ink.getContext("2d");
  if (!inkCtx) throw new Error("Bristle sweep requires Canvas2D");

  const mask = rasterizeBristleMask(
    points,
    style.lineWidth,
    brush.dynamics,
    brush.pressureDynamics.coverage,
    seed,
    minX,
    minY,
    width,
    height,
  );
  perfStage("drawSweep", () => {
    if (brushPerfDebug.nullStages.nullDrawSweep) {
      inkCtx.fillStyle = "#000";
      inkCtx.fillRect(0, 0, width, height);
    } else {
      const start = points[0];
      const end = points[points.length - 1];
      if (
        endPaintProfile &&
        endInkOwner &&
        start &&
        end &&
        Math.hypot(end.x - start.x, end.y - start.y) >= 0.001
      ) {
        const { canvas: endInk, ctx: endCtx } = prepareEndInk(
          endInkOwner,
          width,
          height,
        );
        const inkBounds = drawSweep(
          inkCtx,
          paintProfile,
          points,
          style.lineWidth,
          minX,
          minY,
          true,
        );
        drawSweep(endCtx, endPaintProfile, points, style.lineWidth, minX, minY);
        if (!inkBounds) return;
        const gradient = inkCtx.createLinearGradient(
          start.x - minX,
          start.y - minY,
          end.x - minX,
          end.y - minY,
        );
        gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
        gradient.addColorStop(1, "rgba(0, 0, 0, 1)");
        inkCtx.globalCompositeOperation = "destination-out";
        inkCtx.fillStyle = gradient;
        inkCtx.fillRect(
          inkBounds.x,
          inkBounds.y,
          inkBounds.width,
          inkBounds.height,
        );
        endCtx.globalCompositeOperation = "destination-in";
        endCtx.fillStyle = gradient;
        endCtx.fillRect(
          inkBounds.x,
          inkBounds.y,
          inkBounds.width,
          inkBounds.height,
        );
        // Add the complementary premultiplied colors and alphas. Source-over
        // would attenuate ink0 again and create a dip in alpha at mid-run.
        inkCtx.globalCompositeOperation = "lighter";
        inkCtx.drawImage(endInk, 0, 0, width, height, 0, 0, width, height);
      } else {
        drawSweep(
          inkCtx,
          endPaintProfile ?? paintProfile,
          points,
          style.lineWidth,
          minX,
          minY,
        );
      }
    }
  });
  perfStage("composite", () => {
    if (!coloredProfile) {
      inkCtx.globalCompositeOperation = "source-in";
      inkCtx.fillStyle = colorToStyle(style.color);
      inkCtx.fillRect(0, 0, width, height);
    }
    inkCtx.globalCompositeOperation = "destination-in";
    inkCtx.drawImage(mask, 0, 0);
  });

  perfStage("layerDraw", () => {
    layer.ctx.save();
    layer.ctx.globalAlpha = 1;
    layer.ctx.globalCompositeOperation = style.compositeOperation;
    layer.ctx.drawImage(ink, minX, minY);
    layer.ctx.restore();
  });
}

function createMixingUpdateInput(
  point: ResolvedSweepPoint,
  profile: OffscreenCanvas,
  style: StrokeStyle,
  sourceLayer: Layer,
  targetLayer: Layer,
  mixing: BrushMixing,
  state: BrushMixingState,
): MixingUpdateInput {
  return {
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
    targetLayer,
    mixing,
    state,
  };
}

function createGpuSweepSegments(
  points: readonly ResolvedSweepPoint[],
  brushSize: number,
  brush: BristleBrushConfig,
): GpuSweepSegment[] {
  const segments: GpuSweepSegment[] = [];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to || to.breakBefore) continue;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 0.001) continue;
    segments.push({
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      fromFrameX: from.frameX,
      fromFrameY: from.frameY,
      toFrameX: to.frameX,
      toFrameY: to.frameY,
      fromPressure: from.pressure,
      toPressure: to.pressure,
      fromDistance: from.distance,
      toDistance: to.distance,
      overlap: segmentOverlap(from, to, brushSize),
      trialId: Math.round(
        ((from.distance + to.distance) * 0.5) /
          Math.max(0.5, brush.dynamics.geometryStepPx),
      ),
    });
  }
  return segments;
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
  collectBounds = false,
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
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
    const centerX = (from.x + to.x) / 2 - originX;
    const centerY = (from.y + to.y) / 2 - originY;
    if (collectBounds) {
      const halfLength = length / 2 + overlap;
      const halfWidth = brushSize / 2;
      const extentX =
        Math.abs(frame.x) * halfLength + Math.abs(frame.y) * halfWidth;
      const extentY =
        Math.abs(frame.y) * halfLength + Math.abs(frame.x) * halfWidth;
      minX = Math.min(minX, centerX - extentX);
      minY = Math.min(minY, centerY - extentY);
      maxX = Math.max(maxX, centerX + extentX);
      maxY = Math.max(maxY, centerY + extentY);
    }
    ctx.setTransform(frame.x, frame.y, -frame.y, frame.x, centerX, centerY);
    ctx.drawImage(
      atlas,
      -length / 2 - overlap,
      -brushSize / 2,
      length + overlap * 2,
      brushSize,
    );
  }
  ctx.resetTransform();
  if (!collectBounds || minX === Number.POSITIVE_INFINITY) return null;
  // Integer edges plus a pixel of padding retain the quad's antialias fringe.
  // Both profiles use the same quads, so these bounds cover both ink images.
  const left = Math.max(0, Math.floor(minX) - 1);
  const top = Math.max(0, Math.floor(minY) - 1);
  const right = Math.min(ctx.canvas.width, Math.ceil(maxX) + 1);
  const bottom = Math.min(ctx.canvas.height, Math.ceil(maxY) + 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
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
