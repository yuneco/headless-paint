import type { Layer } from "../../types";
import { brushPerfDebug, perfMark, perfSample } from "../perf-debug";

export const COMMIT_TILE_SIZE = 512;
export const COMMIT_CANVAS_SIZE = 1024;

export interface DirtyRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CommitTile extends DirtyRect {
  readonly width: number;
  readonly height: number;
}

export interface PackedCommitTile extends CommitTile {
  readonly packedX: number;
  readonly packedY: number;
}

export function unionDirtyRects(
  rects: readonly (DirtyRect | null)[],
): DirtyRect | null {
  let union: DirtyRect | null = null;
  for (const rect of rects) {
    if (!rect) continue;
    if (!union) {
      union = { ...rect };
      continue;
    }
    union.left = Math.min(union.left, rect.left);
    union.top = Math.min(union.top, rect.top);
    union.right = Math.max(union.right, rect.right);
    union.bottom = Math.max(union.bottom, rect.bottom);
  }
  return union;
}

export function createCommitTiles(rect: DirtyRect): CommitTile[] {
  const tiles: CommitTile[] = [];
  for (let top = rect.top; top < rect.bottom; top += COMMIT_TILE_SIZE) {
    const bottom = Math.min(rect.bottom, top + COMMIT_TILE_SIZE);
    for (let left = rect.left; left < rect.right; left += COMMIT_TILE_SIZE) {
      const right = Math.min(rect.right, left + COMMIT_TILE_SIZE);
      tiles.push({
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
      });
    }
  }
  return tiles;
}

export function packCommitRound(
  tiles: readonly CommitTile[],
  startIndex: number,
): PackedCommitTile[] {
  const packed: PackedCommitTile[] = [];
  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  for (let index = startIndex; index < tiles.length; index++) {
    const tile = tiles[index];
    if (!tile) break;
    if (shelfX + tile.width > COMMIT_CANVAS_SIZE) {
      shelfY += shelfHeight;
      shelfX = 0;
      shelfHeight = 0;
    }
    if (shelfY + tile.height > COMMIT_CANVAS_SIZE) break;
    packed.push({ ...tile, packedX: shelfX, packedY: shelfY });
    shelfX += tile.width;
    shelfHeight = Math.max(shelfHeight, tile.height);
  }
  if (packed.length === 0 && startIndex < tiles.length) {
    throw new Error("GPU commit tile does not fit the commit canvas");
  }
  return packed;
}

export function blitCommitPass(
  gl: WebGL2RenderingContext,
  sourceFramebuffer: WebGLFramebuffer,
  sourceHeight: number,
  tiles: readonly PackedCommitTile[],
): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFramebuffer);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  for (const tile of tiles) {
    gl.blitFramebuffer(
      tile.left,
      sourceHeight - tile.bottom,
      tile.right,
      sourceHeight - tile.top,
      tile.packedX,
      COMMIT_CANVAS_SIZE - tile.packedY - tile.height,
      tile.packedX + tile.width,
      COMMIT_CANVAS_SIZE - tile.packedY,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
  }
  gl.flush();
}

export function drawCommitTiles(
  layer: Layer,
  source: ImageBitmap | OffscreenCanvas,
  tiles: readonly PackedCommitTile[],
): void {
  for (const tile of tiles) {
    layer.ctx.save();
    try {
      layer.ctx.globalAlpha = 1;
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.beginPath();
      layer.ctx.rect(tile.left, tile.top, tile.width, tile.height);
      layer.ctx.clip();
      layer.ctx.globalCompositeOperation = "copy";
      layer.ctx.drawImage(
        source,
        tile.packedX,
        tile.packedY,
        tile.width,
        tile.height,
        tile.left,
        tile.top,
        tile.width,
        tile.height,
      );
    } finally {
      layer.ctx.restore();
    }
  }
}

interface CommitRectsOptions {
  readonly layer: Layer;
  readonly rects: readonly DirtyRect[];
  readonly gl: WebGL2RenderingContext;
  readonly framebuffer: WebGLFramebuffer;
  readonly sourceHeight: number;
  readonly canvas: OffscreenCanvas;
  readonly mode: "bitmap" | "direct";
}

/** One pass owns the default framebuffer until transferred or discarded. */
export interface PendingGpuCommit {
  readonly fence: WebGLSync;
  readonly options: CommitRectsOptions;
  readonly tiles: readonly PackedCommitTile[];
}

/** The caller must drain any previous pending pass before calling this. */
export function commitRectsToLayer(
  options: CommitRectsOptions,
  defer = false,
): PendingGpuCommit | null {
  const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
  const commitTiles = options.rects.flatMap(createCommitTiles);
  const committedPixels = commitTiles.reduce(
    (total, tile) => total + tile.width * tile.height,
    0,
  );
  let tileIndex = 0;
  let commitPasses = 0;
  let bitmapMs = 0;
  let drawMs = 0;
  let deferred = false;
  try {
    while (tileIndex < commitTiles.length) {
      const packed = packCommitRound(commitTiles, tileIndex);
      commitPasses++;
      blitCommitPass(
        options.gl,
        options.framebuffer,
        options.sourceHeight,
        packed,
      );
      // Multiple passes share the same canvas. Keep the entire commit synchronous.
      if (
        defer &&
        options.mode === "bitmap" &&
        packed.length === commitTiles.length &&
        typeof options.canvas.transferToImageBitmap === "function"
      ) {
        const fence = options.gl.fenceSync(
          options.gl.SYNC_GPU_COMMANDS_COMPLETE,
          0,
        );
        if (fence) {
          // Submit the fence as well as the blit; polling itself never flushes.
          options.gl.flush();
          deferred = true;
          return { fence, options, tiles: packed };
        }
      }
      const timing = transferCommitPass(options, packed, true);
      bitmapMs += timing.bitmapMs;
      drawMs += timing.drawMs;
      tileIndex += packed.length;
    }
    return null;
  } finally {
    if (brushPerfDebug.enabled) {
      perfSample("gpuCommitPixels", committedPixels);
      perfSample("gpuCommitDraws", commitTiles.length);
      if (!deferred)
        perfMark("gpuCommit", {
          mode: options.mode,
          passes: commitPasses,
          pixels: committedPixels,
          bitmapMs: Number(bitmapMs.toFixed(3)),
          drawMs: Number(drawMs.toFixed(3)),
        });
      brushPerfDebug.recordStage("gpuCommit", startedAt);
    }
  }
}

export function transferPendingCommit(
  pending: PendingGpuCommit,
  drain: boolean,
): void {
  const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
  try {
    const timing = transferCommitPass(pending.options, pending.tiles, drain);
    if (brushPerfDebug.enabled) {
      perfMark("gpuCommit", {
        mode: pending.options.mode,
        passes: 1,
        pixels: pending.tiles.reduce(
          (total, tile) => total + tile.width * tile.height,
          0,
        ),
        bitmapMs: Number(timing.bitmapMs.toFixed(3)),
        drawMs: Number(timing.drawMs.toFixed(3)),
      });
    }
  } finally {
    pending.options.gl.deleteSync(pending.fence);
    if (brushPerfDebug.enabled)
      brushPerfDebug.recordStage("gpuCommit", startedAt);
  }
}

function transferCommitPass(
  options: CommitRectsOptions,
  packed: readonly PackedCommitTile[],
  finish: boolean,
): { readonly bitmapMs: number; readonly drawMs: number } {
  let bitmap: ImageBitmap | null = null;
  let bitmapMs = 0;
  if (
    options.mode === "bitmap" &&
    typeof options.canvas.transferToImageBitmap === "function"
  ) {
    const bitmapStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
    try {
      // WebKit needs either a signaled fence or finish before transferring.
      if (finish) options.gl.finish();
      bitmap = options.canvas.transferToImageBitmap();
    } catch {
      blitCommitPass(
        options.gl,
        options.framebuffer,
        options.sourceHeight,
        packed,
      );
    }
    if (brushPerfDebug.enabled) bitmapMs = performance.now() - bitmapStartedAt;
  }
  if (
    bitmap &&
    (bitmap.width !== COMMIT_CANVAS_SIZE ||
      bitmap.height !== COMMIT_CANVAS_SIZE)
  ) {
    bitmap.close();
    bitmap = null;
    blitCommitPass(
      options.gl,
      options.framebuffer,
      options.sourceHeight,
      packed,
    );
  }
  const drawStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
  try {
    if (bitmap) {
      try {
        drawCommitTiles(options.layer, bitmap, packed);
      } catch {
        bitmap.close();
        bitmap = null;
        blitCommitPass(
          options.gl,
          options.framebuffer,
          options.sourceHeight,
          packed,
        );
        drawCommitTiles(options.layer, options.canvas, packed);
      }
    } else {
      drawCommitTiles(options.layer, options.canvas, packed);
    }
  } finally {
    bitmap?.close();
  }
  return {
    bitmapMs,
    drawMs: brushPerfDebug.enabled ? performance.now() - drawStartedAt : 0,
  };
}
