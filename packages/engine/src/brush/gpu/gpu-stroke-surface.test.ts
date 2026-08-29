import { afterEach, describe, expect, it } from "vitest";
import { createLayer } from "../../layer";
import { brushPerfDebug } from "../perf-debug";
import {
  type GpuStrokeSurface,
  acquireGpuStrokeSurface,
  getGpuStrokeSurfaceCreationCountForTest,
} from "./gpu-stroke-surface";

let surfaceUnderTest: GpuStrokeSurface | null = null;

afterEach(() => {
  surfaceUnderTest?.endStroke();
  surfaceUnderTest = null;
  brushPerfDebug.experiments.gpuDab = "off";
});

describe("GpuStrokeSurface", () => {
  it("beginStroke の source pixel を unpremultiplied checkpoint として返す", () => {
    const source = new OffscreenCanvas(64, 48);
    const ctx = source.getContext("2d");
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    ctx.fillStyle = "rgba(120, 40, 200, 0.5)";
    ctx.fillRect(4, 5, 1, 1);

    const surface = acquireGpuStrokeSurface(source.width, source.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(source);

    const pixel = surface.readCheckpoint(4, 5, 1);
    expectChannelNear(pixel[0], 120);
    expectChannelNear(pixel[1], 40);
    expectChannelNear(pixel[2], 200);
    expectChannelNear(pixel[3], 128);
  });

  it("単色 field と円 tip の dab を layer に commit する", () => {
    const layer = createLayer(64, 48);
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);

    const tip = new OffscreenCanvas(16, 16);
    const tipCtx = tip.getContext("2d");
    expect(tipCtx).not.toBeNull();
    if (!tipCtx) return;
    tipCtx.fillStyle = "rgba(255, 255, 255, 1)";
    tipCtx.beginPath();
    tipCtx.arc(8, 8, 7, 0, Math.PI * 2);
    tipCtx.fill();

    const columns = 18;
    const rows = 8;
    const field = new Uint8ClampedArray(columns * rows * 4);
    for (let offset = 0; offset < field.length; offset += 4) {
      field[offset] = 200;
      field[offset + 1] = 50;
      field[offset + 2] = 20;
      field[offset + 3] = 255;
    }
    surface.setTip(tip);
    surface.updateField(field, columns, rows);
    surface.pushDab({
      x: 32,
      y: 24,
      size: 16,
      rotation: 0,
      alpha: 1,
    });
    surface.commitToLayer(layer);

    const pixel = layer.ctx.getImageData(32, 24, 1, 1).data;
    expectChannelNear(pixel[0], 200);
    expectChannelNear(pixel[1], 50);
    expectChannelNear(pixel[2], 20);
    expectChannelNear(pixel[3], 255);
  });

  it('gpuDab: "off" では runtime が surface を生成しない', () => {
    brushPerfDebug.experiments.gpuDab = "off";
    const creationsBefore = getGpuStrokeSurfaceCreationCountForTest();
    const began = globalThis.__hpGpuStrokeRuntime?.beginStroke(
      {},
      new OffscreenCanvas(80, 60),
    );

    expect(began).toBe(false);
    expect(getGpuStrokeSurfaceCreationCountForTest()).toBe(creationsBefore);
  });
});

function expectChannelNear(actual: number | undefined, expected: number): void {
  expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(2);
}
