import { describe, expect, it } from "vitest";
import { renderBrushStroke } from ".";
import { createLayer } from "../layer";
import {
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  ROUGH_BRISTLE,
  type StrokePoint,
  type StrokeStyle,
} from "../types";
import {
  createBrushAccelerator,
  getBrushAcceleratorRuntime,
} from "./gpu/accelerator";

const DIRECTIONS = ["forward", "reverse", "vertical"] as const;
type Direction = (typeof DIRECTIONS)[number];

describe("bristle perFlush run color interpolation", () => {
  for (const backend of ["cpu", "webgl2"] as const) {
    it.each(DIRECTIONS)(
      `${backend} %s keeps adjacent centerline redness within 8/255 after a red band`,
      (direction) => {
        const layer = renderBandStroke(backend, direction);
        const redness: number[] = [];
        // Band ends at along=108. Probe only the initially transparent region,
        // crossing run boundaries at along=132, 168, 204 and 240 (36px runs).
        for (let along = 114; along <= 264; along++) {
          const { x, y } = position(along, direction);
          const [r = 0, g = 0, b = 0, a = 0] = layer.ctx.getImageData(
            x,
            y,
            1,
            1,
          ).data;
          // Complementary inks must preserve coverage, including mid-run.
          expect(a, `alpha at along=${along}`).toBeGreaterThanOrEqual(254);
          redness.push((r - (g + b) / 2) / 255);
        }
        const deltas = redness
          .slice(1)
          .map((value, index) => Math.abs(value - (redness[index] ?? 0)));
        const maxDelta = Math.max(...deltas);
        console.info("bristle run redness", backend, direction, {
          maxAdjacentDelta: maxDelta,
          min: Math.min(...redness),
          max: Math.max(...redness),
        });
        // Prevent a no-pickup or constant-color implementation from passing.
        expect(Math.max(...redness) - Math.min(...redness)).toBeGreaterThan(
          64 / 255,
        );
        expect(maxDelta).toBeLessThanOrEqual(8 / 255);
      },
    );
  }
});

function position(along: number, direction: Direction) {
  return direction === "vertical"
    ? { x: 64, y: along }
    : { x: direction === "reverse" ? 300 - along : along, y: 64 };
}

function renderBandStroke(backend: "cpu" | "webgl2", direction: Direction) {
  const layer = createLayer(300, 300);
  layer.ctx.fillStyle = "rgb(230, 30, 30)";
  if (direction === "vertical") {
    layer.ctx.fillRect(0, 36, 128, 72);
  } else {
    layer.ctx.fillRect(direction === "reverse" ? 192 : 36, 0, 72, 128);
  }
  const source = createLayer(300, 300);
  source.ctx.drawImage(layer.canvas, 0, 0);
  const points: StrokePoint[] = Array.from({ length: 127 }, (_, index) => ({
    ...position(24 + index * 2, direction),
    pressure: 1,
  }));
  const style: StrokeStyle = {
    color: { r: 255, g: 255, b: 255, a: 255 },
    lineWidth: 40,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush: {
      ...ROUGH_BRISTLE,
      // A uniformly covered centerline isolates color steps from paper noise.
      dynamics: {
        ...ROUGH_BRISTLE.dynamics,
        bristleCount: 1,
        bristleFill: 2.4,
        bristleWidthVariation: 0,
        bristleSpacingVariation: 0,
        geometryStepPx: 2,
        dropoutLengthPx: 1_000_000,
        dropoutWidthPx: 1_000_000,
        depositHardness: 1,
        surfaceGrain: { ...ROUGH_BRISTLE.dynamics.surfaceGrain, amount: 0 },
      },
      pressureDynamics: { ...ROUGH_BRISTLE.pressureDynamics, coverage: 1 },
      mixing: {
        ...DEFAULT_BRUSH_MIXING,
        enabled: true,
        pickupRatePerPx: 0.08,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        updateDistancePx: 36,
        checkpointDistancePx: 36,
        fieldColumns: 2,
        fieldRows: 2,
      },
    },
  };
  const accelerator =
    backend === "webgl2"
      ? createBrushAccelerator({ backend, resident: false })
      : null;
  const runtime = accelerator ? getBrushAcceleratorRuntime(accelerator) : null;
  const owner = {};
  try {
    if (backend === "webgl2") {
      expect(runtime).not.toBeNull();
      expect(runtime?.beginStroke(owner, layer, layer.canvas)).toBe(true);
      runtime?.enter(owner);
    }
    try {
      // One engine call is one flush: retain all seven field update runs.
      renderBrushStroke(
        layer,
        points,
        style,
        0,
        {
          tipCanvas: null,
          seed: 2,
          branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
        },
        source,
        accelerator,
      );
    } finally {
      runtime?.leave(owner);
    }
    runtime?.commitToLayer(owner, layer);
    runtime?.endStroke(owner);
    return layer;
  } finally {
    accelerator?.dispose();
  }
}
