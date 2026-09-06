import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLayer } from "../layer";
import { DEFAULT_BRUSH_MIXING } from "../types";
import {
  prepareBristleMixingFlush,
  prepareBristleMixingInterpolationProfiles,
  prepareMixingState,
} from "./mixing";

// These unit tests exercise real checkpoint sampling, field updates and profile
// selection. Canvas uploads are stubs; raster correctness stays in mixing.test
// and bristle-mixing-interpolation.test, which require the browser runner.
describe("bristle mixing profile selection", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          readonly width: number,
          readonly height: number,
        ) {}
        getContext() {
          return {
            createImageData: (width: number, height: number): ImageData => ({
              width,
              height,
              colorSpace: "srgb",
              data: new Uint8ClampedArray(width * height * 4),
            }),
            save: vi.fn(),
            restore: vi.fn(),
            setTransform: vi.fn(),
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            putImageData: vi.fn(),
          };
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["unchanged", "red band"] as const)(
    "selects single profiles for an unchanged flush and blends after crossing a red band: %s",
    (substrate) => {
      const layer = createLayer(64, 32);
      const checkpointPixels = layer.ctx.createImageData(64, 32);
      checkpointPixels.data.fill(255);
      if (substrate === "red band") {
        for (let y = 0; y < 32; y++) {
          for (let x = 24; x < 40; x++) {
            const offset = (y * 64 + x) * 4;
            checkpointPixels.data[offset + 1] = 0;
            checkpointPixels.data[offset + 2] = 0;
          }
        }
      }
      const tip = new OffscreenCanvas(2, 12);
      const mixing = {
        ...DEFAULT_BRUSH_MIXING,
        enabled: true,
        pickupRatePerPx: 0.1,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        updateDistancePx: 8,
        checkpointDistancePx: 32,
        fieldColumns: 2,
        fieldRows: 2,
      };
      const baseColor = { r: 255, g: 255, b: 255, a: 255 };
      const initial = {
        ...prepareMixingState(tip, baseColor, mixing, undefined),
        checkpointPixels,
        checkpointOriginX: 0,
        checkpointOriginY: 0,
      };
      const flush = prepareBristleMixingFlush(
        [16, 32, 48].map((x, index) => ({
          tipCanvas: tip,
          baseColor,
          x,
          y: 16,
          directionX: 1,
          directionY: 0,
          stampSize: 8,
          checkpointFootprintSize: 8,
          stampDistance: (index + 1) * 8,
          sourceLayer: layer,
          targetLayer: layer,
          mixing,
          state: initial,
        })),
        initial,
      );
      expect(flush.endField).not.toBe(flush.startField);
      if (substrate === "unchanged") {
        expect(flush.endField).toEqual(flush.startField);
      } else {
        expect(flush.endField[1]).toBeLessThan(flush.startField[1] - 1);
      }
      const profiles = prepareBristleMixingInterpolationProfiles(
        flush.state,
        tip,
        flush.startField,
        flush.endField,
        flush.updates.map((update, index) => [
          flush.updates[index - 1]?.mixWeight ?? 0,
          update.mixWeight,
        ]),
      );
      expect(profiles?.canvases.map((run) => run.length)).toEqual(
        substrate === "unchanged" ? [1, 1, 1] : [2, 2, 2],
      );
    },
  );

  it.each([0, 1, 2, 3])(
    "uses the last texel's channel %i delta and keeps blending at the one-byte boundary",
    (channel) => {
      const tip = new OffscreenCanvas(2, 12);
      const state = prepareMixingState(
        tip,
        { r: 20, g: 40, b: 60, a: 200 },
        DEFAULT_BRUSH_MIXING,
        undefined,
      );
      const end = state.field.slice();
      end[end.length - 4 + channel] += 2;
      const profiles = prepareBristleMixingInterpolationProfiles(
        state,
        tip,
        state.field,
        end,
        [
          [0, 0.25],
          [0, 0.5],
          [0.5, 0],
          [0.25, 0.5],
        ],
      );
      expect(profiles?.canvases.map((run) => run.length)).toEqual([1, 2, 2, 1]);
      // The collapsed run must use w1, sharing the exact endpoint canvas.
      expect(profiles?.canvases[3]?.[0]).toBe(profiles?.canvases[1]?.[1]);
    },
  );
});
