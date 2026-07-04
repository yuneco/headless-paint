import type {
  BrushRenderState,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import {
  appendToCommittedLayer,
  compileExpand,
  copyLayerPixels,
  createLayer,
  generateBrushTip,
  getImageData,
} from "@headless-paint/engine";
import {
  compileFilterPipeline,
  createFilterPipelineState,
  finalizePipeline,
  processPoint,
} from "@headless-paint/input";
import type { FilterPipelineConfig, InputPoint } from "@headless-paint/input";
import { expect } from "vitest";
import { replayCommand } from "./replay";
import { addPointToSession, startStrokeSession } from "./session";
import type { StrokeCommand } from "./types";

export interface SimulateLiveStrokeOptions {
  readonly layer: Layer;
  readonly inputPoints: readonly InputPoint[];
  readonly style: StrokeStyle;
  readonly filterPipeline: FilterPipelineConfig;
  readonly expand: ExpandConfig;
  readonly brushSeed: number;
  readonly alphaLocked: boolean;
  readonly sourceLayer?: Layer;
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

  const compiledFilterPipeline = compileFilterPipeline(opts.filterPipeline);
  const compiledExpand = compileExpand(opts.expand);
  let filterState = createFilterPipelineState(compiledFilterPipeline);
  const firstFilterResult = processPoint(
    filterState,
    firstPoint,
    compiledFilterPipeline,
  );
  filterState = firstFilterResult.state;

  let strokeResult = startStrokeSession(
    firstFilterResult.output,
    opts.style,
    opts.expand,
  );
  let strokeSession = strokeResult.state;
  let brushState = createInitialBrushState(opts.style, opts.brushSeed);
  const samplingLayer =
    opts.sourceLayer ?? createSamplingLayer(opts.layer, opts.style);

  brushState = appendToCommittedLayer(
    opts.layer,
    strokeResult.renderUpdate.newlyCommitted,
    opts.style,
    compiledExpand,
    strokeResult.renderUpdate.committedOverlapCount,
    brushState,
    samplingLayer,
    opts.alphaLocked,
  );

  for (const inputPoint of opts.inputPoints.slice(1)) {
    const filterResult = processPoint(
      filterState,
      inputPoint,
      compiledFilterPipeline,
    );
    filterState = filterResult.state;

    strokeResult = addPointToSession(strokeSession, filterResult.output);
    strokeSession = strokeResult.state;
    brushState = appendToCommittedLayer(
      opts.layer,
      strokeResult.renderUpdate.newlyCommitted,
      opts.style,
      compiledExpand,
      strokeResult.renderUpdate.committedOverlapCount,
      brushState,
      samplingLayer,
      opts.alphaLocked,
    );
  }

  const finalOutput = finalizePipeline(filterState, compiledFilterPipeline);
  const finalStrokeResult = addPointToSession(strokeSession, finalOutput);
  appendToCommittedLayer(
    opts.layer,
    finalStrokeResult.renderUpdate.newlyCommitted,
    opts.style,
    compiledExpand,
    finalStrokeResult.renderUpdate.committedOverlapCount,
    brushState,
    samplingLayer,
    opts.alphaLocked,
  );

  return {
    command: {
      type: "stroke",
      layerId: opts.layer.id,
      inputPoints: [...opts.inputPoints],
      filterPipeline: opts.filterPipeline,
      expand: opts.expand,
      style: opts.style,
      brushSeed: opts.brushSeed,
      alphaLocked: opts.alphaLocked,
      timestamp: 1_000_000,
    },
  };
}

export function replayOnLayer(
  command: StrokeCommand,
  layer: Layer,
  sourceLayer?: Layer,
): void {
  if (sourceLayer) {
    copyLayerPixels(sourceLayer, layer);
  }
  replayCommand(layer, command);
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

function createInitialBrushState(
  style: StrokeStyle,
  brushSeed: number,
): BrushRenderState | undefined {
  if (style.brush.type === "round-pen") return undefined;

  const tipCanvas =
    style.brush.type === "stamp"
      ? generateBrushTip(
          style.brush.tip,
          Math.ceil(style.lineWidth * 2),
          style.color,
        )
      : generateBrushTip(
          style.brush.particle,
          calculateSprayTipSize(style),
          style.color,
        );

  return {
    tipCanvas,
    seed: brushSeed,
    branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
  };
}

function calculateSprayTipSize(style: StrokeStyle): number {
  if (style.brush.type !== "spray") return 0;
  const maxScale = style.brush.dynamics.sizeJitterMode === "lognormal" ? 4 : 1;
  return Math.ceil(style.brush.dynamics.particleSize * maxScale);
}

function createSamplingLayer(
  layer: Layer,
  style: StrokeStyle,
): Layer | undefined {
  if (style.brush.type !== "stamp" || !style.brush.mixing?.enabled) {
    return undefined;
  }
  const samplingLayer = createLayer(layer.width, layer.height);
  copyLayerPixels(layer, samplingLayer);
  return samplingLayer;
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
