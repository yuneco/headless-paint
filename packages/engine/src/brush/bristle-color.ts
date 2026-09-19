import type { BristleMaskPaint, BristleMaskSweepSample } from "./bristle-mask";

/** Sample color on the same swept quad that owns coverage; never raster a second silhouette. */
export function createBristleMaskPaint(
  samples: readonly BristleMaskSweepSample[],
  brushSize: number,
  profile: OffscreenCanvas,
  endProfile: OffscreenCanvas | undefined,
  originX: number,
  originY: number,
  opacity: number,
): BristleMaskPaint {
  const read = (canvas: OffscreenCanvas): ImageData => {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Bristle color requires Canvas2D");
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };
  const startPixels = read(profile);
  const endPixels = endProfile ? read(endProfile) : startPixels;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  return {
    opacity,
    write(data, offset, x, y, u, crossRatio) {
      const index = Math.max(0, Math.min(samples.length - 2, Math.floor(u)));
      const from = samples[index];
      const to = samples[index + 1];
      const t = Math.max(0, Math.min(1, u - index));
      const halfWidth =
        (from.halfWidth ?? brushSize / 2) * (1 - t) +
        (to.halfWidth ?? brushSize / 2) * t;
      const v =
        halfWidth > 0
          ? 0.5 + ((crossRatio - 0.5) * brushSize) / (2 * halfWidth)
          : 0.5;
      // Continuous longitudinal coordinates avoid repeating the entire color
      // field in every short geometry segment (visible stripes on tight turns).
      const distance = from.distance * (1 - t) + to.distance * t;
      const texU = 0.5 + (distance - last.distance) / brushSize;
      const weight = endProfile
        ? lengthSquared < 0.000001
          ? 1
          : Math.max(
              0,
              Math.min(
                1,
                ((x + originX + 0.5 - first.x) * dx +
                  (y + originY + 0.5 - first.y) * dy) /
                  lengthSquared,
              ),
            )
        : 0;
      const tx = Math.max(
        0,
        Math.min(startPixels.width - 1, texU * startPixels.width - 0.5),
      );
      const ty = Math.max(
        0,
        Math.min(startPixels.height - 1, v * startPixels.height - 0.5),
      );
      const x0 = Math.floor(tx);
      const y0 = Math.floor(ty);
      const x1 = Math.min(startPixels.width - 1, x0 + 1);
      const y1 = Math.min(startPixels.height - 1, y0 + 1);
      const a = (y0 * startPixels.width + x0) * 4;
      const b = (y0 * startPixels.width + x1) * 4;
      const c = (y1 * startPixels.width + x0) * 4;
      const d = (y1 * startPixels.width + x1) * 4;
      const fx = tx - x0;
      const fy = ty - y0;
      const startData = startPixels.data;
      const endData = endPixels.data;
      for (let channel = 0; channel < 3; channel++) {
        const top =
          startData[a + channel] * (1 - fx) + startData[b + channel] * fx;
        const bottom =
          startData[c + channel] * (1 - fx) + startData[d + channel] * fx;
        const start = top * (1 - fy) + bottom * fy;
        if (weight === 0) data[offset + channel] = start;
        else {
          const endTop =
            endData[a + channel] * (1 - fx) + endData[b + channel] * fx;
          const endBottom =
            endData[c + channel] * (1 - fx) + endData[d + channel] * fx;
          data[offset + channel] =
            start * (1 - weight) +
            (endTop * (1 - fy) + endBottom * fy) * weight;
        }
      }
    },
  };
}
