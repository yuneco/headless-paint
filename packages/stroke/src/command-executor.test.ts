import type { Layer, LayerMeta } from "@headless-paint/engine";
import { wrapShiftLayer } from "@headless-paint/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeHistoryOp,
  resolvePushPersistenceEvent,
} from "./command-executor";
import { rebuildLayerFromHistory } from "./replay";
import type {
  AddLayerCommand,
  ClearCommand,
  Command,
  DuplicateLayerCommand,
  HistoryState,
  MergeLayerDownCommand,
  RemoveLayerCommand,
  ReorderLayerCommand,
  StructuralCommand,
  WrapShiftCommand,
} from "./types";

vi.mock("@headless-paint/engine", () => ({
  clearLayer: vi.fn(),
  getImageData: vi.fn(),
  wrapShiftLayer: vi.fn(),
}));

vi.mock("./replay", () => ({
  rebuildLayerFromHistory: vi.fn(() => ({ ok: true, source: "empty" })),
}));

type CustomCommand = {
  readonly type: "custom-op";
  readonly timestamp: number;
};

const meta = {
  name: "Layer",
  visible: true,
  opacity: 1,
  alphaLocked: false,
} satisfies LayerMeta;

function createLayer(id: string, layerMeta: LayerMeta = meta): Layer {
  return {
    id,
    width: 4,
    height: 4,
    canvas: {} as OffscreenCanvas,
    ctx: {} as OffscreenCanvasRenderingContext2D,
    meta: { ...layerMeta },
  };
}

function createState<TCustom = never>(
  commands: readonly Command<TCustom>[],
  currentIndex: number,
): HistoryState<TCustom> {
  return {
    commands,
    checkpoints: [],
    historyStartIndex: 0,
    currentIndex,
    undoFloorIndex: -1,
    baseCumulativeOffset: { x: 0, y: 0 },
    layerWidth: 4,
    layerHeight: 4,
    layerCount: 2,
  };
}

function createClearCommand(layerId = "a"): ClearCommand {
  return { type: "clear", layerId, timestamp: 1000 };
}

function createWrapShiftCommand(): WrapShiftCommand {
  return { type: "wrap-shift", dx: 3, dy: -2, timestamp: 1000 };
}

function createStructuralCommands(): readonly StructuralCommand[] {
  const addLayer = {
    type: "add-layer",
    layerId: "added",
    insertIndex: 1,
    width: 4,
    height: 4,
    meta,
    timestamp: 1000,
  } satisfies AddLayerCommand;
  const removeLayer = {
    type: "remove-layer",
    layerId: "removed",
    removedIndex: 1,
    meta,
    timestamp: 1001,
  } satisfies RemoveLayerCommand;
  const reorderLayer = {
    type: "reorder-layer",
    layerId: "moved",
    fromIndex: 0,
    toIndex: 1,
    timestamp: 1002,
  } satisfies ReorderLayerCommand;
  const duplicateLayer = {
    type: "duplicate-layer",
    sourceLayerId: "source",
    layerId: "copy",
    insertIndex: 1,
    width: 4,
    height: 4,
    meta,
    timestamp: 1003,
  } satisfies DuplicateLayerCommand;
  const mergeLayerDown = {
    type: "merge-layer-down",
    sourceLayerId: "source",
    targetLayerId: "target",
    sourceIndex: 1,
    targetIndex: 0,
    sourceMeta: meta,
    targetMetaBefore: meta,
    targetMetaAfter: { ...meta, name: "Merged" },
    timestamp: 1004,
  } satisfies MergeLayerDownCommand;
  return [addLayer, removeLayer, reorderLayer, duplicateLayer, mergeLayerDown];
}

describe("command executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rebuildLayerFromHistory).mockReturnValue({
      ok: true,
      source: "empty",
    });
  });

  it("undoes wrap-shift by shifting every layer in the opposite direction", () => {
    const command = createWrapShiftCommand();
    const state = createState([command], 0);
    const layerA = createLayer("a");
    const layerB = createLayer("b");
    const temp = {} as OffscreenCanvas;

    const result = executeHistoryOp("undo", state, {
      layers: [layerA, layerB],
      shiftTempCanvas: temp,
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(-1);
    expect(result.dirty).toEqual({ type: "all" });
    expect(result.persistence).toEqual({ type: "delete-last-command" });
    expect(wrapShiftLayer).toHaveBeenCalledTimes(2);
    expect(wrapShiftLayer).toHaveBeenNthCalledWith(1, layerA, -3, 2, temp);
    expect(wrapShiftLayer).toHaveBeenNthCalledWith(2, layerB, -3, 2, temp);
    expect(rebuildLayerFromHistory).not.toHaveBeenCalled();
  });

  it("redoes wrap-shift by shifting every layer in the recorded direction", () => {
    const command = createWrapShiftCommand();
    const state = createState([command], -1);
    const layerA = createLayer("a");

    const result = executeHistoryOp("redo", state, { layers: [layerA] });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(0);
    expect(result.persistence).toEqual({
      type: "append-command",
      command,
    });
    expect(wrapShiftLayer).toHaveBeenCalledWith(layerA, 3, -2, undefined);
  });

  it("rebuilds affected layers for a normal draw undo and returns visibility fixes", () => {
    const command = createClearCommand("a");
    const state = createState([command], 0);
    const hiddenLayer = createLayer("a", { ...meta, visible: false });
    const otherLayer = createLayer("b");

    const result = executeHistoryOp("undo", state, {
      layers: [hiddenLayer, otherLayer],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(-1);
    expect(result.dirty).toEqual({ type: "layers", layerIds: ["a"] });
    expect(result.visibilityFixLayerIds).toEqual(["a"]);
    expect(rebuildLayerFromHistory).toHaveBeenCalledOnce();
    expect(rebuildLayerFromHistory).toHaveBeenCalledWith(
      hiddenLayer,
      result.next,
      undefined,
    );
  });

  it("interrupts a normal draw redo when rebuild fails", () => {
    const command = createClearCommand("a");
    const state = createState([command], -1);
    vi.mocked(rebuildLayerFromHistory).mockReturnValueOnce({
      ok: false,
      reason: "missing-checkpoint",
      layerId: "a",
    });

    const result = executeHistoryOp("redo", state, {
      layers: [createLayer("a")],
    });

    expect(result.ok).toBe(false);
    expect(result.next).toBe(state);
    expect(result.failure).toEqual({
      reason: "missing-checkpoint",
      commandType: "clear",
      layerId: "a",
    });
    expect(result.dirty).toEqual({ type: "none" });
    expect(result.persistence).toEqual({ type: "append-command", command });
  });

  it.each(createStructuralCommands())(
    "returns structural-checkpoint and not-implemented for %s undo",
    (command) => {
      const state = createState([command], 0);

      const result = executeHistoryOp("undo", state, { layers: [] });

      expect(result.ok).toBe(false);
      expect(result.next).toBe(state);
      expect(result.failure).toEqual({
        reason: "not-implemented",
        commandType: command.type,
      });
      expect(result.persistence).toEqual({ type: "structural-checkpoint" });
    },
  );

  it.each(createStructuralCommands())(
    "returns structural-checkpoint and not-implemented for %s redo",
    (command) => {
      const state = createState([command], -1);

      const result = executeHistoryOp("redo", state, { layers: [] });

      expect(result.ok).toBe(false);
      expect(result.next).toBe(state);
      expect(result.failure).toEqual({
        reason: "not-implemented",
        commandType: command.type,
      });
      expect(result.persistence).toEqual({ type: "structural-checkpoint" });
    },
  );

  it("returns non-structural persistence and not-implemented for custom commands", () => {
    const command = {
      type: "custom-op",
      timestamp: 1000,
    } satisfies CustomCommand;
    const undoState = createState<CustomCommand>([command], 0);
    const redoState = createState<CustomCommand>([command], -1);

    const undoResult = executeHistoryOp("undo", undoState, { layers: [] });
    const redoResult = executeHistoryOp("redo", redoState, { layers: [] });

    expect(undoResult.ok).toBe(false);
    expect(undoResult.failure).toEqual({
      reason: "not-implemented",
      commandType: "custom-op",
    });
    expect(undoResult.persistence).toEqual({ type: "delete-last-command" });
    expect(redoResult.ok).toBe(false);
    expect(redoResult.failure).toEqual({
      reason: "not-implemented",
      commandType: "custom-op",
    });
    expect(redoResult.persistence).toEqual({
      type: "append-command",
      command,
    });
  });

  it("resolves push persistence events for draw, structural, and custom commands", () => {
    const drawCommand = createClearCommand("a");
    const wrapShiftCommand = createWrapShiftCommand();
    const customCommand = {
      type: "custom-op",
      timestamp: 1000,
    } satisfies CustomCommand;

    expect(resolvePushPersistenceEvent(drawCommand)).toEqual({
      type: "append-command",
      command: drawCommand,
    });
    expect(resolvePushPersistenceEvent(wrapShiftCommand)).toEqual({
      type: "append-command",
      command: wrapShiftCommand,
    });
    expect(resolvePushPersistenceEvent<CustomCommand>(customCommand)).toEqual({
      type: "append-command",
      command: customCommand,
    });
    for (const command of createStructuralCommands()) {
      expect(resolvePushPersistenceEvent(command)).toEqual({
        type: "structural-checkpoint",
      });
    }
  });
});
