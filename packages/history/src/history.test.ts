import { createLayer, drawPath, setPixel } from "@headless-paint/engine";
import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  createHistoryState,
  estimateMemoryUsage,
  findBestCheckpoint,
  getCommandsToReplay,
  getHistoryEntries,
  pushCommand,
  redo,
  undo,
} from "./history";
import type { HistoryConfig } from "./types";

const testConfig: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 5,
  maxCheckpoints: 10,
};

const testColor = { r: 0, g: 0, b: 0, a: 255 };

function createTestCommand(id: number) {
  return {
    type: "drawPath" as const,
    points: [
      { x: id, y: id },
      { x: id + 10, y: id + 10 },
    ],
    color: testColor,
    lineWidth: 1,
    timestamp: Date.now(),
  };
}

describe("createHistoryState", () => {
  it("should create empty history state", () => {
    const state = createHistoryState(100, 100);

    expect(state.commands).toHaveLength(0);
    expect(state.checkpoints).toHaveLength(0);
    expect(state.currentIndex).toBe(-1);
    expect(state.layerWidth).toBe(100);
    expect(state.layerHeight).toBe(100);
  });
});

describe("pushCommand", () => {
  it("should add command and update currentIndex", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);

    state = pushCommand(state, createTestCommand(0), layer, testConfig);

    expect(state.commands).toHaveLength(1);
    expect(state.currentIndex).toBe(0);
  });

  it("should create checkpoint at interval", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);

    // 5コマンドでチェックポイント作成
    for (let i = 0; i < 5; i++) {
      const cmd = createTestCommand(i);
      drawPath(layer, cmd.points, cmd.color, cmd.lineWidth);
      state = pushCommand(state, cmd, layer, testConfig);
    }

    expect(state.checkpoints).toHaveLength(1);
    expect(state.checkpoints[0].commandIndex).toBe(4);
  });

  it("should remove commands after currentIndex when adding new command after undo", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);

    // 3コマンド追加
    for (let i = 0; i < 3; i++) {
      state = pushCommand(state, createTestCommand(i), layer, testConfig);
    }
    expect(state.commands).toHaveLength(3);

    // 2回Undo
    state = undo(state);
    state = undo(state);
    expect(state.currentIndex).toBe(0);

    // 新しいコマンド追加
    state = pushCommand(state, createTestCommand(99), layer, testConfig);

    expect(state.commands).toHaveLength(2);
    expect(state.currentIndex).toBe(1);
  });

  it("should respect maxHistorySize", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);
    const smallConfig: HistoryConfig = {
      maxHistorySize: 5,
      checkpointInterval: 10,
      maxCheckpoints: 10,
    };

    for (let i = 0; i < 7; i++) {
      state = pushCommand(state, createTestCommand(i), layer, smallConfig);
    }

    expect(state.commands).toHaveLength(5);
    expect(state.currentIndex).toBe(4);
  });

  it("should respect maxCheckpoints", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);
    const smallConfig: HistoryConfig = {
      maxHistorySize: 100,
      checkpointInterval: 2,
      maxCheckpoints: 3,
    };

    for (let i = 0; i < 10; i++) {
      state = pushCommand(state, createTestCommand(i), layer, smallConfig);
    }

    expect(state.checkpoints.length).toBeLessThanOrEqual(3);
  });
});

describe("canUndo / canRedo", () => {
  it("canUndo should return false for empty state", () => {
    const state = createHistoryState(10, 10);
    expect(canUndo(state)).toBe(false);
  });

  it("canUndo should return true after pushCommand", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);
    state = pushCommand(state, createTestCommand(0), layer, testConfig);

    expect(canUndo(state)).toBe(true);
  });

  it("canRedo should return false initially", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);
    state = pushCommand(state, createTestCommand(0), layer, testConfig);

    expect(canRedo(state)).toBe(false);
  });

  it("canRedo should return true after undo", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);
    state = pushCommand(state, createTestCommand(0), layer, testConfig);
    state = undo(state);

    expect(canRedo(state)).toBe(true);
  });
});

describe("undo / redo", () => {
  it("undo should decrement currentIndex", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);
    state = pushCommand(state, createTestCommand(0), layer, testConfig);
    state = pushCommand(state, createTestCommand(1), layer, testConfig);

    expect(state.currentIndex).toBe(1);
    state = undo(state);
    expect(state.currentIndex).toBe(0);
    state = undo(state);
    expect(state.currentIndex).toBe(-1);
  });

  it("redo should increment currentIndex", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);
    state = pushCommand(state, createTestCommand(0), layer, testConfig);
    state = pushCommand(state, createTestCommand(1), layer, testConfig);
    state = undo(state);
    state = undo(state);

    expect(state.currentIndex).toBe(-1);
    state = redo(state);
    expect(state.currentIndex).toBe(0);
    state = redo(state);
    expect(state.currentIndex).toBe(1);
  });

  it("undo should not go below -1", () => {
    const state = createHistoryState(10, 10);
    const undone = undo(state);
    expect(undone.currentIndex).toBe(-1);
  });

  it("redo should not exceed commands length", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);
    state = pushCommand(state, createTestCommand(0), layer, testConfig);
    state = redo(state);
    expect(state.currentIndex).toBe(0);
  });
});

describe("findBestCheckpoint", () => {
  it("should return undefined if no checkpoints", () => {
    const state = createHistoryState(10, 10);
    expect(findBestCheckpoint(state)).toBeUndefined();
  });

  it("should return the checkpoint closest to currentIndex", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);

    // 15コマンド追加（index 4, 9, 14 でチェックポイント）
    for (let i = 0; i < 15; i++) {
      state = pushCommand(state, createTestCommand(i), layer, testConfig);
    }

    expect(state.checkpoints).toHaveLength(3);

    // currentIndex = 14 のとき、index 14 のチェックポイントを返す
    const cp = findBestCheckpoint(state);
    expect(cp?.commandIndex).toBe(14);

    // currentIndex = 7 のとき、index 4 のチェックポイントを返す
    state = { ...state, currentIndex: 7 };
    const cp2 = findBestCheckpoint(state);
    expect(cp2?.commandIndex).toBe(4);
  });
});

describe("getCommandsToReplay", () => {
  it("should return all commands if no checkpoint", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);

    for (let i = 0; i < 3; i++) {
      state = pushCommand(state, createTestCommand(i), layer, testConfig);
    }

    const commands = getCommandsToReplay(state);
    expect(commands).toHaveLength(3);
  });

  it("should return commands after checkpoint", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);

    for (let i = 0; i < 7; i++) {
      state = pushCommand(state, createTestCommand(i), layer, testConfig);
    }

    const checkpoint = findBestCheckpoint(state);
    expect(checkpoint?.commandIndex).toBe(4);

    const commands = getCommandsToReplay(state, checkpoint);
    expect(commands).toHaveLength(2); // index 5, 6
  });
});

describe("getHistoryEntries", () => {
  it("should return entries with hasCheckpoint flag", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);

    for (let i = 0; i < 6; i++) {
      state = pushCommand(state, createTestCommand(i), layer, testConfig);
    }

    const entries = getHistoryEntries(state);
    expect(entries).toHaveLength(6);
    expect(entries[4].hasCheckpoint).toBe(true);
    expect(entries[0].hasCheckpoint).toBe(false);
  });
});

describe("estimateMemoryUsage", () => {
  it("should return zero for empty state", () => {
    const state = createHistoryState(10, 10);
    const usage = estimateMemoryUsage(state);

    expect(usage.checkpointsBytes).toBe(0);
    expect(usage.commandsBytes).toBe(0);
    expect(usage.totalBytes).toBe(0);
  });

  it("should calculate memory for checkpoints", () => {
    const layer = createLayer(10, 10);
    let state = createHistoryState(10, 10);

    for (let i = 0; i < 5; i++) {
      state = pushCommand(state, createTestCommand(i), layer, testConfig);
    }

    const usage = estimateMemoryUsage(state);
    expect(usage.checkpointsBytes).toBe(10 * 10 * 4); // width * height * 4
    expect(usage.commandsBytes).toBeGreaterThan(0);
    expect(usage.formatted).toMatch(/\d+.*B|KB|MB/);
  });
});
