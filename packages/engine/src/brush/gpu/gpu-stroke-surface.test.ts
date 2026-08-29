import { afterEach, describe, expect, it } from "vitest";
import { compileExpand, expandPoint } from "../../expand";
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
  brushPerfDebug.enabled = false;
  brushPerfDebug.reset();
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

  it("branch ごとの field を独立保持し branch 順に重ねる", () => {
    const layer = createLayer(64, 48);
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas, 2);

    surface.selectBranch(0);
    configureSolidDab(surface, [255, 0, 0, 255], 16);
    surface.selectBranch(1);
    configureSolidDab(surface, [0, 0, 255, 255], 16);
    surface.selectBranch(0);
    surface.pushDab({
      x: 32,
      y: 24,
      size: 16,
      rotation: 0,
      alpha: 0.75,
      branchIndex: 0,
    });
    surface.selectBranch(1);
    surface.pushDab({
      x: 32,
      y: 24,
      size: 16,
      rotation: 0,
      alpha: 0.75,
      branchIndex: 1,
    });
    surface.commitToLayer(layer);

    const branch0 = surface.readMaterialFieldForTest(0);
    const branch1 = surface.readMaterialFieldForTest(1);
    expect(Array.from(branch0.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(branch1.slice(0, 4))).toEqual([0, 0, 255, 255]);
    expectPixelNear(layer, 32, 24, [51, 0, 204, 239]);
  });

  it("全 branch の field を 2D strip 上で branch 順に独立更新する", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const source = new OffscreenCanvas(64, 32);
    const sourceCtx = source.getContext("2d");
    expect(sourceCtx).not.toBeNull();
    if (!sourceCtx) return;
    sourceCtx.fillStyle = "rgb(240, 30, 20)";
    sourceCtx.fillRect(0, 0, 32, 32);
    sourceCtx.fillStyle = "rgb(20, 50, 230)";
    sourceCtx.fillRect(32, 0, 32, 32);

    const surface = acquireGpuStrokeSurface(source.width, source.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(source, 2);
    const columns = 18;
    const rows = 8;
    const baseColor = { r: 0, g: 0, b: 0, a: 255 } as const;
    for (let branchIndex = 0; branchIndex < 2; branchIndex++) {
      surface.selectBranch(branchIndex);
      surface.initializeMaterialField(columns, rows, baseColor);
      surface.initializeMaterialCheckpoint(0, 0, source.width);
    }

    for (let branchIndex = 0; branchIndex < 2; branchIndex++) {
      surface.selectBranch(branchIndex);
      surface.updateMaterialField({
        baseColor,
        centerX: branchIndex === 0 ? 16 : 48,
        centerY: 16,
        angle: 0,
        sampleSize: 8,
        columns,
        rows,
        pickupRatePerPx: 10,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        distancePx: 1,
      });
    }

    const branch0 = surface.readMaterialFieldForTest(0);
    const branch1 = surface.readMaterialFieldForTest(1);
    expectChannelNear(branch0[0], 240);
    expectChannelNear(branch0[1], 30);
    expectChannelNear(branch0[2], 20);
    expectChannelNear(branch1[0], 20);
    expectChannelNear(branch1[1], 50);
    expectChannelNear(branch1[2], 230);
    expect(brushPerfDebug.snapshot().stages.gpuFieldUpdate.count).toBe(2);
  });

  it("field update は live accum ではなく直近の checkpoint snapshot を読む", () => {
    const source = new OffscreenCanvas(64, 64);
    const sourceCtx = source.getContext("2d");
    expect(sourceCtx).not.toBeNull();
    if (!sourceCtx) return;
    sourceCtx.fillStyle = "rgb(20, 50, 230)";
    sourceCtx.fillRect(0, 0, source.width, source.height);

    const surface = acquireGpuStrokeSurface(source.width, source.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(source);
    const baseColor = { r: 230, g: 35, b: 20, a: 255 } as const;
    configureSolidDab(surface, [230, 35, 20, 255], 16);
    surface.initializeMaterialCheckpoint(0, 0, source.width);
    surface.pushDab({ x: 32, y: 32, size: 16, rotation: 0, alpha: 1 });

    const update = {
      baseColor,
      centerX: 32,
      centerY: 32,
      angle: 0,
      sampleSize: 8,
      columns: 18,
      rows: 8,
      pickupRatePerPx: 10,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
      distancePx: 1,
    } as const;
    surface.updateMaterialField(update);
    const beforeCheckpoint = surface.readMaterialFieldForTest();
    expectChannelNear(beforeCheckpoint[0], 20);
    expectChannelNear(beforeCheckpoint[1], 50);
    expectChannelNear(beforeCheckpoint[2], 230);

    surface.snapshotMaterialCheckpoint(0, 0, source.width);
    surface.updateMaterialField(update);
    const afterCheckpoint = surface.readMaterialFieldForTest();
    expectChannelNear(afterCheckpoint[0], 230);
    expectChannelNear(afterCheckpoint[1], 35);
    expectChannelNear(afterCheckpoint[2], 20);
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
    surface.initializeMaterialCheckpoint(0, 0, source.width);
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

  it("branch 1 の 10 回連続 field update が CPU と一致する", () => {
    const source = new OffscreenCanvas(128, 32);
    const sourceCtx = source.getContext("2d");
    expect(sourceCtx).not.toBeNull();
    if (!sourceCtx) return;
    sourceCtx.fillStyle = "rgb(20, 50, 230)";
    sourceCtx.fillRect(0, 0, source.width, source.height);

    const surface = acquireGpuStrokeSurface(source.width, source.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(source, 1);

    const columns = 18;
    const rows = 8;
    const baseColor = { r: 230, g: 35, b: 20, a: 255 } as const;
    configureSolidDab(surface, [230, 35, 20, 255], 8);
    surface.initializeMaterialCheckpoint(0, 0, source.width);
    const checkpoint = sourceCtx.getImageData(
      0,
      0,
      source.width,
      source.height,
    );
    let expectedField = createMaterialField(columns, rows, baseColor);

    for (let index = 0; index < 10; index++) {
      const centerX = 8 + index * 12;
      surface.pushDab({
        x: centerX,
        y: 16,
        size: 8,
        rotation: 0,
        alpha: 1,
      });

      const update = {
        baseColor,
        centerX,
        centerY: 16,
        angle: 0,
        sampleSize: 8,
        columns,
        rows,
        pickupRatePerPx: 0.12,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        distancePx: 2,
      } as const;
      surface.updateMaterialField(update);
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
      expectedField = advanceMaterialField(
        expectedField,
        sampled,
        columns,
        rows,
        baseColor,
        update,
      );
    }

    const actual = surface.readMaterialFieldForTest();
    const expected = new Uint8ClampedArray(expectedField.length);
    writeMaterialFieldPixels(expectedField, expected);
    expect(actual).toHaveLength(expected.length);
    for (let offset = 0; offset < expected.length; offset++) {
      expectChannelNear(actual[offset], expected[offset] ?? 0);
    }
  });

  it("strip field の dab 補間が Canvas2D の field 拡大と一致する", () => {
    const layer = createLayer(32, 32);
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas, 1);

    const columns = 4;
    const rows = 4;
    const field = new Uint8ClampedArray(columns * rows * 4);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const offset = (row * columns + column) * 4;
        field[offset] = column * 70;
        field[offset + 1] = row * 70;
        field[offset + 2] = (column + row) * 30;
        field[offset + 3] = 255;
      }
    }
    const tip = new OffscreenCanvas(16, 16);
    const tipCtx = tip.getContext("2d");
    expect(tipCtx).not.toBeNull();
    if (!tipCtx) return;
    tipCtx.fillStyle = "white";
    tipCtx.fillRect(0, 0, tip.width, tip.height);
    surface.setTip(tip);
    surface.updateField(field, columns, rows);
    surface.pushDab({ x: 16, y: 16, size: 16, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);

    const fieldCanvas = new OffscreenCanvas(columns, rows);
    const fieldCtx = fieldCanvas.getContext("2d");
    expect(fieldCtx).not.toBeNull();
    if (!fieldCtx) return;
    fieldCtx.putImageData(new ImageData(field, columns, rows), 0, 0);
    const expectedCanvas = new OffscreenCanvas(layer.width, layer.height);
    const expectedCtx = expectedCanvas.getContext("2d");
    expect(expectedCtx).not.toBeNull();
    if (!expectedCtx) return;
    expectedCtx.imageSmoothingEnabled = true;
    expectedCtx.drawImage(fieldCanvas, 8, 8, 16, 16);

    const actual = layer.ctx.getImageData(8, 8, 16, 16).data;
    const expected = expectedCtx.getImageData(8, 8, 16, 16).data;
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
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const layer = createLayer(1400, 1100);
    layer.ctx.fillStyle = "rgb(12, 34, 56)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [210, 70, 40, 255], 16);

    surface.pushDab({ x: 100, y: 50, size: 16, rotation: 0, alpha: 1 });
    surface.pushDab({ x: 1300, y: 1050, size: 16, rotation: 0, alpha: 1 });
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
    expect(brushPerfDebug.snapshot().samples.gpuCommitDraws).toEqual([6]);
  });

  it("radial 4 Expand の branch 別 commit が従来の union commit と byte-identical", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const layer = createLayer(256, 256);
    layer.ctx.fillStyle = "rgb(12, 34, 56)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas, 4);

    const expanded = expandPoint(
      { x: 208, y: 128 },
      compileExpand({
        levels: [
          {
            mode: "radial",
            offset: { x: 128, y: 128 },
            angle: 0,
            divisions: 4,
          },
        ],
      }),
    );
    for (const [branchIndex, point] of expanded.entries()) {
      surface.selectBranch(branchIndex);
      configureSolidDab(surface, [210, 70, 40, 255], 16);
      surface.pushDab({
        x: Math.round(point.x),
        y: Math.round(point.y),
        size: 16,
        rotation: 0,
        alpha: 1,
        branchIndex,
      });
    }
    surface.flush();
    const unionCommitReference = surface.readCheckpoint(0, 0, layer.width);

    surface.commitToLayer(layer);

    const actual = layer.ctx.getImageData(0, 0, layer.width, layer.height).data;
    expect(actual).toEqual(unionCommitReference);
    expect(brushPerfDebug.snapshot().samples.gpuCommitPixels).toEqual([
      4 * 16 * 16,
    ]);
    expect(brushPerfDebug.snapshot().samples.gpuCommitDraws).toEqual([4]);
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
