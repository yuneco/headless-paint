import { createLayer } from "../../packages/engine/src/layer";
import {
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  ROUGH_BRISTLE,
} from "../../packages/engine/src/types";
import { createBrushAccelerator } from "../../packages/engine/src/brush/gpu/accelerator";
import { createIncrementalStrokeRenderer } from "../../packages/stroke/src/incremental-stroke";
export async function measure() {
  const results = [];
  for (const backend of ["cpu", "webgl2"] as const)
    for (const kind of [
      "arc",
      "spiral",
      "pressure",
      "wide",
      "reverse",
      "cross",
      "straight",
      "slow",
      "texture",
      "radial4",
    ]) {
      const size = kind === "wide" ? 640 : 320,
        width = kind === "wide" ? 120 : 40;
      const points = Array.from({ length: 361 }, (_, i) => {
        const t = i / 360,
          a = t * Math.PI * 3,
          radius = kind === "spiral" ? 25 + t * 85 : kind === "wide" ? 180 : 85;
        let x = size / 2 + radius * Math.cos(a),
          y = size / 2 + radius * Math.sin(a);
        if (kind === "straight") {
          x = 30 + t * (size - 60);
          y = size / 2;
        }
        if (kind === "cross") {
          x = size / 2 + 85 * Math.sin(a);
          y = size / 2 + 85 * Math.sin(2 * a);
        }
        return {
          x,
          y,
          pressure:
            kind === "pressure"
              ? 0.2 + 0.8 * Math.sin(t * Math.PI) ** 2
              : kind === "texture"
                ? 0.55
                : 1,
          timestamp: i * (kind === "slow" ? 8 : 2),
        };
      });
      if (kind === "reverse")
        points.reverse().forEach((p, i) => {
          p.timestamp = i * 2;
        });
      const accelerator =
        backend === "webgl2"
          ? createBrushAccelerator({ backend, resident: false })
          : null;
      if (backend === "webgl2" && !accelerator) throw Error("GPU unavailable");
      try {
        for (const substrate of [false, true])
          for (const mixing of [false, true]) {
            const style = {
              color: { r: 50, g: 50, b: 50, a: 255 },
              lineWidth: width,
              pressureCurve: DEFAULT_PRESSURE_CURVE,
              compositeOperation: "source-over" as const,
              brush: {
                ...ROUGH_BRISTLE,
                dynamics: {
                  ...ROUGH_BRISTLE.dynamics,
                  surfaceGrain: {
                    ...ROUGH_BRISTLE.dynamics.surfaceGrain,
                    amount:
                      kind === "texture"
                        ? ROUGH_BRISTLE.dynamics.surfaceGrain.amount
                        : 0,
                  },
                },
                pressureDynamics: {
                  dropout:
                    kind === "texture"
                      ? ROUGH_BRISTLE.pressureDynamics.dropout
                      : 0,
                  size: kind === "pressure" ? 1 : 0,
                },
                mixing: mixing
                  ? {
                      ...DEFAULT_BRUSH_MIXING,
                      enabled: true,
                      pickupRatePerPx: 0.007,
                      restoreRatePerPx: 0.004,
                      diffusionRatePerPx: 0.05,
                      updateDistancePx: 15,
                    }
                  : undefined,
              },
            };
            const times = [],
              calls = [];
            let pixels = "",
              png = "";
            for (let trial = 0; trial < 7; trial++) {
              const layer = createLayer(size, size);
              if (substrate) {
                layer.ctx.fillStyle = "#df3030";
                layer.ctx.fillRect(size * 0.4, 0, size * 0.18, size);
              }
              const begin = performance.now();
              const renderer = createIncrementalStrokeRenderer({
                layer,
                style,
                filterPipeline: { filters: [] },
                expand: {
                  levels: [
                    {
                      mode: kind === "radial4" ? "radial" : "none",
                      offset: { x: size / 2, y: size / 2 },
                      angle: 0,
                      divisions: kind === "radial4" ? 4 : 1,
                    },
                  ],
                },
                brushSeed: 2,
                alphaLocked: false,
                accelerator,
              });
              for (let i = 0; i < points.length; i += 8) {
                const start = performance.now();
                renderer.feedMany(points.slice(i, i + 8));
                if (trial >= 2) calls.push(performance.now() - start);
              }
              renderer.finalize();
              const elapsed = performance.now() - begin;
              if (trial >= 2) times.push(elapsed);
              if (trial === 6) {
                const bytes = layer.ctx.getImageData(0, 0, size, size).data;
                pixels = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () =>
                    resolve(String(reader.result).split(",")[1]);
                  reader.readAsDataURL(new Blob([bytes]));
                });
                const blob = await layer.canvas.convertToBlob();
                png = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () =>
                    resolve(String(reader.result).split(",")[1]);
                  reader.readAsDataURL(blob);
                });
              }
            }
            times.sort((a, b) => a - b);
            calls.sort((a, b) => a - b);
            results.push({
              backend,
              kind,
              substrate,
              mixing,
              size,
              width,
              median: times[Math.floor(times.length / 2)],
              p95: times[Math.floor(times.length * 0.95)],
              callP95: calls[Math.floor(calls.length * 0.95)],
              times,
              pixels,
              png,
            });
          }
      } finally {
        accelerator?.dispose();
      }
    }
  return results;
}
