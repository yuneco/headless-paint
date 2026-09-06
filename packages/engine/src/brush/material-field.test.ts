import { describe, expect, it } from "vitest";
import {
  advanceMaterialField,
  createMaterialField,
  writeMaterialFieldPixels,
} from "./material-field";
import { sampleRotatedCheckpoint } from "./mixing";

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE_SAMPLE = new Uint8ClampedArray([0, 0, 255, 255]);

describe("material field", () => {
  it("keeps yellow baseColor when mixing repeatedly across transparent substrate", () => {
    const yellow = { r: 255, g: 255, b: 80, a: 255 };
    const checkpoint: ImageData = {
      width: 2,
      height: 1,
      colorSpace: "srgb",
      data: new Uint8ClampedArray([255, 255, 80, 255, 0, 0, 0, 0]),
    };
    // Three field cells sample opaque yellow, the half-alpha edge, and clear.
    const sampled = sampleRotatedCheckpoint(
      checkpoint,
      0,
      0,
      1,
      0.5,
      0,
      1.5,
      3,
      1,
    );
    const initial = createMaterialField(3, 1, yellow);
    let field = initial;
    for (let step = 0; step < 20; step++) {
      field = advanceMaterialField(field, sampled, 3, 1, yellow, {
        pickupRatePerPx: 1,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0.05,
        distancePx: 15,
      });
    }
    expect(field).toEqual(initial);
  });

  it("pickup/restoreは距離で正規化される", () => {
    const initial = createMaterialField(1, 1, RED);
    const oneStep = advanceMaterialField(initial, BLUE_SAMPLE, 1, 1, RED, {
      pickupRatePerPx: 0.02,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
      distancePx: 10,
    });

    const firstHalf = advanceMaterialField(initial, BLUE_SAMPLE, 1, 1, RED, {
      pickupRatePerPx: 0.02,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
      distancePx: 5,
    });
    const twoSteps = advanceMaterialField(firstHalf, BLUE_SAMPLE, 1, 1, RED, {
      pickupRatePerPx: 0.02,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
      distancePx: 5,
    });

    for (let i = 0; i < oneStep.length; i++) {
      expect(twoSteps[i]).toBeCloseTo(oneStep[i] ?? 0, 5);
    }
    expect(Array.from(initial)).toEqual([255, 0, 0, 255]);
  });

  it("diffusionは局所色差を小さくする", () => {
    const initial = createMaterialField(3, 1, RED);
    const sample = new Uint8ClampedArray([
      0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255,
    ]);
    const picked = advanceMaterialField(initial, sample, 3, 1, RED, {
      pickupRatePerPx: 10,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
      distancePx: 1,
    });
    const diffused = advanceMaterialField(picked, sample, 3, 1, RED, {
      pickupRatePerPx: 0,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 1,
      distancePx: 1,
    });

    expect(diffused[2]).toBeLessThan(picked[2] ?? 0);
    expect(diffused[6]).toBeGreaterThan(picked[6] ?? 0);
  });

  it("透明sampleは保持色へ影響しない", () => {
    const initial = createMaterialField(1, 1, RED);
    const result = advanceMaterialField(
      initial,
      new Uint8ClampedArray([0, 0, 255, 0]),
      1,
      1,
      RED,
      {
        pickupRatePerPx: 10,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        distancePx: 1,
      },
    );
    expect(Array.from(result)).toEqual([255, 0, 0, 255]);
  });

  it("float fieldをImageData用byteへclampする", () => {
    const pixels = new Uint8ClampedArray(4);
    writeMaterialFieldPixels(new Float32Array([-1, 12.4, 260, 254.6]), pixels);
    expect(Array.from(pixels)).toEqual([0, 12, 255, 255]);
  });
});
