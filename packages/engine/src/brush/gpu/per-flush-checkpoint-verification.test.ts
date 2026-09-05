import { describe, expect, it, vi } from "vitest";
import { createLayer } from "../../layer";
import { DEFAULT_BRUSH_MIXING } from "../../types";
import { writeMaterialFieldPixels } from "../material-field";
import {
  type MixingUpdateInput,
  finalizeBristleMixingCheckpoint,
  prepareBristleMixingFlush,
  prepareMixingState,
  stageBristleMixingCheckpoint,
} from "../mixing";
import {
  type GpuBristleChunk,
  createGpuStrokeSurface,
} from "./gpu-stroke-surface";

// The first run reads the carried image; only subsequent runs switch to F0.
describe("perFlush carried checkpoint parity contract", () => {
  it.each([
    {
      label: "unchanged substrate",
      paintAfterCheckpoint: false,
      capture: true,
    },
    {
      label: "no in-flush checkpoint",
      paintAfterCheckpoint: true,
      capture: false,
    },
    {
      label: "carried white vs flush-start black",
      paintAfterCheckpoint: true,
      capture: true,
    },
  ])("$label", ({ paintAfterCheckpoint, capture }) => {
    const result = measureCheckpointMismatch({
      paintAfterCheckpoint,
      capture,
      pickupRatePerPx: 0.17,
      tailDistance: 4,
    });
    expect(result.rgbMae).toBeLessThanOrEqual(1 / 255);
    expect(result.maxChannelDelta).toBeLessThanOrEqual(1);
    expect(result.largeDeltaRate).toBe(0);
  });

  it("matches with saturated early pickup and a short tail", () => {
    const result = measureCheckpointMismatch({
      paintAfterCheckpoint: true,
      capture: true,
      pickupRatePerPx: 1,
      tailDistance: 0.01,
    });
    expect(result.rgbMae).toBeLessThanOrEqual(1 / 255);
    expect(result.maxChannelDelta).toBeLessThanOrEqual(1);
    expect(result.largeDeltaRate).toBe(0);
  });
});

describe("perFlush checkpoint copy elision", () => {
  it.each([1, 2])(
    "copies only the last checkpoint per branch (%i branches), at its composite",
    (branchCount) => {
      const layer = createLayer(256, 256);
      layer.ctx.fillStyle = "white";
      layer.ctx.fillRect(0, 0, 256, 256);
      const tip = new OffscreenCanvas(2, 32);
      const ctx = tip.getContext("2d");
      if (!ctx) throw new Error("Missing tip context");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 2, 32);
      const surface = createGpuStrokeSurface(256, 256, "bitmap", "perFlush");
      if (!surface) throw new Error("WebGL2 is required");
      // Observe actual image copies, not the metadata-only checkpoint requests.
      const copies = vi.spyOn(
        surface as unknown as {
          copySurfaceCheckpointToPerFlushAtlas(...args: unknown[]): void;
        },
        "copySurfaceCheckpointToPerFlushAtlas",
      );
      const gray = { r: 128, g: 128, b: 128, a: 255 };
      const update = {
        baseColor: gray,
        centerX: 128,
        centerY: 128,
        angle: 0,
        sampleSize: 8,
        columns: 4,
        rows: 4,
        pickupRatePerPx: 0,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        distancePx: 32,
      };
      const black = makeUniformChunk(tip, 255);
      const white = { ...black, color: { r: 255, g: 255, b: 255, a: 255 } };
      try {
        surface.beginStroke(layer.canvas, branchCount);
        for (let branch = 0; branch < branchCount; branch++) {
          surface.selectBranch(branch);
          surface.initializeMaterialField(4, 4, gray);
          surface.initializeMaterialCheckpoint(88, 88, 80);
        }
        surface.beginBranchBatch();
        for (let branch = 0; branch < branchCount; branch++) {
          surface.selectBranch(branch);
          for (const chunk of [black, white, black]) {
            surface.pushBristleChunk(chunk);
            surface.updateMaterialField(update);
            surface.snapshotMaterialCheckpoint(88, 88, 80);
          }
          // The final checkpoint must remain black even though the flush ends white.
          surface.pushBristleChunk(white);
        }
        surface.endBranchBatch();
        expect(copies).toHaveBeenCalledTimes(branchCount);
        surface.commitToLayer(layer);
        expect(Array.from(layer.ctx.getImageData(128, 128, 1, 1).data)).toEqual(
          [255, 255, 255, 255],
        );
        surface.beginBranchBatch();
        for (let branch = 0; branch < branchCount; branch++) {
          surface.selectBranch(branch);
          surface.pushBristleChunk(makeUniformChunk(tip, 0));
          surface.updateMaterialField({ ...update, pickupRatePerPx: 1 });
        }
        surface.endBranchBatch();
        for (let branch = 0; branch < branchCount; branch++) {
          const pixels = surface.readMaterialFieldForTest(branch);
          for (let offset = 0; offset < pixels.length; offset += 4) {
            expect(Array.from(pixels.slice(offset, offset + 4))).toEqual([
              0, 0, 0, 255,
            ]);
          }
        }
      } finally {
        copies.mockRestore();
        surface.dispose();
      }
    },
  );
});

function measureCheckpointMismatch(options: {
  readonly paintAfterCheckpoint: boolean;
  readonly capture: boolean;
  readonly pickupRatePerPx: number;
  readonly tailDistance: number;
}) {
  const source = createLayer(256, 256);
  source.ctx.fillStyle = "white";
  source.ctx.fillRect(0, 0, 256, 256);
  const target = createLayer(256, 256);
  target.ctx.drawImage(source.canvas, 0, 0);
  const baseColor = { r: 128, g: 128, b: 128, a: 255 } as const;
  const tip = new OffscreenCanvas(2, 32);
  const tipCtx = tip.getContext("2d");
  if (!tipCtx) throw new Error("Missing test tip context");
  tipCtx.fillStyle = "white";
  tipCtx.fillRect(0, 0, 2, 32);
  const mixing = {
    ...DEFAULT_BRUSH_MIXING,
    enabled: true,
    fieldColumns: 4,
    fieldRows: 4,
    pickupRatePerPx: options.pickupRatePerPx,
    restoreRatePerPx: 0,
    diffusionRatePerPx: 0,
    updateDistancePx: 32,
    checkpointDistancePx: 32,
  } as const;
  const input: MixingUpdateInput = {
    tipCanvas: tip,
    baseColor,
    x: 128,
    y: 128,
    directionX: 1,
    directionY: 0,
    stampSize: 8,
    checkpointFootprintSize: 8,
    stampDistance: 32,
    sourceLayer: source,
    targetLayer: target,
    mixing,
    state: undefined,
  };
  // Same footprint on both backends; integral origins avoid resampling noise.
  const tileSize = Math.ceil(8 * Math.SQRT2 + 32 * 2 + 4);
  const tileOrigin = 128 - tileSize / 2;
  const surface = createGpuStrokeSurface(256, 256, "bitmap", "perFlush");
  if (!surface) throw new Error("WebGL2 is required for this verification");
  const chunk = makeUniformChunk(tip, 0);
  const gpuUpdate = {
    baseColor,
    centerX: 128,
    centerY: 128,
    angle: 0,
    sampleSize: 8,
    columns: 4,
    rows: 4,
    pickupRatePerPx: mixing.pickupRatePerPx,
    restoreRatePerPx: 0,
    diffusionRatePerPx: 0,
    distancePx: 32,
  } as const;
  try {
    surface.beginStroke(source.canvas);
    surface.initializeMaterialField(4, 4, baseColor);
    surface.initializeMaterialCheckpoint(tileOrigin, tileOrigin, tileSize);

    // Flush 1: zero pickup keeps both fields gray. Capture white at distance 32,
    // then deposit black over the sampled footprint AFTER that checkpoint.
    const firstInput = {
      ...input,
      mixing: { ...mixing, pickupRatePerPx: 0 },
    };
    const first = prepareBristleMixingFlush(
      [firstInput],
      prepareMixingState(tip, baseColor, mixing, undefined),
    );
    expect(first.updates[0]?.capturesCheckpoint).toBe(true);
    const carried = finalizeBristleMixingCheckpoint(
      stageBristleMixingCheckpoint(firstInput, first.state),
    );
    surface.beginBranchBatch();
    surface.pushBristleChunk(chunk);
    surface.updateMaterialField({ ...gpuUpdate, pickupRatePerPx: 0 });
    surface.snapshotMaterialCheckpoint(tileOrigin, tileOrigin, tileSize);
    surface.pushBristleChunk(
      makeUniformChunk(tip, options.paintAfterCheckpoint ? 255 : 0),
    );
    surface.endBranchBatch();
    surface.commitToLayer(target);

    // Use the actual GPU output as CPU target input to exclude mask/raster
    // differences entirely. Only snapshot time differs in the measured flush.
    const flushStart = target.ctx.getImageData(124, 124, 8, 8).data;
    const expectedSubstrate = options.paintAfterCheckpoint ? 0 : 255;
    for (let offset = 0; offset < flushStart.length; offset += 4) {
      expect(Array.from(flushStart.slice(offset, offset + 4))).toEqual([
        expectedSubstrate,
        expectedSubstrate,
        expectedSubstrate,
        255,
      ]);
    }
    expect(carried.checkpointPixels?.data[0]).toBe(255);
    const initialPixels = new Uint8ClampedArray(carried.field.length);
    writeMaterialFieldPixels(carried.field, initialPixels);
    expect(surface.readMaterialFieldForTest()).toEqual(initialPixels);

    // Flush 2: the first run still owes a pickup from the carried white tile.
    // A checkpoint after that run makes only the second run sample F0 (black).
    const secondMixing = {
      ...mixing,
      checkpointDistancePx: options.capture ? 32 : 64,
    };
    const cpu = prepareBristleMixingFlush(
      [64, 64 + options.tailDistance].map((stampDistance) => ({
        ...input,
        mixing: secondMixing,
        stampDistance,
      })),
      carried,
    );
    expect(cpu.updates.map((update) => update.capturesCheckpoint)).toEqual([
      options.capture,
      false,
    ]);
    surface.beginBranchBatch();
    surface.pushBristleChunk(chunk);
    surface.updateMaterialField(gpuUpdate);
    if (options.capture) {
      surface.snapshotMaterialCheckpoint(tileOrigin, tileOrigin, tileSize);
    }
    surface.pushBristleChunk(chunk);
    surface.updateMaterialField({
      ...gpuUpdate,
      distancePx: options.tailDistance,
    });
    surface.endBranchBatch();
    const gpuPixels = surface.readMaterialFieldForTest();
    const cpuPixels = new Uint8ClampedArray(cpu.state.field.length);
    writeMaterialFieldPixels(cpu.state.field, cpuPixels);

    // Independent closed-form oracle: gray -> carried white -> F0 substrate.
    const afterEarlyPickup =
      255 - 127 * Math.exp(-options.pickupRatePerPx * 32);
    const tailSource = options.capture ? expectedSubstrate : 255;
    const expectedGpu =
      tailSource +
      (afterEarlyPickup - tailSource) *
        Math.exp(-options.pickupRatePerPx * options.tailDistance);
    let rgbDelta = 0;
    let maxChannelDelta = 0;
    let largeDeltaPixels = 0;
    for (let offset = 0; offset < gpuPixels.length; offset += 4) {
      let pixelDelta = 0;
      for (let channel = 0; channel < 3; channel++) {
        expect(
          Math.abs(gpuPixels[offset + channel] - expectedGpu),
        ).toBeLessThanOrEqual(1);
        const delta = Math.abs(
          cpuPixels[offset + channel] - gpuPixels[offset + channel],
        );
        rgbDelta += delta;
        pixelDelta = Math.max(pixelDelta, delta);
      }
      expect(cpuPixels[offset + 3]).toBe(255);
      expect(gpuPixels[offset + 3]).toBe(255);
      maxChannelDelta = Math.max(maxChannelDelta, pixelDelta);
      if (pixelDelta / 255 > 0.1) largeDeltaPixels++;
    }
    return {
      cpu: Array.from(cpuPixels.slice(0, 4)),
      gpu: Array.from(gpuPixels.slice(0, 4)),
      rgbMae: rgbDelta / (gpuPixels.length / 4) / 3 / 255,
      maxChannelDelta,
      largeDeltaRate: largeDeltaPixels / (gpuPixels.length / 4),
    };
  } finally {
    surface.dispose();
  }
}

function makeUniformChunk(
  profileAtlas: OffscreenCanvas,
  alpha: number,
): GpuBristleChunk {
  return {
    segments: [
      {
        fromX: 108,
        fromY: 128,
        toX: 148,
        toY: 128,
        fromFrameX: 1,
        fromFrameY: 0,
        toFrameX: 1,
        toFrameY: 0,
        fromPressure: 1,
        toPressure: 1,
        fromDistance: 0,
        toDistance: 1,
        fromFieldColumn: 0,
        toFieldColumn: 1,
        overlap: 1,
        trialId: 0,
      },
    ],
    maskField: new Float32Array([1, 1, 1, 1]),
    maskFieldColumns: 2,
    maskFieldRows: 2,
    profileAtlas,
    grain: {
      amount: 0,
      softness: 0.1,
      grainSeed: 1,
      strokeSeed: 2,
      toothHeights: new Float32Array(128 * 128),
    },
    bboxRect: { left: 100, top: 100, right: 156, bottom: 156 },
    brushSize: 32,
    depositHardness: 1,
    color: { r: 0, g: 0, b: 0, a: alpha },
    useMaterialField: false,
  };
}
