import { describe, expect, it } from "vitest";
import { DEFAULT_BRISTLE_DYNAMICS } from "../types";
import { applyDocumentGrain, rasterizeBristleMask } from "./bristle-mask";

describe("bristle surface grain", () => {
  it("初回の未着彩cellへalpha floorを加えない", () => {
    const mask = rasterizeBristleMask(
      [
        {
          x: 10,
          y: 30,
          pressure: 0.5,
          distance: 0,
          frameX: 1,
          frameY: 0,
        },
        {
          x: 110,
          y: 30,
          pressure: 0.5,
          distance: 100,
          frameX: 1,
          frameY: 0,
        },
      ],
      40,
      DEFAULT_BRISTLE_DYNAMICS,
      1,
      1,
      0,
      0,
      120,
      60,
    );
    const data = pixels(mask);
    const alpha: number[] = [];
    for (let y = 10; y < 50; y++) {
      for (let x = 20; x < 100; x++) {
        alpha.push(data[(y * mask.width + x) * 4 + 3] ?? 0);
      }
    }

    expect(alpha).toContain(0);
    expect(alpha.some((value) => value > 0)).toBe(true);
  });

  it("uses pressure as contact against the Fine tooth height field", () => {
    const low = opaqueMask(64, 64);
    const high = opaqueMask(64, 64);

    applyDocumentGrain(low.ctx, 0, 0, 64, 64, DEFAULT_BRISTLE_DYNAMICS, 0.2);
    applyDocumentGrain(high.ctx, 0, 0, 64, 64, DEFAULT_BRISTLE_DYNAMICS, 0.9);

    expect(alphaCoverage(high.canvas)).toBeGreaterThan(
      alphaCoverage(low.canvas) * 1.5,
    );
  });

  it("is deterministic for the same document origin and pressure", () => {
    const first = opaqueMask(64, 64);
    const second = opaqueMask(64, 64);

    applyDocumentGrain(
      first.ctx,
      12,
      7,
      64,
      64,
      DEFAULT_BRISTLE_DYNAMICS,
      0.55,
    );
    applyDocumentGrain(
      second.ctx,
      12,
      7,
      64,
      64,
      DEFAULT_BRISTLE_DYNAMICS,
      0.55,
    );

    expect(pixels(second.canvas)).toEqual(pixels(first.canvas));
  });
});

function opaqueMask(
  width: number,
  height: number,
): {
  readonly canvas: OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D;
} {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function pixels(canvas: OffscreenCanvas): number[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

function alphaCoverage(canvas: OffscreenCanvas): number {
  const data = pixels(canvas);
  let coverage = 0;
  for (let index = 3; index < data.length; index += 4) {
    coverage += data[index] ?? 0;
  }
  return coverage;
}
