import { afterEach, describe, expect, it, vi } from "vitest";
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
  type GpuBristleChunk,
  type GpuStrokeSurface,
  createGpuStrokeSurface,
} from "./gpu-stroke-surface";

let surfaceUnderTest: GpuStrokeSurface | null = null;

afterEach(() => {
  surfaceUnderTest?.dispose();
  surfaceUnderTest = null;
  brushPerfDebug.enabled = false;
  brushPerfDebug.reset();
  vi.restoreAllMocks();
});

describe("GpuStrokeSurface", () => {
  it("bristle chunk の重複 mask を MAX 蓄積して layer に commit する", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const layer = createLayer(64, 48);
    const surface = createGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);

    const profile = new OffscreenCanvas(2, 16);
    const profileCtx = profile.getContext("2d");
    expect(profileCtx).not.toBeNull();
    if (!profileCtx) return;
    profileCtx.fillStyle = "white";
    profileCtx.fillRect(0, 0, profile.width, profile.height);
    const chunk: GpuBristleChunk = {
      // Nearly constant noise; pressure gives signed distances -/+0.0031.
      // MAX keeps the stronger alpha (~191), while source-over would add alpha.
      segments: [
        {
          ...makeSweepSegment(0, 1),
          fromPressure: 0.558347518240826,
          toPressure: 0.558347518240826,
        },
        {
          ...makeSweepSegment(2, 3),
          fromPressure: 0.5652364071297148,
          toPressure: 0.5652364071297148,
        },
      ],
      simpleMask: {
        dropoutLengthPx: 1_000_000,
        dropoutWidthPx: 1_000_000,
        pressureCoverageResponse: 1,
      },
      profileAtlas: profile,
      grain: {
        amount: 0,
        softness: 0.1,
        grainSeed: 1,
        strokeSeed: 2,
        toothHeights: new Float32Array(128 * 128),
      },
      bboxRect: { left: 12, top: 22, right: 48, bottom: 42 },
      brushSize: 12,
      depositHardness: 1,
      color: { r: 220, g: 40, b: 20, a: 255 },
      useMaterialField: false,
    };
    surface.pushBristleChunk(chunk);
    surface.commitToLayer(layer);

    const pixel = layer.ctx.getImageData(30, 32, 1, 1).data;
    expect(pixel[0]).toBeGreaterThan(200);
    expect(pixel[1]).toBeGreaterThan(25);
    expect(pixel[3]).toBeGreaterThan(170);
    expect(pixel[3]).toBeLessThan(205);
    const stages = brushPerfDebug.snapshot().stages;
    expect(stages.gpuBristleMask.count).toBe(1);
    expect(stages.gpuBristleInk.count).toBe(1);
    expect(stages.gpuBristleComposite.count).toBe(1);
  });

  it("perFlush は複数 bristle run を一つの atlas/composite にまとめる", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const layer = createLayer(64, 48);
    const surface = createGpuStrokeSurface(layer.width, layer.height, "bitmap");
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);

    const profile = new OffscreenCanvas(2, 16);
    const profileCtx = profile.getContext("2d");
    expect(profileCtx).not.toBeNull();
    if (!profileCtx) return;
    profileCtx.fillStyle = "white";
    profileCtx.fillRect(0, 0, profile.width, profile.height);
    const chunk: GpuBristleChunk = {
      segments: [makeSweepSegment(0, 1)],
      simpleMask: {
        dropoutLengthPx: 40,
        dropoutWidthPx: 4,
        pressureCoverageResponse: 1,
      },
      profileAtlas: profile,
      grain: {
        amount: 0,
        softness: 0.1,
        grainSeed: 1,
        strokeSeed: 2,
        toothHeights: new Float32Array(128 * 128),
      },
      bboxRect: { left: 12, top: 22, right: 48, bottom: 42 },
      brushSize: 12,
      depositHardness: 1,
      color: { r: 220, g: 40, b: 20, a: 255 },
      useMaterialField: true,
    };
    const baseColor = { r: 220, g: 40, b: 20, a: 255 } as const;
    const update = {
      baseColor,
      centerX: 30,
      centerY: 32,
      angle: 0,
      sampleSize: 12,
      columns: 2,
      rows: 2,
      pickupRatePerPx: 0.1,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0.05,
      distancePx: 15,
    } as const;
    surface.initializeMaterialField(2, 2, baseColor);
    surface.initializeMaterialCheckpoint(0, 0, 64);
    surface.beginBranchBatch();
    surface.pushBristleChunk(chunk);
    surface.updateMaterialField(update);
    surface.pushBristleChunk(chunk);
    surface.updateMaterialField(update);
    surface.endBranchBatch();
    surface.commitToLayer(layer);

    const snapshot = brushPerfDebug.snapshot();
    expect(snapshot.stages.gpuBristleMask.count).toBe(1);
    expect(snapshot.stages.gpuBristleInk.count).toBe(1);
    expect(snapshot.stages.gpuBristleComposite.count).toBe(1);
    expect(snapshot.stages.gpuFieldUpdate.count).toBe(1);
    expect(snapshot.samples.gpuBristlePasses).toEqual([4]);
  });

  it("perFlush composite は flush 前後の field を距離進行度で補間する", () => {
    const layer = createLayer(128, 128);
    layer.ctx.fillStyle = "rgb(20, 210, 40)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);
    const surface = createGpuStrokeSurface(layer.width, layer.height, "bitmap");
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);

    const profile = new OffscreenCanvas(2, 16);
    const profileCtx = profile.getContext("2d");
    expect(profileCtx).not.toBeNull();
    if (!profileCtx) return;
    profileCtx.fillStyle = "white";
    profileCtx.fillRect(0, 0, profile.width, profile.height);
    const baseColor = { r: 220, g: 30, b: 20, a: 255 } as const;
    const makeChunk = (offsetX: number): GpuBristleChunk => ({
      segments: [
        {
          ...makeSweepSegment(0, 1),
          fromX: 20 + offsetX,
          toX: 40 + offsetX,
        },
      ],
      simpleMask: {
        dropoutLengthPx: 40,
        dropoutWidthPx: 4,
        pressureCoverageResponse: 1,
      },
      profileAtlas: profile,
      grain: {
        amount: 0,
        softness: 0.1,
        grainSeed: 1,
        strokeSeed: 2,
        toothHeights: new Float32Array(128 * 128),
      },
      bboxRect: {
        left: 12 + offsetX,
        top: 22,
        right: 48 + offsetX,
        bottom: 42,
      },
      brushSize: 12,
      depositHardness: 1,
      color: baseColor,
      useMaterialField: true,
    });

    surface.initializeMaterialField(2, 2, baseColor);
    surface.initializeMaterialCheckpoint(0, 0, 128);
    surface.beginBranchBatch();
    for (const offsetX of [0, 36, 72]) {
      surface.pushBristleChunk(makeChunk(offsetX));
      surface.updateMaterialField({
        baseColor,
        centerX: 30 + offsetX,
        centerY: 32,
        angle: 0,
        sampleSize: 12,
        columns: 2,
        rows: 2,
        pickupRatePerPx: 1,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        distancePx: 4,
      });
    }
    surface.endBranchBatch();
    surface.commitToLayer(layer);

    const first = layer.ctx.getImageData(30, 32, 1, 1).data;
    const middle = layer.ctx.getImageData(66, 32, 1, 1).data;
    const last = layer.ctx.getImageData(102, 32, 1, 1).data;
    expect(first[0]).toBeGreaterThan(middle[0] ?? 0);
    expect(middle[0]).toBeGreaterThan(last[0] ?? 0);
    expect(first[1]).toBeLessThan(middle[1] ?? 0);
    expect(middle[1]).toBeLessThan(last[1] ?? 0);
  });

  it("perFlush の flush-start sample は texture swap 後も現在の accum を参照する", () => {
    const firstLayer = createLayer(64, 64);
    const secondLayer = createLayer(64, 64);
    for (const layer of [firstLayer, secondLayer]) {
      layer.ctx.fillStyle = "rgb(20, 210, 40)";
      layer.ctx.fillRect(0, 0, layer.width, layer.height);
    }
    const surface = createGpuStrokeSurface(64, 64, "bitmap");
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;

    const profile = new OffscreenCanvas(2, 16);
    const profileCtx = profile.getContext("2d");
    expect(profileCtx).not.toBeNull();
    if (!profileCtx) return;
    profileCtx.fillStyle = "white";
    profileCtx.fillRect(0, 0, profile.width, profile.height);
    const baseColor = { r: 220, g: 30, b: 20, a: 255 } as const;
    const chunk: GpuBristleChunk = {
      segments: [makeSweepSegment(0, 1)],
      simpleMask: {
        dropoutLengthPx: 40,
        dropoutWidthPx: 4,
        pressureCoverageResponse: 1,
      },
      profileAtlas: profile,
      grain: {
        amount: 0,
        softness: 0.1,
        grainSeed: 1,
        strokeSeed: 2,
        toothHeights: new Float32Array(64 * 64),
      },
      bboxRect: { left: 12, top: 22, right: 48, bottom: 42 },
      brushSize: 12,
      depositHardness: 1,
      color: baseColor,
      useMaterialField: true,
    };
    const update = {
      baseColor,
      centerX: 30,
      centerY: 32,
      angle: 0,
      sampleSize: 20,
      columns: 2,
      rows: 2,
      pickupRatePerPx: 0.17,
      restoreRatePerPx: 0,
      diffusionRatePerPx: 0,
      distancePx: 4,
    } as const;
    const render = (layer: typeof firstLayer) => {
      surface.beginStroke(layer.canvas);
      surface.initializeMaterialField(2, 2, baseColor);
      surface.initializeMaterialCheckpoint(0, 0, 64);
      for (let batch = 0; batch < 2; batch++) {
        surface.beginBranchBatch();
        surface.pushBristleChunk(chunk);
        surface.updateMaterialField(update);
        surface.snapshotMaterialCheckpoint(0, 0, 64);
        surface.pushBristleChunk(chunk);
        surface.updateMaterialField(update);
        surface.endBranchBatch();
      }
      const field = surface.readMaterialFieldForTest();
      surface.endStroke();
      return field;
    };

    // sourceCanvas upload swaps accum/source on every beginStroke. Rendering
    // must not depend on which physical texture is active after that swap.
    expect(render(firstLayer)).toEqual(render(secondLayer));
  });

  it("perFlush field は各 bristle run の checkpoint geometry を積分する", () => {
    const source = new OffscreenCanvas(72, 48);
    const sourceCtx = source.getContext("2d");
    expect(sourceCtx).not.toBeNull();
    if (!sourceCtx) return;
    sourceCtx.fillStyle = "rgb(235, 35, 25)";
    sourceCtx.fillRect(0, 0, 24, source.height);
    sourceCtx.fillStyle = "rgb(25, 210, 65)";
    sourceCtx.fillRect(24, 0, 24, source.height);
    sourceCtx.fillStyle = "rgb(30, 65, 235)";
    sourceCtx.fillRect(48, 0, 24, source.height);

    const baseColor = { r: 180, g: 180, b: 180, a: 255 } as const;
    let expectedField = createMaterialField(4, 4, baseColor);
    // Each run samples its checkpoint geometry from the flush-start image.
    for (const [index, centerX] of [12, 36, 60].entries()) {
      const checkpoint = sourceCtx.getImageData(index * 24, 0, 24, 24);
      const sampled = sampleRotatedCheckpoint(
        checkpoint,
        index * 24,
        0,
        centerX,
        24,
        0,
        8,
        4,
        4,
      );
      expectedField = advanceMaterialField(
        expectedField,
        sampled,
        4,
        4,
        baseColor,
        {
          pickupRatePerPx: 0.12,
          restoreRatePerPx: 0,
          diffusionRatePerPx: 0,
          distancePx: 4,
        },
      );
    }
    const expected = new Uint8ClampedArray(expectedField.length);
    writeMaterialFieldPixels(expectedField, expected);
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const perFlush = renderBristlePerFlushForTest(source);

    expect(
      materialFieldMae(expected, perFlush),
      JSON.stringify({
        expected: Array.from(expected.slice(0, 4)),
        perFlush: Array.from(perFlush.slice(0, 4)),
      }),
    ).toBeLessThanOrEqual(0.02);
    expect(brushPerfDebug.snapshot().samples.gpuBristlePasses).toEqual([3]);
  });

  it("単色 field と円 tip の dab を layer に commit する", () => {
    const layer = createLayer(64, 48);
    const surface = createGpuStrokeSurface(layer.width, layer.height);
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
    const surface = createGpuStrokeSurface(layer.width, layer.height);
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

  it("全 branch の snapshot を参照して 2D strip を 1 pass で更新する", () => {
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

    const surface = createGpuStrokeSurface(source.width, source.height);
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
      surface.initializeMaterialCheckpoint(branchIndex * 32, 0, 32);
    }

    surface.beginBranchBatch();
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
    surface.endBranchBatch();

    const branch0 = surface.readMaterialFieldForTest(0);
    const branch1 = surface.readMaterialFieldForTest(1);
    expectChannelNear(branch0[0], 240);
    expectChannelNear(branch0[1], 30);
    expectChannelNear(branch0[2], 20);
    expectChannelNear(branch1[0], 20);
    expectChannelNear(branch1[1], 50);
    expectChannelNear(branch1[2], 230);
    expect(brushPerfDebug.snapshot().stages.gpuFieldUpdate.count).toBe(1);
  });

  it("field strip は小さい stroke に切り替えても縮小再確保しない", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const layer = createLayer(64, 32);
    const surface = createGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    const baseColor = { r: 20, g: 40, b: 60, a: 255 } as const;

    brushPerfDebug.beginBatch(0, 4, "strokeStart");
    surface.beginStroke(layer.canvas, 4);
    surface.initializeMaterialField(18, 8, baseColor);
    surface.endStroke();
    surface.beginStroke(undefined, 1);
    surface.initializeMaterialField(8, 4, baseColor);
    surface.endStroke();
    brushPerfDebug.endBatch();

    const reallocations = brushPerfDebug
      .snapshot()
      .stalls.flatMap((stall) => stall.events)
      .filter((event) => event.name === "realloc:fieldStrip");
    expect(reallocations).toEqual([
      { name: "realloc:fieldStrip", width: 18, height: 32 },
    ]);
  });

  it("field update は live accum ではなく直近の checkpoint snapshot を読む", () => {
    const source = new OffscreenCanvas(64, 64);
    const sourceCtx = source.getContext("2d");
    expect(sourceCtx).not.toBeNull();
    if (!sourceCtx) return;
    sourceCtx.fillStyle = "rgb(20, 50, 230)";
    sourceCtx.fillRect(0, 0, source.width, source.height);

    const surface = createGpuStrokeSurface(source.width, source.height);
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

    const surface = createGpuStrokeSurface(source.width, source.height);
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

    const surface = createGpuStrokeSurface(source.width, source.height);
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
    const surface = createGpuStrokeSurface(layer.width, layer.height);
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
    const surface = createGpuStrokeSurface(layer.width, layer.height);
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

  it("複数 batch の commit と未 commit dab を base から byte 一致復元する", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const layer = createLayer(128, 64);
    layer.ctx.fillStyle = "rgb(10, 20, 30)";
    layer.ctx.fillRect(0, 0, layer.width / 2, layer.height);
    layer.ctx.fillStyle = "rgb(40, 50, 60)";
    layer.ctx.fillRect(layer.width / 2, 0, layer.width / 2, layer.height);
    const before = layer.ctx.getImageData(0, 0, layer.width, layer.height).data;
    const surface = createGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [220, 60, 30, 255], 8);

    surface.pushDab({ x: 24, y: 32, size: 8, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);
    surface.pushDab({ x: 104, y: 32, size: 8, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);
    surface.pushDab({ x: 64, y: 32, size: 8, rotation: 0, alpha: 1 });
    surface.flush();

    surface.cancelStroke();

    expect(
      layer.ctx.getImageData(0, 0, layer.width, layer.height).data,
    ).toEqual(before);
    const stages = brushPerfDebug.snapshot().stages;
    expect(stages.gpuBaseCopy.count).toBe(1);
    expect(stages.gpuCancelRestore.count).toBe(1);
  });

  it("commit 前に accum へ flush 済みの dab も cancel で消す", () => {
    const layer = createLayer(64, 64);
    layer.ctx.fillStyle = "rgb(10, 20, 30)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);
    const before = layer.ctx.getImageData(0, 0, layer.width, layer.height).data;
    const surface = createGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [220, 60, 30, 255], 16);
    surface.pushDab({ x: 32, y: 32, size: 16, rotation: 0, alpha: 1 });
    surface.flush();

    surface.cancelStroke();
    surface.endStroke();
    surface.beginStroke(undefined);
    configureSolidDab(surface, [220, 60, 30, 255], 16);
    surface.pushDab({ x: 32, y: 32, size: 16, rotation: 0, alpha: 0 });
    surface.commitToLayer(layer);

    expect(
      layer.ctx.getImageData(0, 0, layer.width, layer.height).data,
    ).toEqual(before);
  });

  it("512px を超える dirty rect を分割 commit して layer 全域を保つ", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const layer = createLayer(1400, 1100);
    layer.ctx.fillStyle = "rgb(12, 34, 56)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);
    const surface = createGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    const transferSpy = vi.spyOn(
      OffscreenCanvas.prototype,
      "transferToImageBitmap",
    );
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [210, 70, 40, 255], 16);

    surface.pushDab({ x: 100, y: 50, size: 16, rotation: 0, alpha: 1 });
    surface.pushDab({ x: 1300, y: 1050, size: 16, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);

    expectPixelNear(layer, 100, 50, [210, 70, 40, 255]);
    expectPixelNear(layer, 1300, 1050, [210, 70, 40, 255]);
    expectPixelNear(layer, 700, 550, [12, 34, 56, 255]);
    expect(brushPerfDebug.snapshot().samples.gpuCommitDraws).toEqual([6]);
    expect(transferSpy).toHaveBeenCalledTimes(2);
  });

  it("transferToImageBitmapが0寸法を返したらWebGL canvas直接描画へfallbackする", () => {
    const close = vi.fn();
    vi.spyOn(
      OffscreenCanvas.prototype,
      "transferToImageBitmap",
    ).mockReturnValue({ width: 0, height: 0, close } as unknown as ImageBitmap);
    const layer = createLayer(64, 64);
    const surface = createGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [210, 70, 40, 255], 16);

    surface.pushDab({ x: 32, y: 32, size: 16, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);

    expect(close).toHaveBeenCalledOnce();
    expectPixelNear(layer, 32, 32, [210, 70, 40, 255]);
  });

  it("direct commit は transferToImageBitmap を使わずWebGL canvasを描画する", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    brushPerfDebug.beginBatch(1, 1);
    const transferSpy = vi.spyOn(
      OffscreenCanvas.prototype,
      "transferToImageBitmap",
    );
    const layer = createLayer(64, 64);
    const surface = createGpuStrokeSurface(layer.width, layer.height, "direct");
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [210, 70, 40, 255], 16);

    surface.pushDab({ x: 32, y: 32, size: 16, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);
    brushPerfDebug.endBatch();

    expect(transferSpy).not.toHaveBeenCalled();
    expectPixelNear(layer, 32, 32, [210, 70, 40, 255]);
    const commitEvents = brushPerfDebug
      .snapshot()
      .stalls.flatMap((stall) => stall.events)
      .filter((event) => event.name === "gpuCommit");
    expect(commitEvents).toHaveLength(1);
    expect(commitEvents[0]?.mode).toBe("direct");
  });

  it("ImageBitmapのdrawImageが例外ならWebGL canvas直接描画へfallbackする", () => {
    const close = vi.fn();
    vi.spyOn(
      OffscreenCanvas.prototype,
      "transferToImageBitmap",
    ).mockReturnValue({
      width: 1024,
      height: 1024,
      close,
    } as unknown as ImageBitmap);
    const layer = createLayer(64, 64);
    const surface = createGpuStrokeSurface(layer.width, layer.height);
    expect(surface).not.toBeNull();
    if (!surface) return;
    surfaceUnderTest = surface;
    surface.beginStroke(layer.canvas);
    configureSolidDab(surface, [210, 70, 40, 255], 16);

    surface.pushDab({ x: 32, y: 32, size: 16, rotation: 0, alpha: 1 });
    surface.commitToLayer(layer);

    expect(close).toHaveBeenCalledOnce();
    expectPixelNear(layer, 32, 32, [210, 70, 40, 255]);
  });

  it("radial 4 Expand の branch 別 commit が従来の union commit と byte-identical", () => {
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();
    const layer = createLayer(256, 256);
    layer.ctx.fillStyle = "rgb(12, 34, 56)";
    layer.ctx.fillRect(0, 0, layer.width, layer.height);
    const surface = createGpuStrokeSurface(layer.width, layer.height);
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
    surface.commitToLayer(layer);

    for (const point of expanded) {
      expectPixelNear(
        layer,
        Math.round(point.x),
        Math.round(point.y),
        [210, 70, 40, 255],
      );
    }
    expectPixelNear(layer, 128, 128, [12, 34, 56, 255]);
    expect(brushPerfDebug.snapshot().samples.gpuCommitPixels).toEqual([
      4 * 16 * 16,
    ]);
    expect(brushPerfDebug.snapshot().samples.gpuCommitDraws).toEqual([4]);
  });
});

function makeSweepSegment(fromDistance: number, toDistance: number) {
  return {
    fromX: 20,
    fromY: 32,
    toX: 40,
    toY: 32,
    fromFrameX: 1,
    fromFrameY: 0,
    toFrameX: 1,
    toFrameY: 0,
    fromPressure: 1,
    toPressure: 1,
    fromDistance,
    toDistance,
    overlap: 1,
    trialId: fromDistance,
  } as const;
}

function renderBristlePerFlushForTest(
  source: OffscreenCanvas,
): Uint8ClampedArray {
  const surface = createGpuStrokeSurface(source.width, source.height, "bitmap");
  expect(surface).not.toBeNull();
  if (!surface) return new Uint8ClampedArray();
  try {
    surface.beginStroke(source);
    const profile = new OffscreenCanvas(2, 16);
    const profileCtx = profile.getContext("2d");
    expect(profileCtx).not.toBeNull();
    if (!profileCtx) return new Uint8ClampedArray();
    profileCtx.fillStyle = "white";
    profileCtx.fillRect(0, 0, profile.width, profile.height);
    const chunk: GpuBristleChunk = {
      segments: [makeSweepSegment(0, 1)],
      simpleMask: {
        dropoutLengthPx: 40,
        dropoutWidthPx: 4,
        pressureCoverageResponse: 1,
      },
      profileAtlas: profile,
      grain: {
        amount: 0,
        softness: 0.1,
        grainSeed: 1,
        strokeSeed: 2,
        toothHeights: new Float32Array(128 * 128),
      },
      bboxRect: { left: 12, top: 22, right: 48, bottom: 42 },
      brushSize: 12,
      depositHardness: 1,
      color: { r: 180, g: 180, b: 180, a: 0 },
      useMaterialField: false,
    };
    const baseColor = { r: 180, g: 180, b: 180, a: 255 } as const;
    surface.initializeMaterialField(4, 4, baseColor);
    surface.initializeMaterialCheckpoint(0, 0, 24);
    surface.beginBranchBatch();
    for (const [index, centerX] of [12, 36, 60].entries()) {
      surface.pushBristleChunk(chunk);
      surface.updateMaterialField({
        baseColor,
        centerX,
        centerY: 24,
        angle: 0,
        sampleSize: 8,
        columns: 4,
        rows: 4,
        pickupRatePerPx: 0.12,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        distancePx: 4,
      });
      if (index < 2) {
        surface.snapshotMaterialCheckpoint((index + 1) * 24, 0, 24);
      }
    }
    surface.endBranchBatch();
    return surface.readMaterialFieldForTest();
  } finally {
    surface.dispose();
  }
}

function materialFieldMae(
  expected: Uint8ClampedArray,
  actual: Uint8ClampedArray,
): number {
  expect(actual).toHaveLength(expected.length);
  let absoluteDelta = 0;
  for (let index = 0; index < expected.length; index++) {
    absoluteDelta += Math.abs((expected[index] ?? 0) - (actual[index] ?? 0));
  }
  return absoluteDelta / expected.length / 255;
}

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
