import { brushPerfDebug, perfMark } from "../perf-debug";
import type { GpuMaterialFieldUpdate } from "./gpu-stroke-surface";
import { MAX_GPU_STROKE_BRANCHES } from "./shader-sources";
import type { MaterialCheckpoint } from "./snapshot-manager";

const GPU_ALLOCATION_QUANTUM_PX = 32;

export function oppositeFieldIndex(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}

export function roundUpGpuAllocation(value: number): number {
  return (
    Math.ceil(value / GPU_ALLOCATION_QUANTUM_PX) * GPU_ALLOCATION_QUANTUM_PX
  );
}

export function sanitizeNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function sanitizeRate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function distanceCoefficient(
  ratePerPx: number,
  distancePx: number,
): number {
  return 1 - Math.exp(-sanitizeRate(ratePerPx) * distancePx);
}

export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export interface FieldPassResources {
  readonly gl: WebGL2RenderingContext;
  branchCount: number;
  fieldColumns: number;
  fieldRows: number;
  activeFieldIndex: 0 | 1;
  readonly checkpoints: readonly MaterialCheckpoint[];
  readonly fieldTextures: readonly [WebGLTexture, WebGLTexture];
  readonly materialCheckpointTexture: WebGLTexture;
  readonly branchDataBuffer: WebGLBuffer;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly fieldMixProgram: WebGLProgram;
  readonly fieldBatchMixProgram: WebGLProgram;
  readonly fieldDiffusionProgram: WebGLProgram;
  readonly fieldMixUniforms: {
    readonly fieldDimensions: WebGLUniformLocation;
  };
  readonly fieldBatchMixUniforms: {
    readonly fieldDimensions: WebGLUniformLocation;
    readonly surfaceDimensions: WebGLUniformLocation;
    readonly runCount: WebGLUniformLocation;
  };
  readonly fieldBatchCheckpointTexture: WebGLTexture;
  readonly fieldBatchRunDataTexture: WebGLTexture;
  readonly getFieldBatchAccumTexture: () => WebGLTexture;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
  readonly fieldDiffusionUniforms: {
    readonly fieldDimensions: WebGLUniformLocation;
    readonly strengths: WebGLUniformLocation;
  };
  readonly fieldPassScratch: {
    readonly branchData: Float32Array<ArrayBuffer>;
    readonly passAmounts: Float32Array<ArrayBuffer>;
    readonly strengths: Float32Array<ArrayBuffer>;
    mixColumns: number;
    mixRows: number;
    batchMixColumns: number;
    batchMixRows: number;
    batchRunCapacity: number;
    diffusionColumns: number;
    diffusionRows: number;
  };
  readonly bindFieldFramebuffer: (index: 0 | 1) => void;
}

export interface FieldBatchCheckpoint {
  readonly originX: number;
  readonly originY: number;
  readonly textureSize: number;
  readonly atlasX: number;
  readonly atlasY: number;
  readonly sampleFlushStartAccum: boolean;
}

export interface FieldBatchMixRun {
  readonly branchIndex: number;
  readonly update: GpuMaterialFieldUpdate;
  readonly checkpoint: FieldBatchCheckpoint;
}

export function executeMaterialFieldMixPass(
  resources: FieldPassResources,
  updates: readonly (GpuMaterialFieldUpdate | undefined)[],
): number {
  const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
  const branchData = resources.fieldPassScratch.branchData;
  branchData.fill(0);
  const checkpointRectsOffset = 0;
  const geometryOffset = MAX_GPU_STROKE_BRANCHES * 4;
  const baseColorsOffset = MAX_GPU_STROKE_BRANCHES * 8;
  const ratesOffset = MAX_GPU_STROKE_BRANCHES * 12;

  for (
    let branchIndex = 0;
    branchIndex < resources.branchCount;
    branchIndex++
  ) {
    const update = updates[branchIndex];
    const checkpoint = resources.checkpoints[branchIndex];
    if (update && !checkpoint?.initialized) {
      throw new Error("GPU material checkpoint has not been initialized");
    }
    if (checkpoint?.initialized) {
      const offset = checkpointRectsOffset + branchIndex * 4;
      branchData[offset] = checkpoint.originX;
      branchData[offset + 1] = checkpoint.originY;
      branchData[offset + 2] = checkpoint.textureSize;
      branchData[offset + 3] = checkpoint.textureSize;
    }
    if (!update) continue;
    if (
      update.columns !== resources.fieldColumns ||
      update.rows !== resources.fieldRows
    ) {
      throw new Error("GPU material field batch dimensions do not match");
    }
    const distance = sanitizeNonNegative(update.distancePx);
    const geometryIndex = geometryOffset + branchIndex * 4;
    branchData[geometryIndex] = update.centerX;
    branchData[geometryIndex + 1] = update.centerY;
    branchData[geometryIndex + 2] = update.angle;
    branchData[geometryIndex + 3] = Math.max(1, update.sampleSize);
    const baseColorIndex = baseColorsOffset + branchIndex * 4;
    branchData[baseColorIndex] = clampUnit(update.baseColor.r / 255);
    branchData[baseColorIndex + 1] = clampUnit(update.baseColor.g / 255);
    branchData[baseColorIndex + 2] = clampUnit(update.baseColor.b / 255);
    branchData[baseColorIndex + 3] = clampUnit(update.baseColor.a / 255);
    const ratesIndex = ratesOffset + branchIndex * 4;
    branchData[ratesIndex] = distanceCoefficient(
      update.pickupRatePerPx,
      distance,
    );
    branchData[ratesIndex + 1] = distanceCoefficient(
      update.restoreRatePerPx,
      distance,
    );
    branchData[ratesIndex + 2] = 1;
    branchData[ratesIndex + 3] = 0;
  }

  const { gl } = resources;
  const nextIndex = oppositeFieldIndex(resources.activeFieldIndex);
  resources.bindFieldFramebuffer(nextIndex);
  gl.viewport(
    0,
    0,
    resources.fieldColumns,
    resources.fieldRows * resources.branchCount,
  );
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  gl.useProgram(resources.fieldMixProgram);
  gl.bindVertexArray(resources.vertexArray);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, resources.materialCheckpointTexture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(
    gl.TEXTURE_2D,
    resources.fieldTextures[resources.activeFieldIndex],
  );
  const scratch = resources.fieldPassScratch;
  if (
    scratch.mixColumns !== resources.fieldColumns ||
    scratch.mixRows !== resources.fieldRows
  ) {
    gl.uniform2i(
      resources.fieldMixUniforms.fieldDimensions,
      resources.fieldColumns,
      resources.fieldRows,
    );
    scratch.mixColumns = resources.fieldColumns;
    scratch.mixRows = resources.fieldRows;
  }
  gl.bindBuffer(gl.UNIFORM_BUFFER, resources.branchDataBuffer);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, branchData);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return startedAt;
}

export function executeMaterialFieldBatchMixPass(
  resources: FieldPassResources,
  runs: readonly FieldBatchMixRun[],
): number {
  const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
  if (runs.length === 0) return startedAt;
  const runData = new Float32Array(runs.length * 5 * 4);
  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    if (!run) continue;
    const { update, checkpoint } = run;
    if (
      update.columns !== resources.fieldColumns ||
      update.rows !== resources.fieldRows
    ) {
      throw new Error("GPU material field batch dimensions do not match");
    }
    if (run.branchIndex < 0 || run.branchIndex >= resources.branchCount) {
      throw new Error("GPU material field batch branch is out of range");
    }
    const offset = runIndex * 20;
    runData[offset] = checkpoint.originX;
    runData[offset + 1] = checkpoint.originY;
    runData[offset + 2] = checkpoint.textureSize;
    runData[offset + 3] = checkpoint.textureSize;
    runData[offset + 4] = update.centerX;
    runData[offset + 5] = update.centerY;
    runData[offset + 6] = update.angle;
    runData[offset + 7] = Math.max(1, update.sampleSize);
    runData[offset + 8] = clampUnit(update.baseColor.r / 255);
    runData[offset + 9] = clampUnit(update.baseColor.g / 255);
    runData[offset + 10] = clampUnit(update.baseColor.b / 255);
    runData[offset + 11] = clampUnit(update.baseColor.a / 255);
    const distance = sanitizeNonNegative(update.distancePx);
    runData[offset + 12] = distanceCoefficient(
      update.pickupRatePerPx,
      distance,
    );
    runData[offset + 13] = distanceCoefficient(
      update.restoreRatePerPx,
      distance,
    );
    runData[offset + 14] = run.branchIndex;
    runData[offset + 15] = checkpoint.sampleFlushStartAccum ? 1 : 0;
    runData[offset + 16] = checkpoint.atlasX;
    runData[offset + 17] = checkpoint.atlasY;
  }

  const { gl } = resources;
  const scratch = resources.fieldPassScratch;
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, resources.fieldBatchRunDataTexture);
  if (runs.length > scratch.batchRunCapacity) {
    scratch.batchRunCapacity = Math.max(
      runs.length,
      scratch.batchRunCapacity * 2,
    );
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if (scratch.batchRunCapacity > maxTextureSize) {
      throw new Error("GPU material field batch exceeds the texture limit");
    }
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      5,
      scratch.batchRunCapacity,
      0,
      gl.RGBA,
      gl.FLOAT,
      null,
    );
  }
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    5,
    runs.length,
    gl.RGBA,
    gl.FLOAT,
    runData,
  );

  const nextIndex = oppositeFieldIndex(resources.activeFieldIndex);
  resources.bindFieldFramebuffer(nextIndex);
  gl.viewport(
    0,
    0,
    resources.fieldColumns,
    resources.fieldRows * resources.branchCount,
  );
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  gl.useProgram(resources.fieldBatchMixProgram);
  gl.bindVertexArray(resources.vertexArray);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, resources.fieldBatchCheckpointTexture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(
    gl.TEXTURE_2D,
    resources.fieldTextures[resources.activeFieldIndex],
  );
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, resources.fieldBatchRunDataTexture);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, resources.getFieldBatchAccumTexture());
  if (
    scratch.batchMixColumns !== resources.fieldColumns ||
    scratch.batchMixRows !== resources.fieldRows
  ) {
    gl.uniform2i(
      resources.fieldBatchMixUniforms.fieldDimensions,
      resources.fieldColumns,
      resources.fieldRows,
    );
    scratch.batchMixColumns = resources.fieldColumns;
    scratch.batchMixRows = resources.fieldRows;
  }
  gl.uniform2i(
    resources.fieldBatchMixUniforms.surfaceDimensions,
    resources.surfaceWidth,
    resources.surfaceHeight,
  );
  gl.uniform1i(resources.fieldBatchMixUniforms.runCount, runs.length);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return startedAt;
}

export function executeMaterialFieldDiffusionPass(
  resources: FieldPassResources,
  updates: readonly (GpuMaterialFieldUpdate | undefined)[],
  startedAt: number,
): 0 | 1 {
  const { gl } = resources;
  const scratch = resources.fieldPassScratch;
  const passAmounts = scratch.passAmounts;
  const strengths = scratch.strengths;
  passAmounts.fill(0);
  for (
    let branchIndex = 0;
    branchIndex < resources.branchCount;
    branchIndex++
  ) {
    const update = updates[branchIndex];
    if (!update) continue;
    passAmounts[branchIndex] =
      sanitizeRate(update.diffusionRatePerPx) *
      sanitizeNonNegative(update.distancePx);
  }

  let sourceIndex = oppositeFieldIndex(resources.activeFieldIndex);
  if (!passAmounts.some((amount) => amount > 1e-6)) {
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("gpuFieldUpdate", startedAt);
    }
    return sourceIndex;
  }
  gl.viewport(
    0,
    0,
    resources.fieldColumns,
    resources.fieldRows * resources.branchCount,
  );
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  gl.useProgram(resources.fieldDiffusionProgram);
  gl.bindVertexArray(resources.vertexArray);
  gl.activeTexture(gl.TEXTURE1);
  if (
    scratch.diffusionColumns !== resources.fieldColumns ||
    scratch.diffusionRows !== resources.fieldRows
  ) {
    gl.uniform2i(
      resources.fieldDiffusionUniforms.fieldDimensions,
      resources.fieldColumns,
      resources.fieldRows,
    );
    scratch.diffusionColumns = resources.fieldColumns;
    scratch.diffusionRows = resources.fieldRows;
  }
  while (passAmounts.some((amount) => amount > 1e-6)) {
    for (let index = 0; index < resources.branchCount; index++) {
      strengths[index] = Math.min(1, passAmounts[index] ?? 0);
    }
    const targetIndex = oppositeFieldIndex(sourceIndex);
    resources.bindFieldFramebuffer(targetIndex);
    gl.bindTexture(gl.TEXTURE_2D, resources.fieldTextures[sourceIndex]);
    gl.uniform1fv(resources.fieldDiffusionUniforms.strengths, strengths);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    sourceIndex = targetIndex;
    for (let index = 0; index < resources.branchCount; index++) {
      passAmounts[index] = Math.max(
        0,
        (passAmounts[index] ?? 0) - (strengths[index] ?? 0),
      );
    }
  }
  if (brushPerfDebug.enabled) {
    brushPerfDebug.recordStage("gpuFieldUpdate", startedAt);
  }
  return sourceIndex;
}

interface AllocateFieldStripOptions {
  readonly gl: WebGL2RenderingContext;
  readonly columns: number;
  readonly rows: number;
  readonly branchCount: number;
  readonly currentWidth: number;
  readonly currentHeight: number;
  readonly useFloatField: boolean;
  readonly textures: readonly [WebGLTexture, WebGLTexture];
  readonly bindFramebuffer: (index: 0 | 1) => void;
  readonly forceRecord: boolean;
}

export function allocateFieldStrip(
  options: AllocateFieldStripOptions,
): { readonly width: number; readonly height: number } | null {
  const requiredHeight = options.rows * options.branchCount;
  if (
    options.columns <= options.currentWidth &&
    requiredHeight <= options.currentHeight
  ) {
    return null;
  }
  const width = Math.max(options.columns, options.currentWidth);
  const height = Math.max(requiredHeight, options.currentHeight);
  const { gl } = options;
  const internalFormat = options.useFloatField ? gl.RGBA16F : gl.RGBA8;
  const type = options.useFloatField ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  for (let index = 0; index < options.textures.length; index++) {
    gl.bindTexture(gl.TEXTURE_2D, options.textures[index]);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      gl.RGBA,
      type,
      null,
    );
    options.bindFramebuffer(index as 0 | 1);
  }
  perfMark("realloc:fieldStrip", {
    width,
    height,
    forceRecord: options.forceRecord,
  });
  return { width, height };
}
