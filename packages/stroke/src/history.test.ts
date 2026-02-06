import { describe, expect, it, vi } from "vitest";
import {
  canRedo,
  canUndo,
  createHistoryState,
  findBestCheckpoint,
  getCommandsToReplay,
  pushCommand,
  redo,
  undo,
} from "./history";
import type { Checkpoint, Command, HistoryConfig, HistoryState, StrokeCommand } from "./types";

// Create mock ImageData for Node.js environment
function createMockImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  } as ImageData;
}

// Mock Layer and engine functions
vi.mock("@headless-paint/engine", () => ({
  getImageData: vi.fn(() => createMockImageData(100, 100)),
}));

function createMockLayer() {
  return {
    width: 100,
    height: 100,
    canvas: {} as OffscreenCanvas,
    ctx: {
      putImageData: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D,
    meta: { name: "test", visible: true, opacity: 1 },
  };
}

function createTestCommand(timestamp: number): StrokeCommand {
  return {
    type: "stroke",
    inputPoints: [
      { x: 10, y: 20, timestamp },
      { x: 30, y: 40, timestamp: timestamp + 1 },
    ],
    filterPipeline: { filters: [] },
    expand: { mode: "none", origin: { x: 50, y: 50 }, angle: 0, divisions: 1 },
    color: { r: 0, g: 0, b: 0, a: 255 },
    lineWidth: 3,
    timestamp,
  };
}

describe("history", () => {
  describe("createHistoryState", () => {
    it("should create empty history state", () => {
      const state = createHistoryState(800, 600);

      expect(state.commands).toEqual([]);
      expect(state.checkpoints).toEqual([]);
      expect(state.currentIndex).toBe(-1);
      expect(state.layerWidth).toBe(800);
      expect(state.layerHeight).toBe(600);
    });
  });

  describe("pushCommand", () => {
    it("should add command to history", () => {
      const state = createHistoryState(800, 600);
      const layer = createMockLayer();
      const command = createTestCommand(1000);
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 10,
        maxCheckpoints: 10,
      };

      const newState = pushCommand(state, command, layer, config);

      expect(newState.commands).toHaveLength(1);
      expect(newState.commands[0]).toEqual(command);
      expect(newState.currentIndex).toBe(0);
    });

    it("should create checkpoint at interval", () => {
      let state = createHistoryState(800, 600);
      const layer = createMockLayer();
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 5,
        maxCheckpoints: 10,
      };

      // Add 5 commands (checkpoint at 5th)
      for (let i = 0; i < 5; i++) {
        state = pushCommand(state, createTestCommand(1000 + i), layer, config);
      }

      expect(state.checkpoints).toHaveLength(1);
      expect(state.checkpoints[0].commandIndex).toBe(4);
    });

    it("should truncate redo history on new command after undo", () => {
      let state = createHistoryState(800, 600);
      const layer = createMockLayer();
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 10,
        maxCheckpoints: 10,
      };

      // Add 3 commands
      for (let i = 0; i < 3; i++) {
        state = pushCommand(state, createTestCommand(1000 + i), layer, config);
      }

      // Undo twice
      state = undo(state);
      state = undo(state);
      expect(state.currentIndex).toBe(0);

      // Add new command (should truncate commands 1 and 2)
      state = pushCommand(state, createTestCommand(2000), layer, config);

      expect(state.commands).toHaveLength(2);
      expect(state.currentIndex).toBe(1);
    });
  });

  describe("canUndo / canRedo", () => {
    it("should return false for empty history", () => {
      const state = createHistoryState(800, 600);

      expect(canUndo(state)).toBe(false);
      expect(canRedo(state)).toBe(false);
    });

    it("should return correct values after operations", () => {
      let state = createHistoryState(800, 600);
      const layer = createMockLayer();
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 10,
        maxCheckpoints: 10,
      };

      state = pushCommand(state, createTestCommand(1000), layer, config);

      expect(canUndo(state)).toBe(true);
      expect(canRedo(state)).toBe(false);

      state = undo(state);

      expect(canUndo(state)).toBe(false);
      expect(canRedo(state)).toBe(true);
    });
  });

  describe("undo / redo", () => {
    it("should decrement currentIndex on undo", () => {
      let state = createHistoryState(800, 600);
      const layer = createMockLayer();
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 10,
        maxCheckpoints: 10,
      };

      state = pushCommand(state, createTestCommand(1000), layer, config);
      state = pushCommand(state, createTestCommand(1001), layer, config);
      expect(state.currentIndex).toBe(1);

      state = undo(state);
      expect(state.currentIndex).toBe(0);

      state = undo(state);
      expect(state.currentIndex).toBe(-1);

      // Should not go below -1
      state = undo(state);
      expect(state.currentIndex).toBe(-1);
    });

    it("should increment currentIndex on redo", () => {
      let state = createHistoryState(800, 600);
      const layer = createMockLayer();
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 10,
        maxCheckpoints: 10,
      };

      state = pushCommand(state, createTestCommand(1000), layer, config);
      state = pushCommand(state, createTestCommand(1001), layer, config);
      state = undo(state);
      state = undo(state);
      expect(state.currentIndex).toBe(-1);

      state = redo(state);
      expect(state.currentIndex).toBe(0);

      state = redo(state);
      expect(state.currentIndex).toBe(1);

      // Should not exceed commands length
      state = redo(state);
      expect(state.currentIndex).toBe(1);
    });
  });

  describe("findBestCheckpoint", () => {
    it("should return undefined when no checkpoints", () => {
      const state = createHistoryState(800, 600);

      expect(findBestCheckpoint(state)).toBeUndefined();
    });

    it("should return checkpoint before currentIndex", () => {
      const state: HistoryState = {
        commands: [],
        checkpoints: [
          { id: "cp1", commandIndex: 4, imageData: createMockImageData(1, 1), createdAt: 1000 },
          { id: "cp2", commandIndex: 9, imageData: createMockImageData(1, 1), createdAt: 2000 },
        ],
        currentIndex: 7,
        layerWidth: 800,
        layerHeight: 600,
      };

      const checkpoint = findBestCheckpoint(state);

      expect(checkpoint?.id).toBe("cp1");
    });
  });

  describe("getCommandsToReplay", () => {
    it("should return all commands when no checkpoint", () => {
      const commands: Command[] = [
        createTestCommand(1000),
        createTestCommand(1001),
        createTestCommand(1002),
      ];
      const state: HistoryState = {
        commands,
        checkpoints: [],
        currentIndex: 2,
        layerWidth: 800,
        layerHeight: 600,
      };

      const toReplay = getCommandsToReplay(state, undefined);

      expect(toReplay).toHaveLength(3);
    });

    it("should return commands after checkpoint", () => {
      const commands: Command[] = [
        createTestCommand(1000),
        createTestCommand(1001),
        createTestCommand(1002),
        createTestCommand(1003),
        createTestCommand(1004),
      ];
      const checkpoint = {
        id: "cp1",
        commandIndex: 2,
        imageData: createMockImageData(1, 1),
        createdAt: 1000,
      };
      const state: HistoryState = {
        commands,
        checkpoints: [checkpoint],
        currentIndex: 4,
        layerWidth: 800,
        layerHeight: 600,
      };

      const toReplay = getCommandsToReplay(state, checkpoint);

      expect(toReplay).toHaveLength(2);
      expect(toReplay[0]).toEqual(commands[3]);
      expect(toReplay[1]).toEqual(commands[4]);
    });
  });
});
