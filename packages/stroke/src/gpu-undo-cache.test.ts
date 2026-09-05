import type { BrushAccelerator, Layer } from "@headless-paint/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeHistoryOp } from "./command-executor";
import { retainGpuUndo } from "./gpu-undo-cache";
import { createHistoryState, pushCommand } from "./history";
import { rebuildLayerFromHistory } from "./replay";
import type { HistoryState, StrokeCommand } from "./types";

vi.mock("./replay", () => ({ rebuildLayerFromHistory: vi.fn() }));
beforeEach(() => {
  vi.mocked(rebuildLayerFromHistory)
    .mockReset()
    .mockReturnValue({ ok: true, source: "checkpoint" });
});

function setup() {
  const accelerator = {
    backend: "webgl2" as const,
    warmUp: vi.fn(),
    invalidate: vi.fn(),
    dispose: vi.fn(),
    retainUndoSnapshot: vi.fn(() => true),
    bindUndoSnapshot: vi.fn(),
    discardUndoSnapshot: vi.fn(),
    restoreUndoSnapshot: vi.fn(() => true),
  } satisfies BrushAccelerator & Record<string, unknown>;
  const layer = {
    id: "test",
    width: 10,
    height: 10,
    meta: { visible: false },
  } as Layer;
  const command = { type: "stroke", layerId: layer.id } as StrokeCommand;
  const initial: HistoryState = {
    ...createHistoryState(10, 10),
    checkpoints: [
      {
        id: "base",
        layerId: layer.id,
        commandIndex: -1,
        createdAt: 0,
        payload: { type: "empty" },
      },
    ],
  };
  retainGpuUndo(accelerator, layer, command);
  const state = pushCommand(initial, command, { layerCount: 1 });
  return { accelerator, layer, command, initial, state };
}

describe("GPU undo history bridge (no browser)", () => {
  it("binds the exact command branch and history index without changing persisted data", () => {
    const { accelerator, layer, command, state } = setup();
    expect(accelerator.retainUndoSnapshot).toHaveBeenCalledExactlyOnceWith(
      layer,
      command,
    );
    expect(accelerator.bindUndoSnapshot).toHaveBeenCalledExactlyOnceWith(
      command,
      0,
      state.commands,
    );
    expect(state.commands).toEqual([command]);
    expect(Object.keys(command)).toEqual(["type", "layerId"]);
  });

  it("hit skips rebuild and keeps history, visibility, dirty and persistence results", () => {
    const { accelerator, layer, command, state } = setup();
    const hit = executeHistoryOp("undo", state, {
      layers: [layer],
      accelerator,
    });
    expect(accelerator.restoreUndoSnapshot).toHaveBeenCalledExactlyOnceWith(
      layer,
      0,
      state.commands,
    );
    expect(rebuildLayerFromHistory).not.toHaveBeenCalled();
    expect(hit).toMatchObject({
      ok: true,
      next: { currentIndex: -1 },
      command,
      visibilityFixLayerIds: [layer.id],
      dirty: { type: "layers", layerIds: [layer.id] },
      persistence: { type: "delete-last-command" },
    });
    accelerator.restoreUndoSnapshot.mockReturnValue(false);
    const miss = executeHistoryOp("undo", state, {
      layers: [layer],
      accelerator,
    });
    expect(rebuildLayerFromHistory).toHaveBeenCalledTimes(1);
    expect(hit).toEqual(miss);
  });

  it("redo discards the cache and always uses rebuild", () => {
    const { accelerator, layer, state } = setup();
    const result = executeHistoryOp(
      "redo",
      { ...state, currentIndex: -1 },
      { layers: [layer], accelerator },
    );
    expect(result.ok).toBe(true);
    expect(accelerator.discardUndoSnapshot).toHaveBeenCalledWith();
    expect(accelerator.restoreUndoSnapshot).not.toHaveBeenCalled();
    expect(rebuildLayerFromHistory).toHaveBeenCalledTimes(1);
  });

  it("a new branch binds the new array even at the same history index", () => {
    const { accelerator, layer, command, state } = setup();
    const other = { ...command };
    retainGpuUndo(accelerator, layer, other);
    const fork = pushCommand({ ...state, currentIndex: -1 }, other, {
      layerCount: 1,
    });
    expect(fork.currentIndex).toBe(state.currentIndex);
    expect(fork.commands).not.toBe(state.commands);
    expect(accelerator.discardUndoSnapshot).toHaveBeenCalledWith(command);
    expect(accelerator.bindUndoSnapshot).toHaveBeenLastCalledWith(
      other,
      0,
      fork.commands,
    );
  });

  it("non-stroke push and non-pixel history operations discard the old cache", () => {
    const { accelerator, command, state, layer } = setup();
    const next = pushCommand(
      state,
      {
        type: "reorder-layer",
        layerId: layer.id,
        fromIndex: 0,
        toIndex: 1,
      },
      { layerCount: 2 },
    );
    expect(accelerator.discardUndoSnapshot).toHaveBeenCalledWith(command);
    accelerator.discardUndoSnapshot.mockClear();
    const result = executeHistoryOp("undo", next, {
      layers: [layer],
      accelerator,
    });
    expect(result.ok).toBe(true);
    expect(accelerator.discardUndoSnapshot).toHaveBeenCalledWith();
    expect(accelerator.restoreUndoSnapshot).not.toHaveBeenCalled();
  });

  it("cache miss preserves rebuild failure semantics", () => {
    const { accelerator, layer, state } = setup();
    accelerator.restoreUndoSnapshot.mockReturnValue(false);
    vi.mocked(rebuildLayerFromHistory).mockReturnValue({
      ok: false,
      reason: "missing-checkpoint",
      layerId: layer.id,
    });
    const result = executeHistoryOp("undo", state, {
      layers: [layer],
      accelerator,
    });
    expect(result.ok).toBe(false);
    expect(result.next).toBe(state);
    expect(result.failure?.reason).toBe("missing-checkpoint");
  });
});
