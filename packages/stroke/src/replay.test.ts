import type { Layer } from "@headless-paint/engine";
import { appendToCommittedLayer } from "@headless-paint/engine";
import { describe, expect, it, vi } from "vitest";
import { replayCommand } from "./replay";
import type { StrokeCommand } from "./types";

vi.mock("@headless-paint/input", () => ({
  compileFilterPipeline: vi.fn((config) => ({ config })),
  processAllPoints: vi.fn((points) => points),
}));

vi.mock("@headless-paint/engine", () => ({
  appendToCommittedLayer: vi.fn(),
  clearLayer: vi.fn(),
  compileExpand: vi.fn((config) => ({ config, matrices: [], outputCount: 1 })),
  copyLayerPixels: vi.fn(),
  createLayer: vi.fn(() => ({
    id: "source",
    width: 100,
    height: 100,
    canvas: {},
    ctx: { drawImage: vi.fn() },
    meta: { name: "source", visible: true, opacity: 1, alphaLocked: false },
  })),
  generateBrushTip: vi.fn(),
  getImageData: vi.fn(),
  mergeLayerDown: vi.fn(),
  transformLayer: vi.fn(),
  wrapShiftLayer: vi.fn(),
}));

function createLayerStub(alphaLocked: boolean): Layer {
  return {
    id: "layer",
    width: 100,
    height: 100,
    canvas: {} as OffscreenCanvas,
    ctx: {} as OffscreenCanvasRenderingContext2D,
    meta: {
      name: "layer",
      visible: true,
      opacity: 1,
      alphaLocked,
    },
  };
}

function createCommand(alphaLocked: boolean): StrokeCommand {
  return {
    type: "stroke",
    layerId: "layer",
    inputPoints: [
      { x: 40, y: 50, timestamp: 1000 },
      { x: 80, y: 50, timestamp: 1001 },
    ],
    filterPipeline: { filters: [] },
    expand: {
      levels: [
        { mode: "none", offset: { x: 50, y: 50 }, angle: 0, divisions: 1 },
      ],
    },
    style: {
      color: { r: 255, g: 0, b: 0, a: 255 },
      lineWidth: 6,
      pressureCurve: { y1: 1 / 3, y2: 2 / 3 },
      compositeOperation: "source-over",
      brush: { type: "round-pen", pressureDynamics: { size: 1, flow: 0 } },
    },
    brushSeed: 0,
    alphaLocked,
    timestamp: 1002,
  };
}

describe("replayCommand", () => {
  it("passes StrokeCommand alpha lock state instead of current layer meta", () => {
    replayCommand(createLayerStub(false), createCommand(true));

    expect(appendToCommittedLayer).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      0,
      undefined,
      undefined,
      true,
    );
  });

  it("passes false when command is unlocked even if current layer is locked", () => {
    replayCommand(createLayerStub(true), createCommand(false));

    expect(appendToCommittedLayer).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      0,
      undefined,
      undefined,
      false,
    );
  });
});
