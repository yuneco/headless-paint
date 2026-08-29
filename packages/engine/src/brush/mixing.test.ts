import { describe, expect, it } from "vitest";
import { createLayer } from "../layer";
import { DEFAULT_BRUSH_MIXING } from "../types";
import {
  advanceMixingFieldFromCheckpoint,
  applyCompletedGpuCheckpoint,
  getActiveMixing,
  prepareMixingState,
} from "./mixing";

describe("getActiveMixing", () => {
  it("disables the complete mixing stage when pickup is zero", () => {
    expect(
      getActiveMixing({
        ...DEFAULT_BRUSH_MIXING,
        enabled: true,
        pickupRatePerPx: 0,
        restoreRatePerPx: 1,
        diffusionRatePerPx: 1,
      }),
    ).toBeNull();
  });

  it("keeps restore and diffusion when pickup can load canvas color", () => {
    expect(
      getActiveMixing({
        ...DEFAULT_BRUSH_MIXING,
        enabled: true,
        pickupRatePerPx: 0.01,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
      }),
    ).toMatchObject({
      pickupRatePerPx: 0.01,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
    });
  });
});

describe("async GPU checkpoint integration", () => {
  it("completed tile を取り込むと field が下地色へ変化する", () => {
    const width = 16;
    const height = 16;
    const completedPixels = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < completedPixels.length; offset += 4) {
      completedPixels.set([230, 20, 10, 255], offset);
    }
    const mixing = {
      ...DEFAULT_BRUSH_MIXING,
      enabled: true,
      pickupRatePerPx: 1,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
      updateDistancePx: 1,
      fieldColumns: 2,
      fieldRows: 2,
    };
    const baseColor = { r: 10, g: 20, b: 230, a: 255 };
    const tipCanvas = new OffscreenCanvas(4, 4);
    const initial = prepareMixingState(tipCanvas, baseColor, mixing, undefined);
    const withCheckpoint = applyCompletedGpuCheckpoint(initial, {
      originX: 0,
      originY: 0,
      width,
      height,
      pixels: completedPixels,
    });
    const sourceLayer = createLayer(width, height);
    const field = advanceMixingFieldFromCheckpoint(
      {
        tipCanvas,
        baseColor,
        x: 8,
        y: 8,
        directionX: 1,
        directionY: 0,
        stampSize: 4,
        checkpointFootprintSize: 4,
        stampDistance: 1,
        sourceLayer,
        targetLayer: sourceLayer,
        mixing,
        state: withCheckpoint,
      },
      withCheckpoint,
      1,
    );

    expect(withCheckpoint.checkpointOriginX).toBe(0);
    expect(withCheckpoint.checkpointOriginY).toBe(0);
    expect(field[0]).toBeGreaterThan(baseColor.r);
    expect(field[2]).toBeLessThan(baseColor.b);
  });
});
