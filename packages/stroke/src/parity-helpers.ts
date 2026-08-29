import type {
  BrushAccelerator,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import {
  copyLayerPixels,
  createLayer,
  getImageData,
} from "@headless-paint/engine";
import type { FilterPipelineConfig, InputPoint } from "@headless-paint/input";
import { expect } from "vitest";
import { replayCommand } from "./replay";
import { createStrokeRuntime } from "./stroke-runtime";
import type { StrokeCommand } from "./types";

export interface SimulateLiveStrokeOptions {
  readonly layer: Layer;
  readonly inputPoints: readonly InputPoint[];
  readonly style: StrokeStyle;
  readonly filterPipeline: FilterPipelineConfig;
  readonly expand: ExpandConfig;
  readonly brushSeed: number;
  readonly alphaLocked: boolean;
  readonly accelerator?: BrushAccelerator | null;
}

export interface SimulateLiveStrokeResult {
  readonly command: StrokeCommand;
}

export function simulateLiveStroke(
  opts: SimulateLiveStrokeOptions,
): SimulateLiveStrokeResult {
  const firstPoint = opts.inputPoints[0];
  if (!firstPoint) {
    throw new Error("simulateLiveStroke requires at least one input point");
  }

  let command: StrokeCommand | null = null;
  const pendingLayer = createLayer(opts.layer.width, opts.layer.height);
  const runtime = createStrokeRuntime({
    setTimeout: () => 0,
    clearTimeout: () => {},
    now: () => firstPoint.timestamp ?? 0,
    requestRender: () => {},
    onCommit: (committed) => {
      command = committed;
    },
    onDrawingChanged: () => {},
    randomSeed: () => opts.brushSeed,
    accelerator: opts.accelerator,
  });

  runtime.start(firstPoint, {
    layer: opts.layer,
    pendingLayer,
    style: opts.style,
    filterPipeline: opts.filterPipeline,
    expand: opts.expand,
    alphaLocked: opts.alphaLocked,
    brushSeed: opts.brushSeed,
  });

  for (const inputPoint of opts.inputPoints.slice(1)) {
    runtime.move(inputPoint);
  }
  runtime.end();

  if (!command) {
    throw new Error("simulateLiveStroke did not commit a stroke command");
  }

  return { command };
}

export function replayOnLayer(
  command: StrokeCommand,
  layer: Layer,
  sourceLayer?: Layer,
  accelerator?: BrushAccelerator | null,
): void {
  if (sourceLayer) {
    copyLayerPixels(sourceLayer, layer);
  }
  replayCommand(layer, command, undefined, { accelerator });
}

export function expectPixelEqual(
  actual: Layer,
  expected: Layer,
  label: string,
): void {
  const diff = calculateLayerPixelDiff(actual, expected, label);
  expect(diff.count, formatDiffMessage(label, diff)).toBe(0);
}

export interface PixelDiff {
  readonly count: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxChannelDelta: number;
}

export function calculateLayerPixelDiff(
  actual: Layer,
  expected: Layer,
  label = "pixel diff",
): PixelDiff {
  const actualImage = getImageData(actual);
  const expectedImage = getImageData(expected);
  expect(actualImage.width, `${label}: width differs`).toBe(
    expectedImage.width,
  );
  expect(actualImage.height, `${label}: height differs`).toBe(
    expectedImage.height,
  );

  return calculatePixelDiff(
    actualImage.data,
    expectedImage.data,
    actualImage.width,
  );
}

function calculatePixelDiff(
  actual: Uint8ClampedArray,
  expected: Uint8ClampedArray,
  width: number,
): PixelDiff {
  const pixelCount = Math.max(actual.length, expected.length) / 4;
  let count = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxChannelDelta = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const offset = pixelIndex * 4;
    const deltaR = Math.abs((actual[offset] ?? 0) - (expected[offset] ?? 0));
    const deltaG = Math.abs(
      (actual[offset + 1] ?? 0) - (expected[offset + 1] ?? 0),
    );
    const deltaB = Math.abs(
      (actual[offset + 2] ?? 0) - (expected[offset + 2] ?? 0),
    );
    const deltaA = Math.abs(
      (actual[offset + 3] ?? 0) - (expected[offset + 3] ?? 0),
    );

    const pixelMaxDelta = Math.max(deltaR, deltaG, deltaB, deltaA);
    if (pixelMaxDelta === 0) {
      continue;
    }

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    count++;
    maxChannelDelta = Math.max(maxChannelDelta, pixelMaxDelta);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (count === 0) {
    return {
      count: 0,
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      maxChannelDelta: 0,
    };
  }
  return { count, minX, minY, maxX, maxY, maxChannelDelta };
}

function formatDiffMessage(label: string, diff: PixelDiff): string {
  if (diff.count === 0) return `${label}: pixels match`;
  return `${label}: ${diff.count} differing pixels, maxChannelDelta=${diff.maxChannelDelta}, bbox=(${diff.minX},${diff.minY})-(${diff.maxX},${diff.maxY})`;
}
