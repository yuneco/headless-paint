import type { BrushMixing, BrushMixingState, Color, Layer } from "../types";
import {
  BRUSH_MIXING_MAX_CHECKPOINT_DISTANCE_PX,
  BRUSH_MIXING_MAX_FIELD_DIMENSION,
  BRUSH_MIXING_MIN_FIELD_DIMENSION,
  DEFAULT_BRUSH_MIXING,
} from "../types";
import { getActiveGpuStrokeSurface } from "./gpu/gpu-stroke-surface";
import {
  advanceMaterialField,
  createMaterialField,
  writeMaterialFieldPixels,
} from "./material-field";
import { brushPerfDebug } from "./perf-debug";

const CONTEXT_CACHE = new WeakMap<
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D
>();
const nullCheckpointCache = new Map<string, ImageData>();
const dabBitmapCache = new WeakMap<OffscreenCanvas, ImageBitmap>();

export function getDabSource(
  renderCanvas: OffscreenCanvas,
): OffscreenCanvas | ImageBitmap {
  return dabBitmapCache.get(renderCanvas) ?? renderCanvas;
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
  readonly stampDistance: number;
  readonly sourceLayer: Layer;
  readonly targetLayer: Layer;
  readonly mixing: BrushMixing;
  readonly state: BrushMixingState | undefined;
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
  const fieldCanvasAllocStartedAt = brushPerfDebug.enabled
    ? performance.now()
    : 0;
  const fieldCanvas = new OffscreenCanvas(
    mixing.fieldColumns,
    mixing.fieldRows,
  );
  if (brushPerfDebug.enabled) {
    brushPerfDebug.recordStage("canvasAlloc", fieldCanvasAllocStartedAt);
  }
  const renderCanvasAllocStartedAt = brushPerfDebug.enabled
    ? performance.now()
    : 0;
  const renderCanvas = new OffscreenCanvas(tipCanvas.width, tipCanvas.height);
  if (brushPerfDebug.enabled) {
    brushPerfDebug.recordStage("canvasAlloc", renderCanvasAllocStartedAt);
  }
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
  uploadMaterialCanvas(next, tipCanvas);
  return next;
}

/**
 * 現在dabのdeposit完了後に、次のdab用の保持色とpickup checkpointを更新する。
 */
export function updateMixingAfterDeposit(
  input: MixingUpdateInput,
): BrushMixingState {
  let state = prepareMixingState(
    input.tipCanvas,
    input.baseColor,
    input.mixing,
    input.state,
  );
  const lastUpdate = state.lastUpdateDistance;
  if (
    lastUpdate === undefined ||
    input.stampDistance - lastUpdate >=
      input.mixing.updateDistancePx * brushPerfDebug.experiments.updateScale
  ) {
    state = prepareInitialMixingCheckpoint(input, state);
    const sampleStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
    const sample = sampleCheckpointFootprint(input, state);
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("materialSample", sampleStartedAt);
    }
    const distancePx =
      lastUpdate === undefined
        ? input.mixing.updateDistancePx
        : input.stampDistance - lastUpdate;
    const field = advanceMaterialField(
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
    state = {
      ...state,
      field,
      lastUpdateDistance: input.stampDistance,
    };
    uploadMaterialCanvas(state, input.tipCanvas);
  }

  const lastCheckpoint = state.lastCheckpointDistance ?? 0;
  if (
    input.stampDistance - lastCheckpoint >=
    input.mixing.checkpointDistancePx *
      brushPerfDebug.experiments.checkpointScale
  ) {
    state = captureCheckpoint(input, state);
  }
  return state;
}

/** GPU 経路では最初の deposit を積む前に stroke-start snapshot を読む。 */
export function prepareInitialMixingCheckpoint(
  input: MixingUpdateInput,
  state: BrushMixingState,
): BrushMixingState {
  if (state.checkpointPixels) return state;
  return captureCheckpoint(input, state, input.sourceLayer.canvas, false);
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

function captureCheckpoint(
  input: MixingUpdateInput,
  state: BrushMixingState,
  sourceCanvas: OffscreenCanvas = input.targetLayer.canvas,
  updateCheckpointDistance = true,
): BrushMixingState {
  const margin = input.mixing.checkpointDistancePx;
  const tileSize = Math.max(
    1,
    Math.ceil(input.checkpointFootprintSize * Math.SQRT2 + margin * 2 + 4),
  );
  const originX = input.x - tileSize / 2;
  const originY = input.y - tileSize / 2;
  const gpuSurface = getActiveGpuStrokeSurface();
  if (gpuSurface) {
    const readbackStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
    const checkpointPixels = new ImageData(tileSize, tileSize);
    checkpointPixels.data.set(
      gpuSurface.readCheckpoint(originX, originY, tileSize),
    );
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("checkpointReadback", readbackStartedAt);
      brushPerfDebug.recordSample("checkpoints", 1);
    }
    return {
      ...state,
      checkpointPixels,
      checkpointOriginX: originX,
      checkpointOriginY: originY,
      lastCheckpointDistance: updateCheckpointDistance
        ? input.stampDistance
        : state.lastCheckpointDistance,
    };
  }
  const checkpointCanvas = ensureCanvasSize(
    state.checkpointCanvas,
    tileSize,
    tileSize,
  );
  const ctx = getCached2dContext(checkpointCanvas, "material checkpoint");
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "copy";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, tileSize, tileSize);
  ctx.drawImage(sourceCanvas, -originX, -originY);
  ctx.restore();
  const readbackStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
  const checkpointPixels = brushPerfDebug.nullStages.nullCheckpoint
    ? getNullCheckpointImageData(ctx, tileSize, tileSize)
    : ctx.getImageData(0, 0, tileSize, tileSize);
  if (brushPerfDebug.enabled) {
    brushPerfDebug.recordStage("checkpointReadback", readbackStartedAt);
    brushPerfDebug.recordSample("checkpoints", 1);
  }
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

function sampleRotatedCheckpoint(
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

  for (let channel = 0; channel < 4; channel++) {
    let value = 0;
    if (inside00) value += (source.data[offset00 + channel] ?? 0) * w00;
    if (inside10) value += (source.data[offset10 + channel] ?? 0) * w10;
    if (inside01) value += (source.data[offset01 + channel] ?? 0) * w01;
    if (inside11) value += (source.data[offset11 + channel] ?? 0) * w11;
    output[outputOffset + channel] = value;
  }
}

function uploadMaterialCanvas(
  state: BrushMixingState,
  tipCanvas: OffscreenCanvas,
): void {
  const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
  if (brushPerfDebug.nullStages.nullMaterialUpload) {
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("materialUpload", startedAt);
    }
    return;
  }
  writeMaterialFieldPixels(state.field, state.fieldPixels.data);
  const gpuSurface = getActiveGpuStrokeSurface();
  if (gpuSurface) {
    gpuSurface.updateField(
      state.fieldPixels.data,
      state.fieldPixels.width,
      state.fieldPixels.height,
    );
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("materialUpload", startedAt);
    }
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
  if (brushPerfDebug.experiments.bitmapDab) {
    dabBitmapCache.get(state.renderCanvas)?.close();
    dabBitmapCache.set(
      state.renderCanvas,
      state.renderCanvas.transferToImageBitmap(),
    );
  }
  if (brushPerfDebug.enabled) {
    brushPerfDebug.recordStage("materialUpload", startedAt);
  }
}

function ensureCanvasSize(
  canvas: OffscreenCanvas | undefined,
  width: number,
  height: number,
): OffscreenCanvas {
  if (canvas && canvas.width === width && canvas.height === height)
    return canvas;
  const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
  const next = new OffscreenCanvas(width, height);
  if (brushPerfDebug.enabled) {
    brushPerfDebug.recordStage("canvasAlloc", startedAt);
  }
  return next;
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
