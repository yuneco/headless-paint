import type { BrushBranchRenderState, BrushRenderState } from "../types";
import { hashSeed } from "./prng";

const CONTEXT_CACHE = new WeakMap<
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D
>();

export const DEFAULT_BRUSH_BRANCH_RENDER_STATE: BrushBranchRenderState = {
  accumulatedDistance: 0,
  emissionCount: 0,
};

export const DEFAULT_BRUSH_RENDER_STATE: BrushRenderState = {
  tipCanvas: null,
  seed: 0,
  branches: [DEFAULT_BRUSH_BRANCH_RENDER_STATE],
};

export function createDefaultBrushState(): BrushRenderState {
  return DEFAULT_BRUSH_RENDER_STATE;
}

export function ensureBrushRenderState(
  state: BrushRenderState | undefined,
  branchCount: number,
): BrushRenderState {
  const base = state ?? DEFAULT_BRUSH_RENDER_STATE;
  const count = Math.max(1, branchCount);
  if (base.branches.length >= count) return base;
  return {
    ...base,
    branches: [
      ...base.branches,
      ...Array.from({ length: count - base.branches.length }, () => ({
        ...DEFAULT_BRUSH_BRANCH_RENDER_STATE,
      })),
    ],
  };
}

export function getBranchBrushState(
  state: BrushRenderState | undefined,
  branchIndex: number,
): BrushRenderState {
  const base = ensureBrushRenderState(state, branchIndex + 1);
  return {
    tipCanvas: base.tipCanvas,
    seed: hashSeed(base.seed, branchIndex),
    branches: [base.branches[branchIndex]],
  };
}

export function stateToBranch(state: BrushRenderState): BrushBranchRenderState {
  return state.branches[0] ?? DEFAULT_BRUSH_BRANCH_RENDER_STATE;
}

export function mergeBrushState(
  state: BrushRenderState,
  branches: readonly BrushBranchRenderState[],
): BrushRenderState {
  return {
    tipCanvas: state.tipCanvas,
    seed: state.seed,
    branches,
  };
}

export function cloneBrushRenderState(
  state: BrushRenderState | undefined,
): BrushRenderState | undefined {
  if (!state) return undefined;
  return {
    tipCanvas: state.tipCanvas,
    seed: state.seed,
    branches: state.branches.map((branch) => ({
      accumulatedDistance: branch.accumulatedDistance,
      emissionCount: branch.emissionCount,
      distanceEmissionProgress: branch.distanceEmissionProgress,
      lastTimestamp: branch.lastTimestamp,
      nextTimeEmissionAt: branch.nextTimeEmissionAt,
      bristle: branch.bristle
        ? {
            lastSweepPoint: branch.bristle.lastSweepPoint
              ? { ...branch.bristle.lastSweepPoint }
              : undefined,
            incomingDirectionX: branch.bristle.incomingDirectionX,
            incomingDirectionY: branch.bristle.incomingDirectionY,
            frameSign: branch.bristle.frameSign,
            lag: branch.bristle.lag ? { ...branch.bristle.lag } : undefined,
          }
        : undefined,
      mixing: branch.mixing
        ? {
            field: new Float32Array(branch.mixing.field),
            fieldCanvas: copyCanvas(branch.mixing.fieldCanvas),
            fieldPixels: copyImageData(branch.mixing.fieldPixels),
            renderCanvas: copyCanvas(branch.mixing.renderCanvas),
            checkpointCanvas: branch.mixing.checkpointCanvas
              ? copyCanvas(branch.mixing.checkpointCanvas)
              : undefined,
            checkpointPixels: branch.mixing.checkpointPixels
              ? copyImageData(branch.mixing.checkpointPixels)
              : undefined,
            checkpointOriginX: branch.mixing.checkpointOriginX,
            checkpointOriginY: branch.mixing.checkpointOriginY,
            lastUpdateDistance: branch.mixing.lastUpdateDistance,
            lastCheckpointDistance: branch.mixing.lastCheckpointDistance,
          }
        : undefined,
    })),
  };
}

function copyCanvas(source: OffscreenCanvas): OffscreenCanvas {
  const buffer = new OffscreenCanvas(source.width, source.height);
  const ctx = getCached2dContext(buffer, "brush state canvas clone");
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return buffer;
}

function copyImageData(source: ImageData): ImageData {
  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = getCached2dContext(canvas, "mixing image data clone");
  const copy = ctx.createImageData(source.width, source.height);
  copy.data.set(source.data);
  return copy;
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
