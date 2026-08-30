import { brushPerfDebug, perfMark } from "../perf-debug";
import type { GpuMaterialFieldUpdate } from "./gpu-stroke-surface";
import {
  BRANCH_DATA_BINDING,
  BRANCH_DATA_FLOATS,
  MAX_GPU_STROKE_BRANCHES,
} from "./shader-sources";
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

interface FieldPassResources {
  readonly gl: WebGL2RenderingContext;
  readonly branchCount: number;
  readonly maxBranchCount: number;
  readonly fieldColumns: number;
  readonly fieldRows: number;
  readonly activeFieldIndex: 0 | 1;
  readonly checkpoints: readonly MaterialCheckpoint[];
  readonly fieldTextures: readonly [WebGLTexture, WebGLTexture];
  readonly materialCheckpointTexture: WebGLTexture;
  readonly branchDataBuffer: WebGLBuffer;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly fieldMixProgram: WebGLProgram;
  readonly fieldDiffusionProgram: WebGLProgram;
  readonly bindFieldFramebuffer: (index: 0 | 1) => void;
}

export function executeMaterialFieldMixPass(
  resources: FieldPassResources,
  updates: readonly (GpuMaterialFieldUpdate | undefined)[],
): number {
  const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
  const branchData = new Float32Array(BRANCH_DATA_FLOATS);
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
      branchData.set(
        [
          checkpoint.originX,
          checkpoint.originY,
          checkpoint.textureSize,
          checkpoint.textureSize,
        ],
        checkpointRectsOffset + branchIndex * 4,
      );
    }
    if (!update) continue;
    if (
      update.columns !== resources.fieldColumns ||
      update.rows !== resources.fieldRows
    ) {
      throw new Error("GPU material field batch dimensions do not match");
    }
    const distance = sanitizeNonNegative(update.distancePx);
    branchData.set(
      [
        update.centerX,
        update.centerY,
        update.angle,
        Math.max(1, update.sampleSize),
      ],
      geometryOffset + branchIndex * 4,
    );
    branchData.set(
      [
        clampUnit(update.baseColor.r / 255),
        clampUnit(update.baseColor.g / 255),
        clampUnit(update.baseColor.b / 255),
        clampUnit(update.baseColor.a / 255),
      ],
      baseColorsOffset + branchIndex * 4,
    );
    branchData.set(
      [
        distanceCoefficient(update.pickupRatePerPx, distance),
        distanceCoefficient(update.restoreRatePerPx, distance),
        1,
        0,
      ],
      ratesOffset + branchIndex * 4,
    );
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
  gl.uniform1i(
    gl.getUniformLocation(resources.fieldMixProgram, "uCheckpoints"),
    0,
  );
  gl.uniform1i(
    gl.getUniformLocation(resources.fieldMixProgram, "uPreviousField"),
    1,
  );
  gl.uniform2i(
    gl.getUniformLocation(resources.fieldMixProgram, "uFieldDimensions"),
    resources.fieldColumns,
    resources.fieldRows,
  );
  gl.bindBuffer(gl.UNIFORM_BUFFER, resources.branchDataBuffer);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, branchData);
  gl.bindBufferBase(
    gl.UNIFORM_BUFFER,
    BRANCH_DATA_BINDING,
    resources.branchDataBuffer,
  );
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return startedAt;
}

export function executeMaterialFieldDiffusionPass(
  resources: FieldPassResources,
  updates: readonly (GpuMaterialFieldUpdate | undefined)[],
  startedAt: number,
): 0 | 1 {
  const { gl } = resources;
  const passAmounts = new Float32Array(resources.maxBranchCount);
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
  while (passAmounts.some((amount) => amount > 1e-6)) {
    const strengths = new Float32Array(resources.maxBranchCount);
    for (let index = 0; index < resources.branchCount; index++) {
      strengths[index] = Math.min(1, passAmounts[index] ?? 0);
    }
    const targetIndex = oppositeFieldIndex(sourceIndex);
    resources.bindFieldFramebuffer(targetIndex);
    gl.viewport(
      0,
      0,
      resources.fieldColumns,
      resources.fieldRows * resources.branchCount,
    );
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(resources.fieldDiffusionProgram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, resources.fieldTextures[sourceIndex]);
    gl.uniform1i(
      gl.getUniformLocation(resources.fieldDiffusionProgram, "uPreviousField"),
      1,
    );
    gl.uniform2i(
      gl.getUniformLocation(
        resources.fieldDiffusionProgram,
        "uFieldDimensions",
      ),
      resources.fieldColumns,
      resources.fieldRows,
    );
    gl.uniform1fv(
      gl.getUniformLocation(resources.fieldDiffusionProgram, "uStrengths[0]"),
      strengths,
    );
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
