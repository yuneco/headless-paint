import { expect, it } from "vitest";
import { renderBrushStroke } from ".";
import { createLayer } from "../layer";
import {
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  ROUGH_BRISTLE,
  type StrokeStyle,
} from "../types";
import {
  createBrushAccelerator,
  getBrushAcceleratorRuntime,
} from "./gpu/accelerator";
it.each(["cpu", "webgl2"] as const)(
  "%s mixing preserves tight-curve coverage",
  (backend) => {
    function render(
      backend: "cpu" | "webgl2",
      mixing: boolean,
      handle: number,
      step: number,
      distance: number,
    ) {
      const layer = createLayer(256, 256);
      const source = createLayer(256, 256);
      const points = Array.from({ length: 361 }, (_, i) => {
        const angle = (i / 360) * Math.PI * 1.8;
        return {
          x: 128 + 60 * Math.cos(angle),
          y: 128 + 60 * Math.sin(angle),
          pressure: 1,
          timestamp: i * 2,
        };
      });
      const style: StrokeStyle = {
        color: { r: 50, g: 50, b: 50, a: 255 },
        lineWidth: 40,
        pressureCurve: DEFAULT_PRESSURE_CURVE,
        compositeOperation: "source-over",
        brush: {
          ...ROUGH_BRISTLE,
          dynamics: {
            ...ROUGH_BRISTLE.dynamics,
            geometryStepPx: step,
            handleLengthRatio: handle,
            surfaceGrain: { ...ROUGH_BRISTLE.dynamics.surfaceGrain, amount: 0 },
          },
          pressureDynamics: { dropout: 0, size: 0 },
          mixing: mixing
            ? {
                ...DEFAULT_BRUSH_MIXING,
                enabled: true,
                pickupRatePerPx: 0.007,
                restoreRatePerPx: 0.004,
                diffusionRatePerPx: 0.05,
                updateDistancePx: distance,
              }
            : undefined,
        },
      };
      const accelerator =
        backend === "webgl2"
          ? createBrushAccelerator({ backend, resident: false })
          : null;
      const runtime = accelerator
        ? getBrushAcceleratorRuntime(accelerator)
        : null;
      const owner = {};
      try {
        if (backend === "webgl2") {
          expect(runtime).not.toBeNull();
          expect(runtime?.beginStroke(owner, layer, layer.canvas)).toBe(true);
          runtime?.enter(owner);
        }
        try {
          renderBrushStroke(
            layer,
            points,
            style,
            0,
            {
              heightMap: null,
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
        return layer.ctx.getImageData(0, 0, 256, 256).data;
      } finally {
        accelerator?.dispose();
      }
    }
    for (const [handle, step, distance] of [
      [0.5, 1, 15],
      [0.5, 1, 5],
      [1, 1, 15],
    ]) {
      const off = render(backend, false, handle, step, distance);
      const on = render(backend, true, handle, step, distance);
      let holes = 0;
      let area = 0;
      for (let i = 3; i < off.length; i += 4) {
        if (off[i] > 250) {
          area++;
          if (on[i] < 128) holes++;
        }
      }
      expect(area).toBeGreaterThan(5000);
      expect(holes, `handle=${handle}, distance=${distance}`).toBe(0);
    }
  },
);
