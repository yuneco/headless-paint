import { describe, expect, it } from "vitest";
import { renderBrushStroke } from "..";
import { createLayer } from "../../layer";
import {
  type BrushRenderState,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  ROUGH_BRISTLE,
  type StrokePoint,
  type StrokeStyle,
} from "../../types";
import {
  type BristleMaskSweepSample,
  createSimpleBristleMaskEvaluator,
  getFineToothHeightTile,
  rasterizeBristleMaskEvaluatorForTest,
} from "../bristle-mask";
import { brushPerfDebug } from "../perf-debug";
import {
  createBrushAccelerator,
  getBrushAcceleratorRuntime,
} from "./accelerator";
import { createGpuBristlePassResources } from "./bristle-pass";
import type { GpuBristleChunk, GpuSweepSegment } from "./gpu-stroke-surface";

describe("GPU bristle mask parity", () => {
  it.each([
    { direction: "left-to-right", reverse: false },
    { direction: "right-to-left", reverse: true },
  ])(
    "$direction mixing keeps picked-up band color on the touched side within Tier B",
    ({ reverse }) => {
      const cpuLayer = renderMixingBandStroke(reverse, false);
      const gpuLayer = renderMixingBandStroke(reverse, true);
      const metrics = compareAlpha(
        readCanvasAlpha(cpuLayer.canvas),
        readCanvasAlpha(gpuLayer.canvas),
      );
      console.info("GPU bristle directional mixing parity", reverse, metrics);
      expect(metrics.alphaMae).toBeLessThanOrEqual(0.015);
      expect(metrics.largeDeltaRate).toBeLessThanOrEqual(0.01);
      expect(metrics.coverageDifferencePoints).toBeLessThanOrEqual(2);

      // Both probes are beyond the band, on initially transparent pixels.
      // Alpha parity alone cannot catch red paint mirrored across the stroke.
      const probeX = reverse ? 38 : 166;
      for (const layer of [cpuLayer, gpuLayer]) {
        const touched = redPickup(layer.canvas, probeX, 50, 16, 6);
        const untouched = redPickup(layer.canvas, probeX, 72, 16, 6);
        expect(touched).toBeGreaterThan(0.02);
        expect(untouched).toBeLessThan(touched * 0.25);
      }
    },
  );

  it("matches the CPU raster for the same rough bristle simple mask and sweep", () => {
    const width = 160;
    const height = 96;
    const brushSize = 60;
    const seed = 0x1234abcd;
    const originX = 37;
    const originY = 19;
    const samples = createCurvedSamples();
    const dynamics = ROUGH_BRISTLE.dynamics;
    const field = createSimpleBristleMaskEvaluator(
      samples,
      brushSize,
      dynamics,
      ROUGH_BRISTLE.pressureDynamics.coverage,
      seed,
    );
    const cpuMask = rasterizeBristleMaskEvaluatorForTest(
      field,
      samples,
      brushSize,
      dynamics,
      seed,
      originX,
      originY,
      width,
      height,
    );

    const canvas = new OffscreenCanvas(width, height);
    const gl = canvas.getContext("webgl2");
    expect(gl).not.toBeNull();
    if (!gl) return;
    const pass = createGpuBristlePassResources(gl, width, height);
    const profile = new OffscreenCanvas(2, brushSize);
    const chunk: GpuBristleChunk = {
      segments: createSegments(samples, dynamics.geometryStepPx),
      simpleMask: {
        dropoutLengthPx: Math.max(4, dynamics.dropoutLengthPx),
        dropoutWidthPx: Math.max(0.5, dynamics.dropoutWidthPx),
        pressureCoverageResponse: ROUGH_BRISTLE.pressureDynamics.coverage,
      },
      profileAtlas: profile,
      grain: {
        amount: dynamics.surfaceGrain.amount,
        softness: 0.01 + (1 - dynamics.surfaceGrain.hardness) * 0.24,
        grainSeed: dynamics.surfaceGrain.seed,
        strokeSeed: seed,
        toothHeights: getFineToothHeightTile(
          dynamics.surfaceGrain.seed,
          dynamics.surfaceGrain.scalePx,
        ),
      },
      bboxRect: {
        left: originX,
        top: originY,
        right: originX + width,
        bottom: originY + height,
      },
      brushSize,
      depositHardness: dynamics.depositHardness,
      color: { r: 0, g: 0, b: 0, a: 255 },
      useMaterialField: false,
    };

    try {
      pass.readMaskForTest(createLargerWarmupChunk(chunk));
      const cpuAlpha = readCanvasAlpha(cpuMask);
      const gpuAlpha = pass.readMaskForTest(chunk);
      const metrics = compareAlpha(cpuAlpha, gpuAlpha);
      console.info("GPU bristle mask parity", metrics);

      expect(metrics.alphaMae).toBeLessThanOrEqual(0.015);
      expect(metrics.largeDeltaRate).toBeLessThanOrEqual(0.01);
      expect(metrics.coverageDifferencePoints).toBeLessThanOrEqual(2);
    } finally {
      pass.dispose();
    }
  });

  it("reports procedural simple mask parity and stays deterministic", () => {
    const width = 160;
    const height = 96;
    const brushSize = 60;
    const seed = 0x1234abcd;
    const originX = 37;
    const originY = 19;
    const samples = createCurvedSamples();
    const dynamics = ROUGH_BRISTLE.dynamics;
    const field = createSimpleBristleMaskEvaluator(
      samples,
      brushSize,
      dynamics,
      ROUGH_BRISTLE.pressureDynamics.coverage,
      seed,
    );
    const cpuMask = rasterizeBristleMaskEvaluatorForTest(
      field,
      samples,
      brushSize,
      dynamics,
      seed,
      originX,
      originY,
      width,
      height,
    );

    const canvas = new OffscreenCanvas(width, height);
    const gl = canvas.getContext("webgl2");
    expect(gl).not.toBeNull();
    if (!gl) return;
    const pass = createGpuBristlePassResources(gl, width, height);
    const chunk: GpuBristleChunk = {
      segments: createSegments(samples, dynamics.geometryStepPx),
      simpleMask: {
        dropoutLengthPx: Math.max(4, dynamics.dropoutLengthPx),
        dropoutWidthPx: Math.max(0.5, dynamics.dropoutWidthPx),
        pressureCoverageResponse: ROUGH_BRISTLE.pressureDynamics.coverage,
      },
      profileAtlas: new OffscreenCanvas(2, brushSize),
      grain: {
        amount: dynamics.surfaceGrain.amount,
        softness: 0.01 + (1 - dynamics.surfaceGrain.hardness) * 0.24,
        grainSeed: dynamics.surfaceGrain.seed,
        strokeSeed: seed,
        toothHeights: getFineToothHeightTile(
          dynamics.surfaceGrain.seed,
          dynamics.surfaceGrain.scalePx,
        ),
      },
      bboxRect: {
        left: originX,
        top: originY,
        right: originX + width,
        bottom: originY + height,
      },
      brushSize,
      depositHardness: dynamics.depositHardness,
      color: { r: 0, g: 0, b: 0, a: 255 },
      useMaterialField: false,
    };

    try {
      const first = pass.readMaskForTest(chunk);
      const second = pass.readMaskForTest(chunk);
      const metrics = compareAlpha(readCanvasAlpha(cpuMask), first);
      console.info("GPU bristle simple mask parity", metrics);

      expect(second).toEqual(first);
      expect(metrics.coverageDifferencePoints).toBeLessThanOrEqual(2);
    } finally {
      pass.dispose();
    }
  });

  it("keeps incremental rough bristle chunks within Tier B", () => {
    const cpuLayer = createLayer(220, 150);
    const gpuLayer = createLayer(220, 150);
    const points = createStrokePoints();
    const style: StrokeStyle = {
      color: { r: 20, g: 40, b: 60, a: 255 },
      lineWidth: 60,
      pressureCurve: DEFAULT_PRESSURE_CURVE,
      compositeOperation: "source-over",
      brush: ROUGH_BRISTLE,
    };
    const initialState: BrushRenderState = {
      tipCanvas: null,
      seed: 0x1234abcd,
      branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
    };
    let cpuState = renderBrushStroke(
      cpuLayer,
      points.slice(0, 9),
      style,
      0,
      initialState,
    );
    cpuState = renderBrushStroke(
      cpuLayer,
      points.slice(6, 17),
      style,
      3,
      cpuState,
    );
    renderBrushStroke(cpuLayer, points.slice(14), style, 3, cpuState);

    const accelerator = createBrushAccelerator({
      backend: "webgl2",
      resident: false,
    });
    expect(accelerator).not.toBeNull();
    if (!accelerator) return;
    const runtime = getBrushAcceleratorRuntime(accelerator);
    expect(runtime).not.toBeNull();
    if (!runtime) return;
    const owner = {};
    expect(runtime.beginStroke(owner, gpuLayer, gpuLayer.canvas)).toBe(true);
    const gpuBatches = [
      points.slice(0, 9),
      points.slice(6, 17),
      points.slice(14),
    ];
    let gpuState = initialState;
    for (let index = 0; index < gpuBatches.length; index++) {
      const batch = gpuBatches[index];
      if (!batch) continue;
      runtime.enter(owner);
      try {
        gpuState = renderBrushStroke(
          gpuLayer,
          batch,
          style,
          index === 0 ? 0 : 3,
          gpuState,
          gpuLayer,
          accelerator,
        );
      } finally {
        runtime.leave(owner);
      }
      runtime.commitToLayer(owner, gpuLayer);
    }
    runtime.endStroke(owner);
    accelerator.dispose();

    const metrics = compareAlpha(
      readCanvasAlpha(cpuLayer.canvas),
      readCanvasAlpha(gpuLayer.canvas),
    );
    console.info("GPU rough bristle incremental parity", metrics);
    expect(metrics.alphaMae).toBeLessThanOrEqual(0.015);
    expect(metrics.largeDeltaRate).toBeLessThanOrEqual(0.01);
    expect(metrics.coverageDifferencePoints).toBeLessThanOrEqual(2);
  });

  it("does not generate or upload a CPU mask field in the GPU path", () => {
    const previousPerfEnabled = brushPerfDebug.enabled;
    brushPerfDebug.enabled = true;
    brushPerfDebug.reset();

    const layer = createLayer(220, 150);
    const style: StrokeStyle = {
      color: { r: 20, g: 40, b: 60, a: 255 },
      lineWidth: 60,
      pressureCurve: DEFAULT_PRESSURE_CURVE,
      compositeOperation: "source-over",
      brush: ROUGH_BRISTLE,
    };
    const accelerator = createBrushAccelerator({
      backend: "webgl2",
      resident: false,
    });
    expect(accelerator).not.toBeNull();
    if (!accelerator) throw new Error("WebGL2 accelerator unavailable");
    const runtime = getBrushAcceleratorRuntime(accelerator);
    expect(runtime).not.toBeNull();
    if (!runtime) throw new Error("WebGL2 accelerator runtime unavailable");
    const owner = {};

    try {
      expect(runtime.beginStroke(owner, layer, layer.canvas)).toBe(true);
      runtime.enter(owner);
      try {
        renderBrushStroke(
          layer,
          createStrokePoints(),
          style,
          0,
          {
            tipCanvas: null,
            seed: 0x1234abcd,
            branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
          },
          layer,
          accelerator,
        );
      } finally {
        runtime.leave(owner);
      }
      runtime.commitToLayer(owner, layer);
      runtime.endStroke(owner);

      const snapshot = brushPerfDebug.snapshot();
      expect(snapshot.stages.maskField.count).toBe(0);
      expect(snapshot.samples.fieldCells).toEqual([]);
    } finally {
      accelerator.dispose();
      brushPerfDebug.enabled = previousPerfEnabled;
      brushPerfDebug.reset();
    }
  });
});

function renderMixingBandStroke(reverse: boolean, gpu: boolean) {
  const layer = createLayer(220, 128);
  // Only the upper half of the brush touches this finite red band.
  layer.ctx.fillStyle = "rgb(230, 30, 30)";
  layer.ctx.fillRect(64, 16, 92, 48);
  const sourceLayer = createLayer(layer.canvas.width, layer.canvas.height);
  sourceLayer.ctx.drawImage(layer.canvas, 0, 0);
  const points: StrokePoint[] = Array.from({ length: 44 }, (_, index) => ({
    x: reverse ? 196 - index * 4 : 24 + index * 4,
    y: 64,
    pressure: 1,
  }));
  const style: StrokeStyle = {
    color: { r: 255, g: 255, b: 255, a: 255 },
    lineWidth: 40,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush: {
      ...ROUGH_BRISTLE,
      mixing: {
        ...DEFAULT_BRUSH_MIXING,
        enabled: true,
        pickupRatePerPx: 0.04,
        restoreRatePerPx: 0,
        diffusionRatePerPx: 0,
        updateDistancePx: 4,
        checkpointDistancePx: 4,
      },
    },
  };
  const initialState: BrushRenderState = {
    tipCanvas: null,
    seed: 0x1234abcd,
    branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
  };
  const accelerator = gpu
    ? createBrushAccelerator({ backend: "webgl2", resident: false })
    : null;
  const runtime = accelerator ? getBrushAcceleratorRuntime(accelerator) : null;
  const owner = {};
  try {
    if (gpu) {
      expect(accelerator).not.toBeNull();
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
        initialState,
        sourceLayer,
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

function redPickup(
  canvas: OffscreenCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  const rgba = ctx.getImageData(x, y, width, height).data;
  let pickup = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    pickup +=
      (((rgba[offset] ?? 0) - (rgba[offset + 1] ?? 0)) / 255) *
      ((rgba[offset + 3] ?? 0) / 255);
  }
  return pickup / (width * height);
}

function createStrokePoints(): StrokePoint[] {
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    return {
      x: 25 + t * 170,
      y: 75 + Math.sin(t * Math.PI * 2) * 28,
      pressure: 0.25 + 0.5 * Math.sin(t * Math.PI) ** 2,
    };
  });
}

function createLargerWarmupChunk(chunk: GpuBristleChunk): GpuBristleChunk {
  return {
    ...chunk,
    segments: [
      {
        ...(chunk.segments[0] ?? {
          fromX: 0,
          fromY: 0,
          toX: 1,
          toY: 0,
          fromFrameX: 1,
          fromFrameY: 0,
          toFrameX: 1,
          toFrameY: 0,
          fromPressure: 0.5,
          toPressure: 0.5,
          fromDistance: 0,
          toDistance: 1,
          overlap: 0,
          trialId: 0,
        }),
      },
    ],
    bboxRect: {
      left: chunk.bboxRect.left,
      top: chunk.bboxRect.top,
      right: chunk.bboxRect.left + 224,
      bottom: chunk.bboxRect.top + 128,
    },
  };
}

function createCurvedSamples(): BristleMaskSweepSample[] {
  const positions = Array.from({ length: 121 }, (_, index) => ({
    x: 21.25 + index * 0.96,
    y: 47.4 + Math.sin(index * 0.075) * 10.5,
  }));
  const samples: BristleMaskSweepSample[] = [];
  let distance = 0;
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index];
    const previous = positions[Math.max(0, index - 1)];
    const next = positions[Math.min(positions.length - 1, index + 1)];
    if (!position || !previous || !next) continue;
    if (index > 0) {
      distance += Math.hypot(position.x - previous.x, position.y - previous.y);
    }
    const frameLength = Math.hypot(next.x - previous.x, next.y - previous.y);
    samples.push({
      x: position.x,
      y: position.y,
      pressure: 0.3 + 0.28 * (0.5 + 0.5 * Math.sin(index * 0.043)),
      distance,
      frameX: (next.x - previous.x) / frameLength,
      frameY: (next.y - previous.y) / frameLength,
    });
  }
  for (let index = positions.length - 1; index >= 0; index--) {
    const position = positions[index];
    const previous = positions[Math.min(positions.length - 1, index + 1)];
    const next = positions[Math.max(0, index - 1)];
    if (!position || !previous || !next) continue;
    distance += Math.hypot(position.x - previous.x, position.y - previous.y);
    const frameLength = Math.hypot(next.x - previous.x, next.y - previous.y);
    samples.push({
      x: position.x,
      y: position.y,
      pressure: 0.3 + 0.28 * (0.5 + 0.5 * Math.sin(index * 0.043)),
      distance,
      frameX: (next.x - previous.x) / frameLength,
      frameY: (next.y - previous.y) / frameLength,
      breakBefore: index === positions.length - 1,
    });
  }
  return samples;
}

function createSegments(
  samples: readonly BristleMaskSweepSample[],
  geometryStepPx: number,
): GpuSweepSegment[] {
  const segments: GpuSweepSegment[] = [];
  for (let index = 1; index < samples.length; index++) {
    const from = samples[index - 1];
    const to = samples[index];
    if (!from || !to || to.breakBefore) continue;
    segments.push({
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      fromFrameX: from.frameX,
      fromFrameY: from.frameY,
      toFrameX: to.frameX,
      toFrameY: to.frameY,
      fromPressure: from.pressure,
      toPressure: to.pressure,
      fromDistance: from.distance,
      toDistance: to.distance,
      overlap: 0,
      trialId: Math.round(
        ((from.distance + to.distance) * 0.5) / Math.max(0.5, geometryStepPx),
      ),
    });
  }
  return segments;
}

function readCanvasAlpha(canvas: OffscreenCanvas): Uint8ClampedArray {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let index = 0; index < alpha.length; index++) {
    alpha[index] = rgba[index * 4 + 3] ?? 0;
  }
  return alpha;
}

function compareAlpha(
  cpu: Uint8ClampedArray,
  gpu: Uint8ClampedArray,
): {
  readonly cpuCoverage: number;
  readonly gpuCoverage: number;
  readonly coverageDifferencePoints: number;
  readonly alphaMae: number;
  readonly largeDeltaRate: number;
} {
  expect(gpu.length).toBe(cpu.length);
  let cpuCovered = 0;
  let gpuCovered = 0;
  let absoluteError = 0;
  let largeDeltaPixels = 0;
  for (let index = 0; index < cpu.length; index++) {
    const cpuAlpha = (cpu[index] ?? 0) / 255;
    const gpuAlpha = (gpu[index] ?? 0) / 255;
    if (cpuAlpha > 0) cpuCovered++;
    if (gpuAlpha > 0) gpuCovered++;
    const delta = Math.abs(cpuAlpha - gpuAlpha);
    absoluteError += delta;
    if (delta > 0.1) largeDeltaPixels++;
  }
  const cpuCoverage = cpuCovered / cpu.length;
  const gpuCoverage = gpuCovered / gpu.length;
  return {
    cpuCoverage,
    gpuCoverage,
    coverageDifferencePoints: Math.abs(cpuCoverage - gpuCoverage) * 100,
    alphaMae: absoluteError / cpu.length,
    largeDeltaRate: largeDeltaPixels / cpu.length,
  };
}
