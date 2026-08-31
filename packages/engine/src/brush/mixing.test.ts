import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH_MIXING } from "../types";
import {
  getActiveMixing,
  prepareBristleMixingInterpolationProfiles,
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

describe("prepareBristleMixingInterpolationProfiles", () => {
  it("matches an independently uploaded material profile", () => {
    const mixing = { ...DEFAULT_BRUSH_MIXING, fieldColumns: 3, fieldRows: 2 };
    const tip = new OffscreenCanvas(2, 12);
    const tipCtx = tip.getContext("2d");
    if (!tipCtx) throw new Error("test tip context is missing");
    tipCtx.fillStyle = "white";
    tipCtx.fillRect(0, 2, 2, 8);
    const state = prepareMixingState(
      tip,
      { r: 20, g: 40, b: 60, a: 255 },
      mixing,
      undefined,
    );
    const start = Float32Array.from(
      { length: state.field.length },
      (_, index) => index * 7,
    );
    const end = Float32Array.from(
      { length: state.field.length },
      (_, index) => 255 - index * 5,
    );
    const profiles = prepareBristleMixingInterpolationProfiles(
      state,
      tip,
      start,
      end,
      [0.2, 0.8],
    );
    for (const [profileIndex, weight] of [0.2, 0.8].entries()) {
      const actual = profiles?.canvases[profileIndex];
      expect(actual).toBeDefined();
      const field = new OffscreenCanvas(3, 2);
      const fieldCtx = field.getContext("2d");
      if (!fieldCtx) throw new Error("test field context is missing");
      const pixels = fieldCtx.createImageData(3, 2);
      for (let index = 0; index < pixels.data.length; index++) {
        pixels.data[index] = Math.round(
          (start[index] ?? 0) +
            ((end[index] ?? 0) - (start[index] ?? 0)) * weight,
        );
      }
      fieldCtx.putImageData(pixels, 0, 0);
      const expected = new OffscreenCanvas(2, 12);
      const expectedCtx = expected.getContext("2d");
      if (!expectedCtx) throw new Error("test render context is missing");
      expectedCtx.globalCompositeOperation = "copy";
      expectedCtx.drawImage(field, 0, 0, 2, 12);
      expectedCtx.globalCompositeOperation = "destination-in";
      expectedCtx.drawImage(tip, 0, 0);

      expect(actual?.getContext("2d")?.getImageData(0, 0, 2, 12).data).toEqual(
        expectedCtx.getImageData(0, 0, 2, 12).data,
      );
    }
  });
});
