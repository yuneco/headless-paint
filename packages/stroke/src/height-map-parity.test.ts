import {
  type BristleBrushConfig,
  DEFAULT_PRESSURE_CURVE,
  ROUGH_BRISTLE,
  type StrokeStyle,
  createBrushAssetRegistry,
  createLayer,
} from "@headless-paint/engine";
import { describe, expect, it } from "vitest";
import { executeHistoryOp } from "./command-executor";
import {
  beginHistoryMutation,
  createHistoryState,
  pushCommand,
} from "./history";
import { replayCommand } from "./replay";
import { createStrokeRuntime } from "./stroke-runtime";
import type { StrokeCommand } from "./types";

const width = 160;
const height = 80;
const expand = {
  levels: [
    { mode: "none" as const, offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
  ],
};
const points = Array.from({ length: 25 }, (_, index) => ({
  x: 16 + index * 5,
  y: 40 + Math.sin(index / 4) * 8,
  pressure: 0.3 + index / 50,
  timestamp: index * 8,
}));

function pixels(layer: ReturnType<typeof createLayer>) {
  return layer.ctx.getImageData(0, 0, width, height).data;
}

describe("registered height map raster parity", () => {
  it("live, replay and undo/redo are byte-identical with registry paper", () => {
    const registry = createBrushAssetRegistry();
    registry.setHeightMap("paper", {
      width: 8,
      height: 4,
      heights: Float32Array.from({ length: 32 }, (_, index) => (index % 5) / 4),
    });
    const brush: BristleBrushConfig = {
      ...ROUGH_BRISTLE,
      dynamics: {
        ...ROUGH_BRISTLE.dynamics,
        surfaceGrain: {
          ...ROUGH_BRISTLE.dynamics.surfaceGrain,
          heightMapId: "paper",
          scalePx: 2,
        },
      },
    };
    const style: StrokeStyle = {
      brush,
      lineWidth: 20,
      color: { r: 30, g: 80, b: 100, a: 255 },
      pressureCurve: DEFAULT_PRESSURE_CURVE,
      compositeOperation: "source-over",
    };
    const live = createLayer(width, height);
    let history = beginHistoryMutation(
      createHistoryState(width, height, { layerCount: 1 }),
      {
        affectedLayers: [live],
        layerCount: 1,
      },
    );
    let command: StrokeCommand | undefined;
    const runtime = createStrokeRuntime({
      setTimeout: () => 0,
      clearTimeout: () => {},
      now: () => 0,
      requestRender: () => {},
      onDrawingChanged: () => {},
      onCommit: (value) => {
        command = value;
      },
    });
    runtime.start(points[0], {
      layer: live,
      pendingLayer: createLayer(width, height),
      style,
      filterPipeline: { filters: [] },
      expand,
      alphaLocked: false,
      brushSeed: 17,
      registry,
    });
    for (let index = 1; index < points.length; index += 4) {
      runtime.moveMany(points.slice(index, index + 4));
      runtime.confirm();
    }
    runtime.end();
    if (!command) throw new Error("Expected a committed stroke");
    const expected = pixels(live);
    expect(expected.some((value) => value !== 0)).toBe(true);
    const replay = createLayer(width, height);
    replayCommand(replay, command, registry);
    expect(pixels(replay)).toEqual(expected);
    history = pushCommand(history, command, {
      afterLayer: live,
      layerCount: 1,
    });
    const undone = executeHistoryOp("undo", history, {
      layers: [live],
      registry,
    });
    expect(undone.ok).toBe(true);
    expect(pixels(live).every((value) => value === 0)).toBe(true);
    const redone = executeHistoryOp("redo", undone.next, {
      layers: [live],
      registry,
    });
    expect(redone.ok).toBe(true);
    expect(pixels(live)).toEqual(expected);
    // This proves the shared result actually uses the registered map.
    const different = createLayer(width, height);
    registry.setHeightMap("paper", {
      width: 1,
      height: 1,
      heights: new Float32Array([0]),
    });
    replayCommand(different, command, registry);
    expect(pixels(different)).not.toEqual(expected);
    runtime.dispose();
  });
});
