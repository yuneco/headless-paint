import type { BrushMixing, BrushMixingState, Color, Layer } from "../types";
import {
  BRUSH_MIXING_MAX_CHECKPOINT_DISTANCE_PX,
  BRUSH_MIXING_MAX_FIELD_DIMENSION,
  BRUSH_MIXING_MIN_FIELD_DIMENSION,
  DEFAULT_BRUSH_MIXING,
} from "../types";
import {
  type BrushAccelerator,
  getActiveGpuStrokeSurface,
} from "./gpu/accelerator";
import {
  advanceMaterialField,
  createMaterialField,
  writeMaterialFieldPixels,
} from "./material-field";
import { brushPerfDebug, perfSample, perfStage } from "./perf-debug";

const CONTEXT_CACHE = new WeakMap<
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D
>();
const nullCheckpointCache = new Map<string, ImageData>();

export function getDabSource(renderCanvas: OffscreenCanvas): OffscreenCanvas {
  return renderCanvas;
}

export interface MixingUpdateInput {
  readonly tipCanvas: OffscreenCanvas;
  readonly baseColor: Color;
  readonly x: number;
  readonly y: number;
  readonly directionX: number;
  readonly directionY: number;
  readonly stampSize: number;
  readonly checkpointFootprintSize: number;
  readonly gpuCheckpointFootprintSize?: number;
  readonly stampDistance: number;
  readonly sourceLayer: Layer;
  readonly targetLayer: Layer;
  readonly mixing: BrushMixing;
  readonly state: BrushMixingState | undefined;
}

export interface BristleMixingFlushUpdate {
  readonly input: MixingUpdateInput;
  readonly distancePx: number;
  readonly mixWeight: number;
  readonly capturesCheckpoint: boolean;
}

export interface BristleMixingFlushResult {
  readonly state: BrushMixingState;
  readonly startField: Float32Array;
  readonly endField: Float32Array;
  readonly updates: readonly BristleMixingFlushUpdate[];
}

export interface BristleMixingInterpolationProfiles {
  readonly canvases: readonly (readonly [OffscreenCanvas, OffscreenCanvas?])[];
}

export function getActiveMixing(
  mixing: BrushMixing | undefined,
): BrushMixing | null {
  if (!mixing?.enabled) return null;
  const pickupRatePerPx = sanitizeRate(
    mixing.pickupRatePerPx,
    DEFAULT_BRUSH_MIXING.pickupRatePerPx,
  );
  const restoreRatePerPx = sanitizeRate(
    mixing.restoreRatePerPx,
    DEFAULT_BRUSH_MIXING.restoreRatePerPx,
  );
  const diffusionRatePerPx = sanitizeRate(
    mixing.diffusionRatePerPx,
    DEFAULT_BRUSH_MIXING.diffusionRatePerPx,
  );
  // The field starts each stroke as a uniform base color and is not carried
  // across strokes. Without pickup there is therefore nothing for restore or
  // diffusion to change, so the complete material stage is a semantic no-op.
  if (pickupRatePerPx <= 0) return null;
  return {
    enabled: true,
    pickupRatePerPx,
    restoreRatePerPx,
    diffusionRatePerPx,
    updateDistancePx: sanitizeDistance(
      mixing.updateDistancePx,
      DEFAULT_BRUSH_MIXING.updateDistancePx,
    ),
    checkpointDistancePx: Math.min(
      BRUSH_MIXING_MAX_CHECKPOINT_DISTANCE_PX,
      sanitizeDistance(
        mixing.checkpointDistancePx,
        DEFAULT_BRUSH_MIXING.checkpointDistancePx,
      ),
    ),
    fieldColumns: sanitizeFieldDimension(
      mixing.fieldColumns,
      DEFAULT_BRUSH_MIXING.fieldColumns,
    ),
    fieldRows: sanitizeFieldDimension(
      mixing.fieldRows,
      DEFAULT_BRUSH_MIXING.fieldRows,
    ),
  };
}

export function isBrushMixingActive(mixing: BrushMixing | undefined): boolean {
  return getActiveMixing(mixing) !== null;
}

export function prepareMixingState(
  tipCanvas: OffscreenCanvas,
  baseColor: Color,
  mixing: BrushMixing,
  state: BrushMixingState | undefined,
  accelerator?: BrushAccelerator | null,
): BrushMixingState {
  if (
    state &&
    state.fieldCanvas.width === mixing.fieldColumns &&
    state.fieldCanvas.height === mixing.fieldRows &&
    state.renderCanvas.width === tipCanvas.width &&
    state.renderCanvas.height === tipCanvas.height
  ) {
    return state;
  }

  const field = createMaterialField(
    mixing.fieldColumns,
    mixing.fieldRows,
    baseColor,
  );
  const fieldCanvas = perfStage(
    "canvasAlloc",
    () => new OffscreenCanvas(mixing.fieldColumns, mixing.fieldRows),
  );
  const renderCanvas = perfStage(
    "canvasAlloc",
    () => new OffscreenCanvas(tipCanvas.width, tipCanvas.height),
  );
  const fieldCtx = getCached2dContext(fieldCanvas, "material field");
  const fieldPixels = fieldCtx.createImageData(
    mixing.fieldColumns,
    mixing.fieldRows,
  );
  const next: BrushMixingState = {
    field,
    fieldCanvas,
    fieldPixels,
    renderCanvas,
    lastCheckpointDistance: 0,
  };
  const gpuSurface = getActiveGpuStrokeSurface(accelerator);
  if (gpuSurface) {
    gpuSurface.initializeMaterialField(
      mixing.fieldColumns,
      mixing.fieldRows,
      baseColor,
    );
  } else {
    uploadMaterialCanvas(next, tipCanvas, accelerator);
  }
  return next;
}

/**
 * 現在dabのdeposit完了後に、次のdab用の保持色とpickup checkpointを更新する。
 */
export function updateMixingAfterDeposit(
  input: MixingUpdateInput,
  accelerator?: BrushAccelerator | null,
): BrushMixingState {
  let state = prepareMixingState(
    input.tipCanvas,
    input.baseColor,
    input.mixing,
    input.state,
    accelerator,
  );
  const gpuSurface = getActiveGpuStrokeSurface(accelerator);
  const gpuFieldActive = gpuSurface !== null;
  const lastUpdate = state.lastUpdateDistance;
  if (
    lastUpdate === undefined ||
    input.stampDistance - lastUpdate >= input.mixing.updateDistancePx
  ) {
    const distancePx =
      lastUpdate === undefined
        ? input.mixing.updateDistancePx
        : input.stampDistance - lastUpdate;
    if (gpuFieldActive) {
      gpuSurface.updateMaterialField({
        baseColor: input.baseColor,
        centerX: input.x,
        centerY: input.y,
        angle: Math.atan2(input.directionY, input.directionX),
        sampleSize: Math.max(1, input.stampSize),
        columns: input.mixing.fieldColumns,
        rows: input.mixing.fieldRows,
        pickupRatePerPx: input.mixing.pickupRatePerPx,
        restoreRatePerPx: input.mixing.restoreRatePerPx,
        diffusionRatePerPx: input.mixing.diffusionRatePerPx,
        distancePx,
      });
      state = { ...state, lastUpdateDistance: input.stampDistance };
    } else {
      state = prepareInitialMixingCheckpoint(input, state, accelerator);
      const field = advanceMixingFieldFromCheckpoint(input, state, distancePx);
      state = {
        ...state,
        field,
        lastUpdateDistance: input.stampDistance,
      };
      uploadMaterialCanvas(state, input.tipCanvas, accelerator);
    }
  }

  const lastCheckpoint = state.lastCheckpointDistance ?? 0;
  if (
    input.stampDistance - lastCheckpoint >=
    input.mixing.checkpointDistancePx
  ) {
    if (gpuFieldActive) {
      const { originX, originY, tileSize } = getGpuCheckpointTile(input);
      gpuSurface.snapshotMaterialCheckpoint(originX, originY, tileSize);
      state = {
        ...state,
        lastCheckpointDistance: input.stampDistance,
      };
    } else {
      state = captureCheckpoint(input, state);
    }
  }
  return state;
}

/**
 * Rough bristle の一回の決定的 flush に含まれる material update を畳み込む。
 * checkpoint readback は必要な参照位置を一つの union tile に束ねる。
 */
export function prepareBristleMixingFlush(
  inputs: readonly MixingUpdateInput[],
  initialState: BrushMixingState,
): BristleMixingFlushResult {
  const firstInput = inputs[0];
  if (!firstInput) {
    return {
      state: initialState,
      startField: initialState.field.slice(),
      endField: initialState.field.slice(),
      updates: [],
    };
  }

  const startField = initialState.field.slice();
  let lastUpdateDistance = initialState.lastUpdateDistance;
  let lastCheckpointDistance = initialState.lastCheckpointDistance ?? 0;
  const pending = inputs.map((input) => {
    const distancePx =
      lastUpdateDistance === undefined
        ? input.mixing.updateDistancePx
        : input.stampDistance - lastUpdateDistance;
    lastUpdateDistance = input.stampDistance;
    const capturesCheckpoint =
      input.stampDistance - lastCheckpointDistance >=
      input.mixing.checkpointDistancePx;
    if (capturesCheckpoint) lastCheckpointDistance = input.stampDistance;
    return { input, distancePx, capturesCheckpoint };
  });
  const totalDistance = pending.reduce(
    (sum, update) => sum + Math.max(0, update.distancePx),
    0,
  );

  const needsInitialCheckpoint = !initialState.checkpointPixels;
  const flushStartReferences = pending
    .slice(0, -1)
    .filter((update) => update.capturesCheckpoint)
    .map((update) => update.input);
  const unionInputs = needsInitialCheckpoint
    ? [firstInput, ...flushStartReferences]
    : flushStartReferences;
  const union =
    unionInputs.length > 0
      ? captureCheckpointUnion(
          unionInputs,
          needsInitialCheckpoint
            ? firstInput.sourceLayer.canvas
            : firstInput.targetLayer.canvas,
        )
      : undefined;
  if (needsInitialCheckpoint && union) perfSample("checkpoints", 1);

  // Carried checkpoints remain the reference until an in-flush capture.
  let state =
    needsInitialCheckpoint && union
      ? {
          ...initialState,
          checkpointCanvas: union.canvas,
          checkpointPixels: union.pixels,
          checkpointOriginX: union.originX,
          checkpointOriginY: union.originY,
        }
      : initialState;
  const initialCheckpointPixels = state.checkpointPixels;
  if (!initialCheckpointPixels) {
    throw new Error("Brush mixing checkpoint pixels are missing");
  }
  let checkpointPixels: ImageData = initialCheckpointPixels;
  let checkpointOriginX = state.checkpointOriginX ?? 0;
  let checkpointOriginY = state.checkpointOriginY ?? 0;

  let field: Float32Array<ArrayBufferLike> = startField;
  let cumulativeDistance = 0;
  const updates: BristleMixingFlushUpdate[] = [];
  for (let index = 0; index < pending.length; index++) {
    const update = pending[index];
    if (!update) continue;
    const sampled = perfStage("materialSample", () =>
      sampleCheckpointFootprintFromPixels(
        update.input,
        checkpointPixels,
        checkpointOriginX,
        checkpointOriginY,
      ),
    );
    field = advanceMaterialField(
      field,
      sampled,
      update.input.mixing.fieldColumns,
      update.input.mixing.fieldRows,
      update.input.baseColor,
      {
        pickupRatePerPx: update.input.mixing.pickupRatePerPx,
        restoreRatePerPx: update.input.mixing.restoreRatePerPx,
        diffusionRatePerPx: 0,
        distancePx: update.distancePx,
      },
    );
    cumulativeDistance += Math.max(0, update.distancePx);
    updates.push({
      ...update,
      mixWeight: totalDistance > 0 ? cumulativeDistance / totalDistance : 1,
    });
    if (update.capturesCheckpoint && index < pending.length - 1) {
      if (!union) {
        throw new Error("Bristle mixing flush checkpoint tile is missing");
      }
      checkpointPixels = union.pixels;
      checkpointOriginX = union.originX;
      checkpointOriginY = union.originY;
    }
  }

  const endField = field;
  const diffusionRatePerPx =
    totalDistance > 0
      ? Math.min(firstInput.mixing.diffusionRatePerPx, 1 / totalDistance)
      : firstInput.mixing.diffusionRatePerPx;
  if (totalDistance > 0 && diffusionRatePerPx > 0) {
    field = advanceMaterialField(
      field,
      new Uint8ClampedArray(field.length),
      firstInput.mixing.fieldColumns,
      firstInput.mixing.fieldRows,
      firstInput.baseColor,
      {
        pickupRatePerPx: 0,
        restoreRatePerPx: 0,
        diffusionRatePerPx,
        distancePx: totalDistance,
      },
    );
  }

  state = {
    ...state,
    field,
    lastUpdateDistance,
    lastCheckpointDistance,
  };
  return { state, startField, endField, updates };
}

interface BristleMixingInterpolationCache {
  fieldCanvas: OffscreenCanvas;
  fieldPixels: ImageData;
  renderCanvases: OffscreenCanvas[];
  capacity: number;
}

const BRISTLE_INTERPOLATION_CACHE = new WeakMap<
  OffscreenCanvas,
  BristleMixingInterpolationCache
>();

/**
 * CPU bristle の run ごとの補間 field を低解像度 atlas へ一括 upload する。
 * tip 解像度への転写も先にまとめ、描画中の ImageData upload を避ける。
 */
export function prepareBristleMixingInterpolationProfiles(
  state: BrushMixingState,
  tipCanvas: OffscreenCanvas,
  startField: Float32Array,
  endField: Float32Array,
  runWeights: readonly (readonly [number, number])[],
): BristleMixingInterpolationProfiles | null {
  return perfStage("materialUpload", () => {
    if (brushPerfDebug.nullStages.nullMaterialUpload) return null;
    if (
      startField.length !== state.field.length ||
      endField.length !== state.field.length
    ) {
      throw new Error("Bristle mixing field dimensions do not match");
    }
    const columns = state.fieldPixels.width;
    const rows = state.fieldPixels.height;
    const profileWidth = tipCanvas.width;
    const profileHeight = tipCanvas.height;
    // These are the flush's pre-diffusion endpoints from prepareBristleMixingFlush.
    // Scan all texels/RGBA once per flush, not once per run. CPU fields use
    // byte-scale floats; normalize the maximum to the shader's 0..1 scale.
    let maxFieldDelta = 0;
    for (let index = 0; index < startField.length; index++) {
      maxFieldDelta = Math.max(
        maxFieldDelta,
        Math.abs(endField[index] - startField[index]),
      );
    }
    maxFieldDelta /= 255;
    // Adjacent runs share their endpoint profile. Upload each weight only once.
    const weights: number[] = [];
    const slots = new Map<number, number>();
    const slotFor = (weight: number) => {
      const resolvedWeight = Math.max(0, Math.min(1, weight));
      const existing = slots.get(resolvedWeight);
      if (existing !== undefined) return existing;
      const slot = weights.length;
      weights.push(resolvedWeight);
      slots.set(resolvedWeight, slot);
      return slot;
    };
    const profileSlots = runWeights.map(([w0, w1]) =>
      maxFieldDelta * Math.abs(w1 - w0) < 1 / 255
        ? ([slotFor(w1)] as const)
        : ([slotFor(w0), slotFor(w1)] as const),
    );
    const requiredCapacity = weights.length + 1;
    let cached = BRISTLE_INTERPOLATION_CACHE.get(state.renderCanvas);
    if (
      !cached ||
      cached.capacity < requiredCapacity ||
      cached.fieldCanvas.height !== rows
    ) {
      const capacity = Math.max(requiredCapacity, cached?.capacity ?? 0);
      const fieldCanvas = new OffscreenCanvas(columns * capacity, rows);
      const fieldCtx = getCached2dContext(
        fieldCanvas,
        "bristle material field atlas",
      );
      cached = {
        fieldCanvas,
        fieldPixels: fieldCtx.createImageData(columns * capacity, rows),
        renderCanvases: Array.from(
          { length: capacity },
          (_, index) =>
            cached?.renderCanvases[index] ??
            new OffscreenCanvas(profileWidth, profileHeight),
        ),
        capacity,
      };
      BRISTLE_INTERPOLATION_CACHE.set(state.renderCanvas, cached);
    }

    const writeField = (
      slot: number,
      field: Float32Array,
      otherField: Float32Array,
      weight: number,
    ) => {
      const resolvedWeight = Math.max(0, Math.min(1, weight));
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const sourceOffset = (row * columns + column) * 4;
          const targetOffset =
            (row * cached.fieldPixels.width + slot * columns + column) * 4;
          for (let channel = 0; channel < 4; channel++) {
            const index = sourceOffset + channel;
            const from = field[index] ?? 0;
            const to = otherField[index] ?? 0;
            cached.fieldPixels.data[targetOffset + channel] = Math.round(
              from + (to - from) * resolvedWeight,
            );
          }
        }
      }
    };

    for (let slot = 0; slot < weights.length; slot++) {
      writeField(slot, startField, endField, weights[slot] ?? 1);
    }
    writeField(weights.length, state.field, state.field, 1);

    const fieldCtx = getCached2dContext(
      cached.fieldCanvas,
      "bristle material field atlas",
    );
    fieldCtx.putImageData(cached.fieldPixels, 0, 0);
    writeMaterialFieldPixels(state.field, state.fieldPixels.data);

    for (let slot = 0; slot < requiredCapacity; slot++) {
      const renderCanvas = cached.renderCanvases[slot];
      if (!renderCanvas) continue;
      const renderCtx = getCached2dContext(
        renderCanvas,
        "bristle material tip interpolation",
      );
      renderCtx.save();
      renderCtx.globalAlpha = 1;
      renderCtx.globalCompositeOperation = "copy";
      renderCtx.setTransform(1, 0, 0, 1, 0, 0);
      renderCtx.drawImage(
        cached.fieldCanvas,
        slot * columns,
        0,
        columns,
        rows,
        0,
        0,
        profileWidth,
        profileHeight,
      );
      renderCtx.globalCompositeOperation = "destination-in";
      renderCtx.drawImage(tipCanvas, 0, 0);
      renderCtx.restore();
    }

    const stateRenderCtx = getCached2dContext(
      state.renderCanvas,
      "material tip",
    );
    stateRenderCtx.save();
    stateRenderCtx.globalAlpha = 1;
    stateRenderCtx.globalCompositeOperation = "copy";
    stateRenderCtx.setTransform(1, 0, 0, 1, 0, 0);
    const finalCanvas = cached.renderCanvases[weights.length];
    if (finalCanvas) stateRenderCtx.drawImage(finalCanvas, 0, 0);
    stateRenderCtx.restore();

    return {
      canvases: profileSlots.map(([start, end]) => {
        const startCanvas = cached.renderCanvases[start];
        if (!startCanvas) throw new Error("Bristle start profile is missing");
        return end === undefined
          ? ([startCanvas] as const)
          : ([startCanvas, cached.renderCanvases[end]] as const);
      }),
    };
  });
}

/** checkpoint 時点の target pixels を Canvas に退避し、readback は遅延する。 */
export function stageBristleMixingCheckpoint(
  input: MixingUpdateInput,
  state: BrushMixingState,
): BrushMixingState {
  const { originX, originY, tileSize } = getCheckpointTile(input);
  const checkpointCanvas = ensureCanvasSize(
    state.checkpointCanvas,
    tileSize,
    tileSize,
  );
  copyCheckpointCanvas(
    checkpointCanvas,
    input.targetLayer.canvas,
    originX,
    originY,
  );
  perfSample("checkpoints", 1);
  return {
    ...state,
    checkpointCanvas,
    checkpointOriginX: originX,
    checkpointOriginY: originY,
    lastCheckpointDistance: input.stampDistance,
  };
}

/** flush 内で最後に退避した checkpoint を一度だけ CPU pixels に確定する。 */
export function finalizeBristleMixingCheckpoint(
  state: BrushMixingState,
): BrushMixingState {
  const checkpointCanvas = state.checkpointCanvas;
  if (!checkpointCanvas) return state;
  const ctx = getCached2dContext(checkpointCanvas, "material checkpoint");
  const checkpointPixels = perfStage("checkpointReadback", () =>
    brushPerfDebug.nullStages.nullCheckpoint
      ? getNullCheckpointImageData(
          ctx,
          checkpointCanvas.width,
          checkpointCanvas.height,
        )
      : ctx.getImageData(0, 0, checkpointCanvas.width, checkpointCanvas.height),
  );
  return { ...state, checkpointPixels };
}

/** GPU 経路では最初の deposit を積む前に stroke-start snapshot を読む。 */
export function prepareInitialMixingCheckpoint(
  input: MixingUpdateInput,
  state: BrushMixingState,
  accelerator?: BrushAccelerator | null,
): BrushMixingState {
  const gpuSurface = getActiveGpuStrokeSurface(accelerator);
  if (gpuSurface) {
    const { originX, originY, tileSize } = getGpuCheckpointTile(input);
    gpuSurface.initializeMaterialCheckpoint(originX, originY, tileSize);
    return state;
  }
  if (state.checkpointPixels) return state;
  // The first pickup is anchored to the immutable stroke-start source. A
  // resident GPU accumulation may already contain deposits from an earlier
  // Expand branch by the time the next branch initializes.
  return captureCheckpoint(input, state, input.sourceLayer.canvas, {
    updateCheckpointDistance: false,
  });
}

function sampleCheckpointFootprint(
  input: MixingUpdateInput,
  state: BrushMixingState,
): Uint8ClampedArray {
  const source = state.checkpointPixels;
  if (!source) throw new Error("Brush mixing checkpoint pixels are missing");
  const sourceOriginX = state.checkpointOriginX ?? 0;
  const sourceOriginY = state.checkpointOriginY ?? 0;
  const angle = Math.atan2(input.directionY, input.directionX);
  const sampleSize = Math.max(1, input.stampSize);
  return sampleRotatedCheckpoint(
    source,
    sourceOriginX,
    sourceOriginY,
    input.x,
    input.y,
    angle,
    sampleSize,
    input.mixing.fieldColumns,
    input.mixing.fieldRows,
  );
}

function sampleCheckpointFootprintFromPixels(
  input: MixingUpdateInput,
  source: ImageData,
  sourceOriginX: number,
  sourceOriginY: number,
): Uint8ClampedArray {
  return sampleRotatedCheckpoint(
    source,
    sourceOriginX,
    sourceOriginY,
    input.x,
    input.y,
    Math.atan2(input.directionY, input.directionX),
    Math.max(1, input.stampSize),
    input.mixing.fieldColumns,
    input.mixing.fieldRows,
  );
}

function captureCheckpoint(
  input: MixingUpdateInput,
  state: BrushMixingState,
  sourceCanvas: OffscreenCanvas = input.targetLayer.canvas,
  options: {
    readonly updateCheckpointDistance?: boolean;
  } = {},
): BrushMixingState {
  const updateCheckpointDistance = options.updateCheckpointDistance ?? true;
  const { originX, originY, tileSize } = getCheckpointTile(input);
  const checkpointCanvas = ensureCanvasSize(
    state.checkpointCanvas,
    tileSize,
    tileSize,
  );
  const ctx = getCached2dContext(checkpointCanvas, "material checkpoint");
  copyCheckpointCanvas(checkpointCanvas, sourceCanvas, originX, originY);
  const checkpointPixels = perfStage("checkpointReadback", () =>
    brushPerfDebug.nullStages.nullCheckpoint
      ? getNullCheckpointImageData(ctx, tileSize, tileSize)
      : ctx.getImageData(0, 0, tileSize, tileSize),
  );
  perfSample("checkpoints", 1);
  return {
    ...state,
    checkpointCanvas,
    checkpointPixels,
    checkpointOriginX: originX,
    checkpointOriginY: originY,
    lastCheckpointDistance: updateCheckpointDistance
      ? input.stampDistance
      : state.lastCheckpointDistance,
  };
}

function captureCheckpointUnion(
  inputs: readonly MixingUpdateInput[],
  sourceCanvas: OffscreenCanvas,
): {
  readonly canvas: OffscreenCanvas;
  readonly pixels: ImageData;
  readonly originX: number;
  readonly originY: number;
} {
  const tiles = inputs.map(getCheckpointTile);
  const originX = Math.min(...tiles.map((tile) => tile.originX));
  const originY = Math.min(...tiles.map((tile) => tile.originY));
  const right = Math.max(...tiles.map((tile) => tile.originX + tile.tileSize));
  const bottom = Math.max(...tiles.map((tile) => tile.originY + tile.tileSize));
  const width = Math.max(1, Math.ceil(right - originX));
  const height = Math.max(1, Math.ceil(bottom - originY));
  const canvas = new OffscreenCanvas(width, height);
  copyCheckpointCanvas(canvas, sourceCanvas, originX, originY);
  const ctx = getCached2dContext(canvas, "bristle checkpoint union");
  const pixels = perfStage("checkpointReadback", () =>
    brushPerfDebug.nullStages.nullCheckpoint
      ? getNullCheckpointImageData(ctx, width, height)
      : ctx.getImageData(0, 0, width, height),
  );
  return { canvas, pixels, originX, originY };
}

function copyCheckpointCanvas(
  checkpointCanvas: OffscreenCanvas,
  sourceCanvas: OffscreenCanvas,
  originX: number,
  originY: number,
): void {
  const ctx = getCached2dContext(checkpointCanvas, "material checkpoint");
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "copy";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, checkpointCanvas.width, checkpointCanvas.height);
  ctx.drawImage(sourceCanvas, -originX, -originY);
  ctx.restore();
}

function getCheckpointTile(input: MixingUpdateInput): {
  readonly originX: number;
  readonly originY: number;
  readonly tileSize: number;
} {
  const margin = input.mixing.checkpointDistancePx;
  const tileSize = Math.max(
    1,
    Math.ceil(input.checkpointFootprintSize * Math.SQRT2 + margin * 2 + 4),
  );
  const originX = input.x - tileSize / 2;
  const originY = input.y - tileSize / 2;
  return { originX, originY, tileSize };
}

function getGpuCheckpointTile(input: MixingUpdateInput): {
  readonly originX: number;
  readonly originY: number;
  readonly tileSize: number;
} {
  return getCheckpointTile({
    ...input,
    checkpointFootprintSize:
      input.gpuCheckpointFootprintSize ?? input.checkpointFootprintSize,
  });
}

export function advanceMixingFieldFromCheckpoint(
  input: MixingUpdateInput,
  state: BrushMixingState,
  distancePx: number,
): Float32Array {
  const sample = perfStage("materialSample", () =>
    sampleCheckpointFootprint(input, state),
  );
  return advanceMaterialField(
    state.field,
    sample,
    input.mixing.fieldColumns,
    input.mixing.fieldRows,
    input.baseColor,
    {
      pickupRatePerPx: input.mixing.pickupRatePerPx,
      restoreRatePerPx: input.mixing.restoreRatePerPx,
      diffusionRatePerPx: input.mixing.diffusionRatePerPx,
      distancePx,
    },
  );
}

export function sampleRotatedCheckpoint(
  source: ImageData,
  sourceOriginX: number,
  sourceOriginY: number,
  centerX: number,
  centerY: number,
  angle: number,
  sampleSize: number,
  columns: number,
  rows: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(columns * rows * 4);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let outputOffset = 0;

  for (let row = 0; row < rows; row++) {
    const localY = ((row + 0.5) / rows - 0.5) * sampleSize;
    for (let column = 0; column < columns; column++) {
      const localX = ((column + 0.5) / columns - 0.5) * sampleSize;
      const sourceX =
        centerX + localX * cos - localY * sin - sourceOriginX - 0.5;
      const sourceY =
        centerY + localX * sin + localY * cos - sourceOriginY - 0.5;
      sampleBilinear(source, sourceX, sourceY, result, outputOffset);
      outputOffset += 4;
    }
  }
  return result;
}

function sampleBilinear(
  source: ImageData,
  x: number,
  y: number,
  output: Uint8ClampedArray,
  outputOffset: number,
): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const inside00 =
    x0 >= 0 && y0 >= 0 && x0 < source.width && y0 < source.height;
  const inside10 =
    x1 >= 0 && y0 >= 0 && x1 < source.width && y0 < source.height;
  const inside01 =
    x0 >= 0 && y1 >= 0 && x0 < source.width && y1 < source.height;
  const inside11 =
    x1 >= 0 && y1 >= 0 && x1 < source.width && y1 < source.height;
  const offset00 = (y0 * source.width + x0) * 4;
  const offset10 = (y0 * source.width + x1) * 4;
  const offset01 = (y1 * source.width + x0) * 4;
  const offset11 = (y1 * source.width + x1) * 4;

  // Accumulate premultiplied color so transparent texels add no black.
  const a00 = inside00 ? (source.data[offset00 + 3] ?? 0) * w00 : 0;
  const a10 = inside10 ? (source.data[offset10 + 3] ?? 0) * w10 : 0;
  const a01 = inside01 ? (source.data[offset01 + 3] ?? 0) * w01 : 0;
  const a11 = inside11 ? (source.data[offset11 + 3] ?? 0) * w11 : 0;
  const alpha = a00 + a10 + a01 + a11;
  for (let channel = 0; channel < 3; channel++) {
    let value = 0;
    if (inside00) value += (source.data[offset00 + channel] ?? 0) * a00;
    if (inside10) value += (source.data[offset10 + channel] ?? 0) * a10;
    if (inside01) value += (source.data[offset01 + channel] ?? 0) * a01;
    if (inside11) value += (source.data[offset11 + channel] ?? 0) * a11;
    output[outputOffset + channel] = alpha > 0 ? value / alpha : 0;
  }
  output[outputOffset + 3] = alpha;
}

function uploadMaterialCanvas(
  state: BrushMixingState,
  tipCanvas: OffscreenCanvas,
  accelerator?: BrushAccelerator | null,
): void {
  perfStage("materialUpload", () => {
    if (brushPerfDebug.nullStages.nullMaterialUpload) return;
    writeMaterialFieldPixels(state.field, state.fieldPixels.data);
    uploadMaterialCanvasPixels(state, tipCanvas, accelerator);
  });
}

function uploadMaterialCanvasPixels(
  state: BrushMixingState,
  tipCanvas: OffscreenCanvas,
  accelerator?: BrushAccelerator | null,
): void {
  const gpuSurface = getActiveGpuStrokeSurface(accelerator);
  if (gpuSurface) {
    gpuSurface.updateField(
      state.fieldPixels.data,
      state.fieldPixels.width,
      state.fieldPixels.height,
    );
    return;
  }
  const fieldCtx = getCached2dContext(state.fieldCanvas, "material field");
  fieldCtx.putImageData(state.fieldPixels, 0, 0);

  const renderCtx = getCached2dContext(state.renderCanvas, "material tip");
  renderCtx.save();
  renderCtx.globalAlpha = 1;
  renderCtx.globalCompositeOperation = "copy";
  renderCtx.imageSmoothingEnabled = true;
  renderCtx.drawImage(
    state.fieldCanvas,
    0,
    0,
    state.renderCanvas.width,
    state.renderCanvas.height,
  );
  renderCtx.globalCompositeOperation = "destination-in";
  renderCtx.drawImage(tipCanvas, 0, 0);
  renderCtx.restore();
}

function ensureCanvasSize(
  canvas: OffscreenCanvas | undefined,
  width: number,
  height: number,
): OffscreenCanvas {
  if (canvas && canvas.width === width && canvas.height === height)
    return canvas;
  return perfStage("canvasAlloc", () => new OffscreenCanvas(width, height));
}

function getNullCheckpointImageData(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): ImageData {
  const key = `${width}x${height}`;
  const cached = nullCheckpointCache.get(key);
  if (cached) return cached;
  const image = ctx.createImageData(width, height);
  nullCheckpointCache.set(key, image);
  return image;
}

function getCached2dContext(
  canvas: OffscreenCanvas,
  label: string,
): OffscreenCanvasRenderingContext2D {
  const cached = CONTEXT_CACHE.get(canvas);
  if (cached) return cached;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`Failed to get 2d context for ${label}`);
  CONTEXT_CACHE.set(canvas, ctx);
  return ctx;
}

function sanitizeFieldDimension(value: number, fallback: number): number {
  const resolved = Number.isFinite(value) ? value : fallback;
  return Math.max(
    BRUSH_MIXING_MIN_FIELD_DIMENSION,
    Math.min(BRUSH_MIXING_MAX_FIELD_DIMENSION, Math.round(resolved)),
  );
}

function sanitizeDistance(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitizeRate(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}
