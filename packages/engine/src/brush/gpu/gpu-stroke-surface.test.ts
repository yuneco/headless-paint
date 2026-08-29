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
  brushPerfDebug.experiments.gpuReadback = "async";
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

  it("async request の source pixel を数 frame 後に take できる", async () => {
    const layer = createLayer(64, 48);
    layer.ctx.fillStyle = "rgba(30, 140, 220, 0.75)";
    layer.ctx.fillRect(9, 7, 1, 1);

    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [0, 0, 0, 0], 1);
    surface.pushDab({ x: 9.5, y: 7.5, size: 1, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);
    surface.requestCheckpoint();

    await waitForAnimationFrames(3);
    let checkpoint = surface.takeCompletedCheckpoint();
    for (let frame = 0; !checkpoint && frame < 12; frame++) {
      await waitForAnimationFrames(1);
      checkpoint = surface.takeCompletedCheckpoint();
    }

    expect(checkpoint).not.toBeNull();
    if (!checkpoint) return;
    expect(checkpoint.originX).toBe(0);
    expect(checkpoint.originY).toBe(0);
    expect(checkpoint.width).toBe(layer.width);
    expect(checkpoint.height).toBe(layer.height);
    expectCheckpointDocumentPixel(checkpoint, 9, 7, [30, 140, 220, 191]);
  });

  it("async checkpoint の document 座標が色付き source と一致する", async () => {
    const layer = createLayer(96, 64);
    layer.ctx.fillStyle = "rgb(220, 30, 20)";
    layer.ctx.fillRect(0, 0, layer.width / 2, layer.height);
    layer.ctx.fillStyle = "rgb(20, 40, 230)";
    layer.ctx.fillRect(layer.width / 2, 0, layer.width / 2, layer.height);

    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [0, 0, 0, 0], 8);
    surface.pushDab({ x: 48, y: 32, size: 8, rotation: 0, alpha: 1 });
    surface.flush();
    surface.requestCheckpoint();

    const checkpoint = await takeCheckpointAfterFrames(surface);
    expect(checkpoint).not.toBeNull();
    if (!checkpoint) return;
    expectCheckpointDocumentPixel(checkpoint, 16, 12, [220, 30, 20, 255]);
    expectCheckpointDocumentPixel(checkpoint, 80, 45, [20, 40, 230, 255]);
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

  it("2 batch 連続 commit で最初の deposit と layer の他領域を維持する", () => {
    const layer = createLayer(128, 64);
    layer.ctx.fillStyle = "rgb(10, 20, 30)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [220, 60, 30, 255], 8);

    surface.pushDab({ x: 24, y: 32, size: 8, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);
    surface.pushDab({ x: 104, y: 32, size: 8, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);

    expectPixelNear(layer, 24, 32, [220, 60, 30, 255]);
    expectPixelNear(layer, 104, 32, [220, 60, 30, 255]);
    expectPixelNear(layer, 64, 4, [10, 20, 30, 255]);
  });

  it("512px を超える dirty rect を分割 commit して layer 全域を保つ", () => {
    const layer = createLayer(1200, 700);
    layer.ctx.fillStyle = "rgb(12, 34, 56)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [210, 70, 40, 255], 16);

    surface.pushDab({ x: 100, y: 50, size: 16, rotation: 0, alpha: 1 });
    surface.pushDab({ x: 1100, y: 650, size: 16, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);

    const actual = layer.ctx.getImageData(0, 0, layer.width, layer.height).data;
    const expected = surface.readCheckpoint(0, 0, layer.width);
    let firstMismatch = -1;
    for (let offset = 0; offset < actual.length; offset++) {
      if (actual[offset] !== expected[offset]) {
        firstMismatch = offset;
        break;
      }
    }
    expect(firstMismatch).toBe(-1);
  });

  it("512px を超える batch の async checkpoint を最新 dab 側の 512px 角に絞る", async () => {
    const layer = createLayer(1200, 700);
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [80, 120, 200, 255], 16);
    surface.pushDab({ x: 100, y: 50, size: 16, rotation: 0, alpha: 1 });
    surface.pushDab({ x: 1100, y: 650, size: 16, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);
    surface.requestCheckpoint();

    const checkpoint = await takeCheckpointAfterFrames(surface);
    expect(checkpoint).not.toBeNull();
    if (!checkpoint) return;
    expect(checkpoint.originX).toBe(688);
    expect(checkpoint.originY).toBe(188);
    expect(checkpoint.width).toBe(512);
    expect(checkpoint.height).toBe(512);
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

function configureSolidDab(
  surface: GpuStrokeSurface,
  color: readonly [number, number, number, number],
  tipSize: number,
): void {
  const tip = new OffscreenCanvas(tipSize, tipSize);
  const tipCtx = tip.getContext("2d");
  expect(tipCtx).not.toBeNull();
  if (!tipCtx) return;
  tipCtx.fillStyle = "white";
  tipCtx.fillRect(0, 0, tipSize, tipSize);
  const columns = 18;
  const rows = 8;
  const field = new Uint8ClampedArray(columns * rows * 4);
  for (let offset = 0; offset < field.length; offset += 4) {
    field.set(color, offset);
  }
  surface.setTip(tip);
  surface.updateField(field, columns, rows);
}

function expectPixelNear(
  layer: ReturnType<typeof createLayer>,
  x: number,
  y: number,
  expected: readonly [number, number, number, number],
): void {
  const pixel = layer.ctx.getImageData(x, y, 1, 1).data;
  for (let channel = 0; channel < expected.length; channel++) {
    expectChannelNear(pixel[channel], expected[channel] ?? 0);
  }
}

function expectCheckpointDocumentPixel(
  checkpoint: NonNullable<
    ReturnType<GpuStrokeSurface["takeCompletedCheckpoint"]>
  >,
  x: number,
  y: number,
  expected: readonly [number, number, number, number],
): void {
  const localX = x - checkpoint.originX;
  const localY = y - checkpoint.originY;
  expect(localX).toBeGreaterThanOrEqual(0);
  expect(localX).toBeLessThan(checkpoint.width);
  expect(localY).toBeGreaterThanOrEqual(0);
  expect(localY).toBeLessThan(checkpoint.height);
  const offset = (localY * checkpoint.width + localX) * 4;
  for (let channel = 0; channel < expected.length; channel++) {
    expectChannelNear(
      checkpoint.pixels[offset + channel],
      expected[channel] ?? 0,
    );
  }
}

async function waitForAnimationFrames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame++) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }
}

async function takeCheckpointAfterFrames(
  surface: GpuStrokeSurface,
): Promise<ReturnType<GpuStrokeSurface["takeCompletedCheckpoint"]>> {
  await waitForAnimationFrames(3);
  let checkpoint = surface.takeCompletedCheckpoint();
  for (let frame = 0; !checkpoint && frame < 12; frame++) {
    await waitForAnimationFrames(1);
    checkpoint = surface.takeCompletedCheckpoint();
  }
  return checkpoint;
}
