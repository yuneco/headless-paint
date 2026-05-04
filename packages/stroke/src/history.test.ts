import { describe, expect, it, vi } from "vitest";
import {
  beginHistoryMutation,
  canRedo,
  canUndo,
  computeCumulativeOffset,
  createHistoryState,
  getAffectedLayerIds,
  getCommandAt,
  getCommandsToReplayForLayer,
  getHistoryMetrics,
  pushCommand,
  redo,
  undo,
} from "./history";
import type {
  ClearCommand,
  Command,
  DuplicateLayerCommand,
  HistoryConfig,
  HistoryState,
  MergeLayerDownCommand,
  StrokeCommand,
  WrapShiftCommand,
} from "./types";

function createMockImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  } as ImageData;
}

vi.mock("@headless-paint/engine", () => ({
  clearLayer: vi.fn(),
  getImageData: vi.fn(() => createMockImageData(100, 100)),
}));

function createMockLayer(id = "layer_1") {
  return {
    id,
    width: 100,
    height: 100,
    canvas: {} as OffscreenCanvas,
    ctx: {
      putImageData: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D,
    meta: { name: "test", visible: true, opacity: 1 },
  };
}

function createStrokeCommand(
  timestamp: number,
  layerId = "layer_1",
): StrokeCommand {
  return {
    type: "stroke",
    layerId,
    inputPoints: [
      { x: 10, y: 20, timestamp },
      { x: 30, y: 40, timestamp: timestamp + 1 },
    ],
    filterPipeline: { filters: [] },
    expand: {
      levels: [
        { mode: "none", offset: { x: 50, y: 50 }, angle: 0, divisions: 1 },
      ],
    },
    style: {
      color: { r: 0, g: 0, b: 0, a: 255 },
      lineWidth: 3,
      pressureCurve: { y1: 1 / 3, y2: 2 / 3 },
      compositeOperation: "source-over",
      brush: { type: "round-pen", pressureDynamics: { size: 0, flow: 0 } },
    },
    brushSeed: 0,
    timestamp,
  };
}

function createWrapShiftCommand(
  dx: number,
  dy: number,
  timestamp = 1000,
): WrapShiftCommand {
  return { type: "wrap-shift", dx, dy, timestamp };
}

function beginAndPush(
  state: HistoryState,
  command: StrokeCommand | ClearCommand,
  layer = createMockLayer(command.layerId),
  config?: HistoryConfig,
) {
  const begun = beginHistoryMutation(
    state,
    { affectedLayers: [layer], layerCount: 1 },
    config,
  );
  return pushCommand(
    begun,
    command,
    { afterLayer: layer, layerCount: 1 },
    config,
  );
}

describe("history", () => {
  it("creates an empty absolute-index history state", () => {
    const state = createHistoryState(800, 600, { layerCount: 3 });

    expect(state.commands).toEqual([]);
    expect(state.checkpoints).toEqual([]);
    expect(state.historyStartIndex).toBe(0);
    expect(state.currentIndex).toBe(-1);
    expect(state.undoFloorIndex).toBe(-1);
    expect(state.baseCumulativeOffset).toEqual({ x: 0, y: 0 });
    expect(state.layerCount).toBe(3);
  });

  it("requires beginHistoryMutation before undoable pixel commands", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = createHistoryState(800, 600);
    const command = createStrokeCommand(1000);
    const next = pushCommand(
      state,
      command,
      { afterLayer: createMockLayer(), layerCount: 1 },
      { checkpointInterval: 10, maxCheckpoints: 10 },
    );

    expect(next.commands).toHaveLength(0);
    expect(next.undoFloorIndex).toBe(-1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("adds commands after pre-write checkpoint coverage exists", () => {
    const state = createHistoryState(800, 600);
    const layer = createMockLayer();
    const command = createStrokeCommand(1000);

    const next = beginAndPush(state, command, layer);

    expect(next.commands).toHaveLength(1);
    expect(getCommandAt(next, 0)).toEqual(command);
    expect(next.currentIndex).toBe(0);
    expect(next.checkpoints).toHaveLength(1);
    expect(next.checkpoints[0].commandIndex).toBe(-1);
  });

  it("uses checkpointInterval as command-index distance per layer", () => {
    const config = { checkpointInterval: 2, maxCheckpoints: 10 };
    const layerA = createMockLayer("a");
    const layerB = createMockLayer("b");
    let state = createHistoryState(800, 600, { layerCount: 2 });

    state = beginAndPush(state, createStrokeCommand(1000, "a"), layerA, config);
    state = beginAndPush(state, createStrokeCommand(1001, "b"), layerB, config);
    state = beginAndPush(state, createStrokeCommand(1002, "a"), layerA, config);

    const aCheckpoints = state.checkpoints.filter((cp) => cp.layerId === "a");
    expect(aCheckpoints.map((cp) => cp.commandIndex)).toEqual([-1, 1]);
  });

  it("undo is bounded by undoFloorIndex after checkpoint eviction", () => {
    const config = { checkpointInterval: 1, maxCheckpoints: 1 };
    const layer = createMockLayer();
    let state = createHistoryState(800, 600);

    state = beginAndPush(state, createStrokeCommand(1000), layer, config);
    state = beginAndPush(state, createStrokeCommand(1001), layer, config);
    state = beginAndPush(state, createStrokeCommand(1002), layer, config);

    expect(state.checkpoints).toHaveLength(1);
    expect(state.undoFloorIndex).toBeGreaterThanOrEqual(0);
    while (canUndo(state)) state = undo(state);
    expect(state.currentIndex).toBe(state.undoFloorIndex);
  });

  it("truncates redo branch when pushing a new command", () => {
    const layer = createMockLayer();
    let state = createHistoryState(800, 600);
    state = beginAndPush(state, createStrokeCommand(1000), layer);
    state = beginAndPush(state, createStrokeCommand(1001), layer);
    state = undo(state);

    state = beginAndPush(state, createStrokeCommand(2000), layer);

    expect(state.commands).toHaveLength(2);
    expect(getCommandAt(state, state.currentIndex)?.timestamp).toBe(2000);
    expect(canRedo(state)).toBe(false);
  });

  it("includes wrap-shift commands for every layer replay", () => {
    const layerA = createMockLayer("a");
    const layerB = createMockLayer("b");
    let state = createHistoryState(800, 600, { layerCount: 2 });
    state = beginAndPush(state, createStrokeCommand(1000, "a"), layerA);
    state = beginHistoryMutation(state, {
      affectedLayers: [layerA, layerB],
      layerCount: 2,
    });
    state = pushCommand(state, createWrapShiftCommand(4, 5), {
      affectedLayerIds: ["a", "b"],
      layerCount: 2,
    });

    expect(getCommandsToReplayForLayer(state, "a").map((c) => c.type)).toEqual([
      "stroke",
      "wrap-shift",
    ]);
    expect(getCommandsToReplayForLayer(state, "b").map((c) => c.type)).toEqual([
      "wrap-shift",
    ]);
  });

  it("aggregates affected layers by absolute index range", () => {
    const layerA = createMockLayer("a");
    const layerB = createMockLayer("b");
    let state = createHistoryState(800, 600, { layerCount: 2 });
    state = beginAndPush(state, createStrokeCommand(1000, "a"), layerA);
    state = beginAndPush(state, createStrokeCommand(1001, "b"), layerB);

    const affected = getAffectedLayerIds(state, 0, 1);

    expect(affected.type).toBe("partial");
    if (affected.type === "partial") {
      expect([...affected.layerIds].sort()).toEqual(["a", "b"]);
    }
  });

  it("tracks duplicate-layer checkpoint coverage and affected layer", () => {
    const source = createMockLayer("source");
    let state = createHistoryState(800, 600, { layerCount: 1 });
    state = beginHistoryMutation(state, {
      affectedLayers: [source],
      layerCount: 1,
    });
    state = pushCommand(
      state,
      {
        type: "duplicate-layer",
        sourceLayerId: "source",
        layerId: "copy",
        insertIndex: 1,
        width: 800,
        height: 600,
        meta: { name: "Copy", visible: true, opacity: 1 },
        timestamp: 1000,
      } satisfies DuplicateLayerCommand as Command,
      { layerCount: 2 },
    );

    expect(state.commands).toHaveLength(1);
    const affected = getAffectedLayerIds(state, 0, 0);
    expect(affected.type).toBe("partial");
    if (affected.type === "partial") {
      expect([...affected.layerIds]).toEqual(["copy"]);
    }
  });

  it("requires source and target coverage for merge-layer-down", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = createMockLayer("source");
    const target = createMockLayer("target");
    let state = createHistoryState(800, 600, { layerCount: 2 });
    state = beginHistoryMutation(state, {
      affectedLayers: [source],
      layerCount: 2,
    });
    state = pushCommand(
      state,
      {
        type: "merge-layer-down",
        sourceLayerId: "source",
        targetLayerId: "target",
        sourceIndex: 1,
        targetIndex: 0,
        sourceMeta: source.meta,
        targetMetaBefore: target.meta,
        targetMetaAfter: {
          name: "target",
          visible: true,
          opacity: 1,
          compositeOperation: "source-over",
        },
        timestamp: 1000,
      } satisfies MergeLayerDownCommand as Command,
      { layerCount: 1 },
    );

    expect(state.commands).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("returns all affected when range contains wrap-shift", () => {
    const layerA = createMockLayer("a");
    const layerB = createMockLayer("b");
    let state = createHistoryState(800, 600, { layerCount: 2 });
    state = beginAndPush(state, createStrokeCommand(1000, "a"), layerA);
    state = beginHistoryMutation(state, {
      affectedLayers: [layerA, layerB],
      layerCount: 2,
    });
    state = pushCommand(state, createWrapShiftCommand(4, 5), {
      affectedLayerIds: ["a", "b"],
      layerCount: 2,
    });

    expect(getAffectedLayerIds(state, 0, 1).type).toBe("all");
  });

  it("computes cumulative offset with baseCumulativeOffset", () => {
    const layerA = createMockLayer("a");
    const layerB = createMockLayer("b");
    let state = createHistoryState(100, 80, { layerCount: 2 });
    state = beginHistoryMutation(state, {
      affectedLayers: [layerA, layerB],
      layerCount: 2,
    });
    state = pushCommand(state, createWrapShiftCommand(-5, 83), {
      affectedLayerIds: ["a", "b"],
      layerCount: 2,
    });

    expect(computeCumulativeOffset(state)).toEqual({ x: 95, y: 3 });
  });

  it("reports checkpoint compression metrics", () => {
    const state = beginAndPush(
      createHistoryState(800, 600),
      createStrokeCommand(1000),
      createMockLayer(),
      {
        checkpointInterval: 10,
        maxCheckpoints: 10,
        checkpointCompression: "fast",
      },
    );

    const metrics = getHistoryMetrics(state);

    expect(metrics.commandCount).toBe(1);
    expect(metrics.checkpointCount).toBe(1);
    expect(metrics.encodedCheckpointCount).toBe(1);
    expect(metrics.totalCheckpointBytes).toBeGreaterThan(0);
  });

  it("supports custom commands without checkpoint coverage", () => {
    type RenameCommand = {
      readonly type: "rename";
      readonly layerId: string;
      readonly name: string;
    };
    const state = createHistoryState<RenameCommand>(800, 600);
    const command: RenameCommand = {
      type: "rename",
      layerId: "layer_1",
      name: "Ink",
    };

    const next = pushCommand(state, command, { layerCount: 1 });

    expect(next.commands).toEqual([command]);
    expect(canUndo(next)).toBe(true);
    expect(redo(undo(next)).currentIndex).toBe(0);
  });
});
