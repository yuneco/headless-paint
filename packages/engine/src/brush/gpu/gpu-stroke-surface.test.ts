import { afterEach, describe, expect, it } from "vitest";
import { createLayer } from "../../layer";
import {
  advanceMaterialField,
  createMaterialField,
  writeMaterialFieldPixels,
} from "../material-field";
import { sampleRotatedCheckpoint } from "../mixing";
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
  brushPerfDebug.experiments.gpuReadback = "gpu-field";
  brushPerfDebug.experiments.checkpointLagSteps = 1;
  brushPerfDebug.experiments.gpuResident = true;
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

  it("snapshot 後の dab を含めず snapshot 時点の色付き pixel を返す", () => {
    const layer = createLayer(64, 48);
    layer.ctx.fillStyle = "rgba(30, 140, 220, 0.75)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);

    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    const snapshotId = surface.snapshotCheckpoint(16, 8, 32);
    configureSolidDab(surface, [240, 25, 10, 255], 8);
    surface.pushDab({ x: 32, y: 24, size: 8, rotation: 0, alpha: 1 });
    surface.flush();
    surface.issuePendingReadbacks();
    const checkpoint = surface.takeCheckpoint(snapshotId, { wait: true });

    expect(checkpoint).not.toBeNull();
    if (!checkpoint) return;
    expect(checkpoint.originX).toBe(16);
    expect(checkpoint.originY).toBe(8);
    expect(checkpoint.width).toBe(32);
    expect(checkpoint.height).toBe(32);
    expectCheckpointDocumentPixel(checkpoint, 32, 24, [30, 140, 220, 191]);

    surface.commitToLayer(layer);
    expectPixelNear(layer, 32, 24, [240, 25, 10, 255]);
  });

  it("async checkpoint の document 座標が色付き source と一致する", () => {
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
    const snapshotId = surface.snapshotCheckpoint(0, 0, layer.width);
    surface.issuePendingReadbacks();

    const checkpoint = surface.takeCheckpoint(snapshotId, { wait: true });
    expect(checkpoint).not.toBeNull();
    if (!checkpoint) return;
    expectCheckpointDocumentPixel(checkpoint, 16, 12, [220, 30, 20, 255]);
    expectCheckpointDocumentPixel(checkpoint, 80, 45, [20, 40, 230, 255]);
  });

  it("lag=3 の predecessor snapshot を N+2 slot ring から順に返す", () => {
    brushPerfDebug.experiments.checkpointLagSteps = 3;
    const layer = createLayer(32, 32);
    layer.ctx.fillStyle = "rgb(10, 20, 30)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);

    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);

    const snapshot0 = surface.snapshotCheckpoint(0, 0, layer.width);
    configureSolidDab(surface, [220, 40, 20, 255], 8);
    surface.pushDab({ x: 16, y: 16, size: 8, rotation: 0, alpha: 1 });
    const snapshot1 = surface.snapshotCheckpoint(0, 0, layer.width, snapshot0);
    const snapshot2 = surface.snapshotCheckpoint(0, 0, layer.width, snapshot1);
    const snapshot3 = surface.snapshotCheckpoint(0, 0, layer.width, snapshot2);
    surface.issuePendingReadbacks();

    const completed0 = surface.takeCheckpoint(snapshot3, {
      wait: true,
      lagSteps: 3,
    });
    expect(completed0).not.toBeNull();
    if (!completed0) return;
    expectCheckpointDocumentPixel(completed0, 16, 16, [10, 20, 30, 255]);

    const snapshot4 = surface.snapshotCheckpoint(0, 0, layer.width, snapshot3);
    const completed1 = surface.takeCheckpoint(snapshot4, {
      wait: true,
      lagSteps: 3,
    });
    expect(completed1).not.toBeNull();
    if (!completed1) return;
    expectCheckpointDocumentPixel(completed1, 16, 16, [220, 40, 20, 255]);
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

  it("field update pass が CPU sampling/mix/restore/diffusion と一致する", () => {
    const source = new OffscreenCanvas(96, 64);
    const sourceCtx = source.getContext("2d");
    expect(sourceCtx).not.toBeNull();
    if (!sourceCtx) return;
    sourceCtx.fillStyle = "rgb(20, 70, 230)";
    sourceCtx.fillRect(0, 0, source.width, source.height);
    sourceCtx.fillStyle = "rgb(30, 210, 80)";
    sourceCtx.fillRect(18, 10, 31, 46);

    const surface = acquireGpuStrokeSurface(source.width, source.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(source);

    const columns = 18;
    const rows = 8;
    const baseColor = { r: 225, g: 35, b: 25, a: 210 };
    const update = {
      baseColor,
      centerX: 48.25,
      centerY: 31.75,
      angle: 0.37,
      sampleSize: 42,
      columns,
      rows,
      pickupRatePerPx: 0.08,
      restoreRatePerPx: 0.015,
      diffusionRatePerPx: 0.21,
      distancePx: 7.5,
    } as const;
    surface.initializeMaterialField(columns, rows, baseColor);
    const tip = new OffscreenCanvas(16, 16);
    const tipCtx = tip.getContext("2d");
    expect(tipCtx).not.toBeNull();
    if (!tipCtx) return;
    tipCtx.fillStyle = "white";
    tipCtx.fillRect(0, 0, tip.width, tip.height);
    surface.setTip(tip);
    surface.pushDab({
      x: update.centerX,
      y: update.centerY,
      size: update.sampleSize,
      rotation: update.angle,
      alpha: 1,
    });
    surface.updateMaterialField(update);
    const actual = surface.readMaterialFieldForTest();

    const checkpoint = sourceCtx.getImageData(
      0,
      0,
      source.width,
      source.height,
    );
    const sampled = sampleRotatedCheckpoint(
      checkpoint,
      0,
      0,
      update.centerX,
      update.centerY,
      update.angle,
      update.sampleSize,
      columns,
      rows,
    );
    const expectedField = advanceMaterialField(
      createMaterialField(columns, rows, baseColor),
      sampled,
      columns,
      rows,
      baseColor,
      update,
    );
    const expected = new Uint8ClampedArray(expectedField.length);
    writeMaterialFieldPixels(expectedField, expected);

    expect(actual).toHaveLength(expected.length);
    for (let offset = 0; offset < expected.length; offset++) {
      expectChannelNear(actual[offset], expected[offset] ?? 0);
    }
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

  it('gpuDab: "off" では runtime が surface を生成しない', () => {
    brushPerfDebug.experiments.gpuDab = "off";
    const creationsBefore = getGpuStrokeSurfaceCreationCountForTest();
    const layer = createLayer(80, 60);
    const began = globalThis.__hpGpuStrokeRuntime?.beginStroke(
      {},
      layer,
      layer.canvas,
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
  checkpoint: NonNullable<ReturnType<GpuStrokeSurface["takeCheckpoint"]>>,
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
