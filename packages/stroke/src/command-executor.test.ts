import type { Layer, LayerMeta } from "@headless-paint/engine";
import { createLayer, getPixel, setPixel } from "@headless-paint/engine";
import { describe, expect, it, vi } from "vitest";
import {
  executeHistoryOp,
  resolvePushPersistenceEvent,
} from "./command-executor";
import type { CustomCommandExecutor } from "./command-executor";
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

const hiddenMeta = {
  ...meta,
  visible: false,
} satisfies LayerMeta;

const targetMetaBefore = {
  name: "Target",
  visible: true,
  opacity: 0.4,
  alphaLocked: true,
  compositeOperation: "multiply",
} satisfies LayerMeta;

const targetMetaAfter = {
  name: "Merged",
  visible: false,
  opacity: 0.8,
  alphaLocked: false,
  compositeOperation: "screen",
} satisfies LayerMeta;

function setLayerId(layer: Layer, layerId: string): Layer {
  (layer as { id: string }).id = layerId;
  return layer;
}

function makeLayer(id: string, layerMeta: LayerMeta = meta): Layer {
  return setLayerId(createLayer(4, 4, layerMeta), id);
}

function createState<TCustom = never>(
  commands: readonly Command<TCustom>[],
  currentIndex: number,
  options?: Partial<HistoryState<TCustom>>,
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
    ...options,
  };
}

function createAddLayerCommand(
  layerId = "added",
  insertIndex = 1,
  layerMeta: LayerMeta = meta,
): AddLayerCommand {
  return {
    type: "add-layer",
    layerId,
    insertIndex,
    width: 4,
    height: 4,
    meta: layerMeta,
    timestamp: 1000,
  };
}

function createRemoveLayerCommand(layerId = "removed"): RemoveLayerCommand {
  return {
    type: "remove-layer",
    layerId,
    removedIndex: 1,
    meta,
    timestamp: 1001,
  };
}

function createReorderLayerCommand(): ReorderLayerCommand {
  return {
    type: "reorder-layer",
    layerId: "moved",
    fromIndex: 0,
    toIndex: 2,
    timestamp: 1002,
  };
}

function createDuplicateLayerCommand(): DuplicateLayerCommand {
  return {
    type: "duplicate-layer",
    sourceLayerId: "source",
    layerId: "copy",
    insertIndex: 1,
    width: 4,
    height: 4,
    meta,
    timestamp: 1003,
  };
}

function createMergeLayerDownCommand(): MergeLayerDownCommand {
  return {
    type: "merge-layer-down",
    sourceLayerId: "source",
    targetLayerId: "target",
    sourceIndex: 1,
    targetIndex: 0,
    sourceMeta: meta,
    targetMetaBefore,
    targetMetaAfter,
    timestamp: 1004,
  };
}

function createClearCommand(layerId = "a"): ClearCommand {
  return { type: "clear", layerId, timestamp: 1005 };
}

function createWrapShiftCommand(): WrapShiftCommand {
  return { type: "wrap-shift", dx: 1, dy: 0, timestamp: 1006 };
}

function createStructuralCommands(): readonly StructuralCommand[] {
  return [
    createAddLayerCommand(),
    createRemoveLayerCommand(),
    createReorderLayerCommand(),
    createDuplicateLayerCommand(),
    createMergeLayerDownCommand(),
  ];
}

describe("command executor", () => {
  it("undoes wrap-shift by shifting every layer in the opposite direction", () => {
    const command = createWrapShiftCommand();
    const state = createState([command], 0);
    const layerA = makeLayer("a");
    const layerB = makeLayer("b");
    setPixel(layerA, 1, 1, { r: 255, g: 0, b: 0, a: 255 });
    setPixel(layerB, 2, 1, { r: 0, g: 255, b: 0, a: 255 });

    const result = executeHistoryOp("undo", state, {
      layers: [layerA, layerB],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(-1);
    expect(result.dirty).toEqual({ type: "all" });
    expect(result.persistence).toEqual({ type: "delete-last-command" });
    expect(getPixel(layerA, 0, 1)).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
    expect(getPixel(layerB, 1, 1)).toEqual({
      r: 0,
      g: 255,
      b: 0,
      a: 255,
    });
  });

  it("redoes wrap-shift by shifting every layer in the recorded direction", () => {
    const command = createWrapShiftCommand();
    const state = createState([command], -1);
    const layer = makeLayer("a");
    setPixel(layer, 1, 1, { r: 255, g: 0, b: 0, a: 255 });

    const result = executeHistoryOp("redo", state, { layers: [layer] });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(0);
    expect(result.persistence).toEqual({
      type: "append-command",
      command,
    });
    expect(getPixel(layer, 2, 1)).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
  });

  it("rebuilds affected layers for a normal draw undo and returns visibility fixes", () => {
    const addCommand = createAddLayerCommand("a", 0, hiddenMeta);
    const command = createClearCommand("a");
    const state = createState([addCommand, command], 1);
    const hiddenLayer = makeLayer("a", hiddenMeta);
    setPixel(hiddenLayer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    const result = executeHistoryOp("undo", state, {
      layers: [hiddenLayer, makeLayer("b")],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(0);
    expect(result.dirty).toEqual({ type: "layers", layerIds: ["a"] });
    expect(result.visibilityFixLayerIds).toEqual(["a"]);
    expect(getPixel(hiddenLayer, 0, 0).a).toBe(0);
  });

  it("interrupts a normal draw redo when rebuild fails", () => {
    const command = createClearCommand("a");
    const state = createState([command], -1);

    const result = executeHistoryOp("redo", state, {
      layers: [makeLayer("a")],
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

  it("undoes add-layer with a remove list op and nearest active hint", () => {
    const command = createAddLayerCommand();
    const state = createState([command], 0);

    const result = executeHistoryOp("undo", state, {
      layers: [makeLayer("base"), makeLayer("added"), makeLayer("top")],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(-1);
    expect(result.layerListOps).toEqual([{ type: "remove", layerId: "added" }]);
    expect(result.activeLayerIdHint).toBe("top");
    expect(result.persistence).toEqual({ type: "structural-checkpoint" });
  });

  it("redoes add-layer by recreating the recorded layer id and inserting it", () => {
    const command = createAddLayerCommand("added", 1, hiddenMeta);
    const state = createState([command], -1);

    const result = executeHistoryOp("redo", state, {
      layers: [makeLayer("base")],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(0);
    expect(result.layerListOps).toHaveLength(1);
    expect(result.layerListOps[0]).toMatchObject({
      type: "insert",
      index: 1,
    });
    const op = result.layerListOps[0];
    expect(op.type).toBe("insert");
    if (op.type !== "insert") throw new Error("expected insert op");
    expect(op.layer.id).toBe("added");
    expect(op.layer.meta).toEqual(hiddenMeta);
    expect(result.activeLayerIdHint).toBe("added");
  });

  it("undoes remove-layer by recreating, rebuilding, inserting, and activating the removed layer", () => {
    const addCommand = createAddLayerCommand("removed", 1);
    const command = createRemoveLayerCommand("removed");
    const state = createState([addCommand, command], 1);

    const result = executeHistoryOp("undo", state, {
      layers: [makeLayer("base"), makeLayer("top")],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(0);
    expect(result.layerListOps).toHaveLength(1);
    const op = result.layerListOps[0];
    expect(op.type).toBe("insert");
    if (op.type !== "insert") throw new Error("expected insert op");
    expect(op.index).toBe(1);
    expect(op.layer.id).toBe("removed");
    expect(result.activeLayerIdHint).toBe("removed");
    expect(result.dirty).toEqual({
      type: "layers",
      layerIds: ["removed"],
    });
  });

  it("interrupts remove-layer undo when the removed layer lacks a checkpoint", () => {
    const drawCommand = createClearCommand("removed");
    const command = createRemoveLayerCommand("removed");
    const state = createState([drawCommand, command], 1);

    const result = executeHistoryOp("undo", state, {
      layers: [makeLayer("base")],
    });

    expect(result.ok).toBe(false);
    expect(result.next).toBe(state);
    expect(result.failure).toEqual({
      reason: "missing-checkpoint",
      commandType: "remove-layer",
      layerId: "removed",
    });
    expect(result.layerListOps).toEqual([]);
    expect(result.dirty).toEqual({ type: "none" });
  });

  it("redoes remove-layer with a remove list op and nearest active hint", () => {
    const command = createRemoveLayerCommand("removed");
    const state = createState([command], -1);

    const result = executeHistoryOp("redo", state, {
      layers: [makeLayer("base"), makeLayer("removed"), makeLayer("top")],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(0);
    expect(result.layerListOps).toEqual([
      { type: "remove", layerId: "removed" },
    ]);
    expect(result.activeLayerIdHint).toBe("top");
  });

  it("undoes reorder-layer by moving from the recorded target index back to the source index", () => {
    const command = createReorderLayerCommand();
    const state = createState([command], 0);

    const result = executeHistoryOp("undo", state, { layers: [] });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(-1);
    expect(result.layerListOps).toEqual([
      { type: "move", fromIndex: 2, toIndex: 0 },
    ]);
  });

  it("redoes reorder-layer by moving from the recorded source index to the target index", () => {
    const command = createReorderLayerCommand();
    const state = createState([command], -1);

    const result = executeHistoryOp("redo", state, { layers: [] });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(0);
    expect(result.layerListOps).toEqual([
      { type: "move", fromIndex: 0, toIndex: 2 },
    ]);
  });

  it("undoes duplicate-layer by removing the duplicate and activating the source", () => {
    const command = createDuplicateLayerCommand();
    const state = createState([command], 0);

    const result = executeHistoryOp("undo", state, {
      layers: [makeLayer("source"), makeLayer("copy")],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(-1);
    expect(result.layerListOps).toEqual([{ type: "remove", layerId: "copy" }]);
    expect(result.activeLayerIdHint).toBe("source");
  });

  it("redoes duplicate-layer by applying the command and returning a replace list op", () => {
    const command = createDuplicateLayerCommand();
    const state = createState([command], -1);
    const source = makeLayer("source");
    setPixel(source, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    const result = executeHistoryOp("redo", state, {
      layers: [source, makeLayer("tail")],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(0);
    expect(result.layerListOps).toHaveLength(1);
    const op = result.layerListOps[0];
    expect(op.type).toBe("replace");
    if (op.type !== "replace") throw new Error("expected replace op");
    expect(op.activeLayerId).toBe("copy");
    expect(op.layers.map((layer) => layer.id)).toEqual([
      "source",
      "copy",
      "tail",
    ]);
    expect(getPixel(op.layers[1], 0, 0)).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
    expect(result.dirty).toEqual({ type: "layers", layerIds: ["copy"] });
  });

  it("interrupts duplicate-layer redo when the recorded command cannot be applied", () => {
    const command = createDuplicateLayerCommand();
    const state = createState([command], -1);

    const result = executeHistoryOp("redo", state, {
      layers: [makeLayer("copy")],
    });

    expect(result.ok).toBe(false);
    expect(result.next).toBe(state);
    expect(result.failure).toEqual({
      reason: "apply-failed",
      commandType: "duplicate-layer",
      layerId: "copy",
    });
  });

  it("undoes merge-layer-down by recreating the source, restoring target meta, rebuilding both, and inserting source", () => {
    const addTarget = createAddLayerCommand("target", 0, targetMetaBefore);
    const addSource = createAddLayerCommand("source", 1, meta);
    const command = createMergeLayerDownCommand();
    const state = createState([addTarget, addSource, command], 2);
    const target = makeLayer("target", targetMetaAfter);

    const result = executeHistoryOp("undo", state, {
      layers: [target],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(1);
    expect(target.meta).toEqual(targetMetaBefore);
    expect(result.layerListOps).toHaveLength(1);
    const op = result.layerListOps[0];
    expect(op.type).toBe("insert");
    if (op.type !== "insert") throw new Error("expected insert op");
    expect(op.index).toBe(1);
    expect(op.layer.id).toBe("source");
    expect(result.activeLayerIdHint).toBe("source");
    expect(result.dirty).toEqual({
      type: "layers",
      layerIds: ["source", "target"],
    });
  });

  it("redoes merge-layer-down by applying the command and returning a replace list op", () => {
    const command = createMergeLayerDownCommand();
    const state = createState([command], -1);
    const target = makeLayer("target", targetMetaBefore);
    const source = makeLayer("source");
    setPixel(source, 0, 0, { r: 255, g: 0, b: 0, a: 255 });

    const result = executeHistoryOp("redo", state, {
      layers: [target, source],
    });

    expect(result.ok).toBe(true);
    expect(result.next.currentIndex).toBe(0);
    expect(result.layerListOps).toHaveLength(1);
    const op = result.layerListOps[0];
    expect(op.type).toBe("replace");
    if (op.type !== "replace") throw new Error("expected replace op");
    expect(op.activeLayerId).toBe("target");
    expect(op.layers.map((layer) => layer.id)).toEqual(["target"]);
    expect(op.layers[0].meta).toEqual(targetMetaAfter);
    expect(getPixel(op.layers[0], 0, 0)).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
    expect(result.dirty).toEqual({ type: "layers", layerIds: ["target"] });
  });

  it("interrupts merge-layer-down redo when the recorded topology does not match", () => {
    const command = createMergeLayerDownCommand();
    const state = createState([command], -1);

    const result = executeHistoryOp("redo", state, {
      layers: [makeLayer("source"), makeLayer("target")],
    });

    expect(result.ok).toBe(false);
    expect(result.next).toBe(state);
    expect(result.failure).toEqual({
      reason: "apply-failed",
      commandType: "merge-layer-down",
      layerId: "source",
    });
  });

  it("maps custom command undo and redo outcomes into executor results", () => {
    const command = {
      type: "custom-op",
      timestamp: 1000,
    } satisfies CustomCommand;
    const undoState = createState<CustomCommand>([command], 0);
    const redoState = createState<CustomCommand>([command], -1);
    const customExecutor = {
      apply: vi.fn(() => ({
        ok: true as const,
        layerListOps: [{ type: "remove" as const, layerId: "redo-layer" }],
        activeLayerIdHint: "redo-active",
        visibilityFixLayerIds: ["redo-visible"],
        dirty: { type: "all" as const },
      })),
      unapply: vi.fn(() => ({
        ok: true as const,
        layerListOps: [{ type: "remove" as const, layerId: "undo-layer" }],
        activeLayerIdHint: "undo-active",
        visibilityFixLayerIds: ["undo-visible"],
        dirty: { type: "layers" as const, layerIds: ["undo-layer"] },
      })),
    } satisfies CustomCommandExecutor<CustomCommand>;

    const undoResult = executeHistoryOp("undo", undoState, {
      layers: [],
      customExecutor,
    });
    const redoResult = executeHistoryOp("redo", redoState, {
      layers: [],
      customExecutor,
    });

    expect(undoResult.ok).toBe(true);
    expect(undoResult.next.currentIndex).toBe(-1);
    expect(undoResult.layerListOps).toEqual([
      { type: "remove", layerId: "undo-layer" },
    ]);
    expect(undoResult.activeLayerIdHint).toBe("undo-active");
    expect(undoResult.visibilityFixLayerIds).toEqual(["undo-visible"]);
    expect(undoResult.dirty).toEqual({
      type: "layers",
      layerIds: ["undo-layer"],
    });
    expect(undoResult.persistence).toEqual({ type: "delete-last-command" });
    expect(customExecutor.unapply).toHaveBeenCalledWith(command);

    expect(redoResult.ok).toBe(true);
    expect(redoResult.next.currentIndex).toBe(0);
    expect(redoResult.layerListOps).toEqual([
      { type: "remove", layerId: "redo-layer" },
    ]);
    expect(redoResult.activeLayerIdHint).toBe("redo-active");
    expect(redoResult.visibilityFixLayerIds).toEqual(["redo-visible"]);
    expect(redoResult.dirty).toEqual({ type: "all" });
    expect(redoResult.persistence).toEqual({
      type: "append-command",
      command,
    });
    expect(customExecutor.apply).toHaveBeenCalledWith(command);
  });

  it("interrupts custom commands when no custom executor is injected", () => {
    const command = {
      type: "custom-op",
      timestamp: 1000,
    } satisfies CustomCommand;
    const state = createState<CustomCommand>([command], -1);

    const result = executeHistoryOp("redo", state, { layers: [] });

    expect(result.ok).toBe(false);
    expect(result.next).toBe(state);
    expect(result.failure).toEqual({
      reason: "apply-failed",
      commandType: "custom-op",
    });
    expect(result.persistence).toEqual({
      type: "append-command",
      command,
    });
  });

  it("interrupts custom commands when the injected executor fails", () => {
    const command = {
      type: "custom-op",
      timestamp: 1000,
    } satisfies CustomCommand;
    const state = createState<CustomCommand>([command], 0);

    const result = executeHistoryOp("undo", state, {
      layers: [],
      customExecutor: {
        apply: vi.fn(() => ({ ok: true as const })),
        unapply: vi.fn(() => ({
          ok: false as const,
          failure: {
            reason: "apply-failed" as const,
            commandType: "custom-op",
            layerId: "custom-layer",
          },
        })),
      } satisfies CustomCommandExecutor<CustomCommand>,
    });

    expect(result.ok).toBe(false);
    expect(result.next).toBe(state);
    expect(result.failure).toEqual({
      reason: "apply-failed",
      commandType: "custom-op",
      layerId: "custom-layer",
    });
    expect(result.persistence).toEqual({ type: "delete-last-command" });
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
