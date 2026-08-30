import { perfMark, perfSample } from "../perf-debug";
import { roundUpGpuAllocation } from "./field-strip";
import type { GpuDab, GpuMaterialFieldUpdate } from "./gpu-stroke-surface";

export interface MaterialCheckpoint {
  textureSize: number;
  originX: number;
  originY: number;
  initialized: boolean;
}

export interface PendingMaterialCheckpointCapture {
  readonly originX: number;
  readonly originY: number;
  readonly size: number;
  readonly fromStrokeStart: boolean;
}

export interface PendingBranchSegment {
  readonly dabs: GpuDab[];
  update?: GpuMaterialFieldUpdate;
  checkpoint?: PendingMaterialCheckpointCapture;
}

export function ensureMaterialCheckpoints(
  checkpoints: MaterialCheckpoint[],
  count: number,
): void {
  while (checkpoints.length < count) {
    checkpoints.push({
      textureSize: 0,
      originX: 0,
      originY: 0,
      initialized: false,
    });
  }
}

export function queueMaterialCheckpoint(
  pendingBranchSegments: PendingBranchSegment[][] | null,
  branchIndex: number,
  capture: PendingMaterialCheckpointCapture,
): boolean {
  const branchSegments = pendingBranchSegments?.[branchIndex];
  if (!branchSegments) return false;
  const segment = branchSegments[branchSegments.length - 1];
  if (!segment) throw new Error("GPU branch segment is unavailable");
  const previous = branchSegments[branchSegments.length - 2];
  if (
    !capture.fromStrokeStart &&
    segment.dabs.length === 0 &&
    segment.update === undefined &&
    previous?.update !== undefined &&
    previous.checkpoint === undefined
  ) {
    previous.checkpoint = capture;
    return true;
  }
  if (segment.checkpoint) {
    throw new Error("GPU branch segment already has a checkpoint");
  }
  segment.checkpoint = capture;
  branchSegments.push({ dabs: [] });
  return true;
}

interface CaptureMaterialCheckpointsOptions {
  readonly captures: readonly (PendingMaterialCheckpointCapture | undefined)[];
  readonly gl: WebGL2RenderingContext;
  readonly width: number;
  readonly height: number;
  readonly branchCount: number;
  readonly checkpoints: MaterialCheckpoint[];
  readonly checkpointTexture: WebGLTexture;
  readonly checkpointFramebuffer: WebGLFramebuffer;
  readonly accumFramebuffer: WebGLFramebuffer;
  readonly strokeStartFramebuffer: WebGLFramebuffer;
  readonly allocatedTextureSize: number;
  readonly allocatedLayerCount: number;
  readonly flush: () => void;
  readonly updateAllocation: (textureSize: number, layerCount: number) => void;
}

export function captureMaterialCheckpoints(
  options: CaptureMaterialCheckpointsOptions,
): void {
  options.flush();
  const requestedTileSize = options.captures.reduce(
    (maximum, capture) =>
      capture
        ? Math.max(maximum, Math.max(1, Math.floor(capture.size)))
        : maximum,
    0,
  );
  if (requestedTileSize === 0) return;
  const { gl } = options;
  if (
    requestedTileSize > options.allocatedTextureSize ||
    options.branchCount > options.allocatedLayerCount
  ) {
    const allocatedTileSize = roundUpGpuAllocation(
      Math.max(requestedTileSize, options.allocatedTextureSize),
    );
    const allocatedLayerCount = Math.max(
      options.branchCount,
      options.allocatedLayerCount,
    );
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, options.checkpointTexture);
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA8,
      allocatedTileSize,
      allocatedTileSize,
      allocatedLayerCount,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    perfMark("realloc:snapshotArray", {
      width: allocatedTileSize,
      height: allocatedTileSize,
      depth: allocatedLayerCount,
      forceRecord: options.captures.some((capture) => capture?.fromStrokeStart),
    });
    options.updateAllocation(allocatedTileSize, allocatedLayerCount);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, options.checkpointFramebuffer);
    gl.framebufferTextureLayer(
      gl.DRAW_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      options.checkpointTexture,
      0,
      0,
    );
    if (
      gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
    ) {
      throw new Error("GPU material checkpoint framebuffer is incomplete");
    }
    for (const checkpoint of options.checkpoints) {
      checkpoint.initialized = false;
    }
  }

  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  for (let branchIndex = 0; branchIndex < options.branchCount; branchIndex++) {
    const capture = options.captures[branchIndex];
    if (!capture) continue;
    const checkpoint = options.checkpoints[branchIndex];
    if (!checkpoint) {
      throw new Error("GPU material checkpoint is unavailable");
    }
    const branchTileSize = Math.max(1, Math.floor(capture.size));
    checkpoint.textureSize = branchTileSize;
    checkpoint.originX = capture.originX;
    checkpoint.originY = capture.originY;
    checkpoint.initialized = true;
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, options.checkpointFramebuffer);
    gl.framebufferTextureLayer(
      gl.DRAW_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      options.checkpointTexture,
      0,
      branchIndex,
    );
    gl.clear(gl.COLOR_BUFFER_BIT);

    const readOriginX = Math.floor(capture.originX);
    const readOriginY = Math.floor(capture.originY);
    const left = Math.max(0, readOriginX);
    const top = Math.max(0, readOriginY);
    const right = Math.min(options.width, readOriginX + branchTileSize);
    const bottom = Math.min(options.height, readOriginY + branchTileSize);
    if (right <= left || bottom <= top) continue;
    gl.bindFramebuffer(
      gl.READ_FRAMEBUFFER,
      capture.fromStrokeStart
        ? options.strokeStartFramebuffer
        : options.accumFramebuffer,
    );
    gl.blitFramebuffer(
      left,
      options.height - bottom,
      right,
      options.height - top,
      left - readOriginX,
      branchTileSize - (bottom - readOriginY),
      right - readOriginX,
      branchTileSize - (top - readOriginY),
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, options.accumFramebuffer);
  gl.viewport(0, 0, options.width, options.height);
  perfSample(
    "checkpoints",
    options.captures.filter((capture) => capture !== undefined).length,
  );
}
