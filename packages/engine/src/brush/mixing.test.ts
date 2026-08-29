import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH_MIXING } from "../types";
import { getActiveMixing } from "./mixing";

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
