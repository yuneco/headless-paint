import { describe, expect, it, vi } from "vitest";
import {
  canRedo,
  canUndo,
  computeCumulativeOffset,
  computeCumulativeOffsetForLayer,
  createHistoryState,
  findBestCheckpoint,
  findBestCheckpointForLayer,
  getAffectedLayerIds,
  getCommandsToReplay,
  getCommandsToReplayForLayer,
  pushCommand,
  redo,
  undo,
} from "./history";
import type {
  AddLayerCommand,
  Checkpoint,
  Command,
  HistoryConfig,
  HistoryState,
  RemoveLayerCommand,
  ReorderLayerCommand,
  StrokeCommand,
  WrapShiftCommand,
} from "./types";

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

function createTestCommand(
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
      mode: "none",
      origin: { x: 50, y: 50 },
      angle: 0,
      divisions: 1,
    },
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

    it("should force checkpoint on remove-layer regardless of interval", () => {
      let state = createHistoryState(800, 600);
      const layer = createMockLayer();
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 100, // very high interval
        maxCheckpoints: 10,
      };

      // Add a stroke command (no checkpoint since interval=100)
      state = pushCommand(state, createTestCommand(1000), layer, config);
      expect(state.checkpoints).toHaveLength(0);

      // Add remove-layer command (should force checkpoint)
      const removeCmd: RemoveLayerCommand = {
        type: "remove-layer",
        layerId: "layer_1",
        removedIndex: 0,
        timestamp: 2000,
      };
      state = pushCommand(state, removeCmd, layer, config);

      expect(state.checkpoints).toHaveLength(1);
      expect(state.checkpoints[0].layerId).toBe("layer_1");
      expect(state.checkpoints[0].commandIndex).toBe(1);
    });

    it("should not create checkpoint on add-layer (layer=null)", () => {
      let state = createHistoryState(800, 600);
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 1, // every command
        maxCheckpoints: 10,
      };

      const addCmd: AddLayerCommand = {
        type: "add-layer",
        layerId: "layer_2",
        insertIndex: 1,
        width: 800,
        height: 600,
        meta: { name: "Layer 2", visible: true, opacity: 1 },
        timestamp: 1000,
      };
      state = pushCommand(state, addCmd, null, config);

      expect(state.checkpoints).toHaveLength(0);
    });

    it("should not create checkpoint on reorder-layer (layer=null)", () => {
      let state = createHistoryState(800, 600);
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 1,
        maxCheckpoints: 10,
      };

      const reorderCmd: ReorderLayerCommand = {
        type: "reorder-layer",
        layerId: "layer_1",
        fromIndex: 0,
        toIndex: 1,
        timestamp: 1000,
      };
      state = pushCommand(state, reorderCmd, null, config);

      expect(state.checkpoints).toHaveLength(0);
    });

    it("should apply maxCheckpoints to forced checkpoints", () => {
      let state = createHistoryState(800, 600);
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 100,
        maxCheckpoints: 2,
      };

      // Force 3 checkpoints via remove-layer
      for (let i = 0; i < 3; i++) {
        const removeCmd: RemoveLayerCommand = {
          type: "remove-layer",
          layerId: `layer_${i}`,
          removedIndex: 0,
          timestamp: 1000 + i,
        };
        state = pushCommand(
          state,
          removeCmd,
          createMockLayer(`layer_${i}`),
          config,
        );
      }

      // maxCheckpoints=2, so only the last 2 should remain
      expect(state.checkpoints).toHaveLength(2);
    });

    it("should truncate checkpoints after undo + new remove-layer", () => {
      let state = createHistoryState(800, 600);
      const layer = createMockLayer();
      const config: HistoryConfig = {
        maxHistorySize: 100,
        checkpointInterval: 100,
        maxCheckpoints: 10,
      };

      // Add 3 commands
      for (let i = 0; i < 3; i++) {
        state = pushCommand(state, createTestCommand(1000 + i), layer, config);
      }

      // Force checkpoint at index 3
      const removeCmd: RemoveLayerCommand = {
        type: "remove-layer",
        layerId: "layer_1",
        removedIndex: 0,
        timestamp: 2000,
      };
      state = pushCommand(state, removeCmd, layer, config);
      expect(state.checkpoints).toHaveLength(1);

      // Undo back to index 2, then push new command
      state = undo(state);
      state = undo(state);
      state = pushCommand(state, createTestCommand(3000), layer, config);

      // The checkpoint at index 3 should be removed
      expect(state.checkpoints).toHaveLength(0);
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

  describe("findBestCheckpoint (deprecated)", () => {
    it("should return undefined when no checkpoints", () => {
      const state = createHistoryState(800, 600);

      expect(findBestCheckpoint(state)).toBeUndefined();
    });

    it("should return checkpoint before currentIndex", () => {
      const state: HistoryState = {
        commands: [],
        checkpoints: [
          {
            id: "cp1",
            layerId: "layer_1",
            commandIndex: 4,
            imageData: createMockImageData(1, 1),
            createdAt: 1000,
          },
          {
            id: "cp2",
            layerId: "layer_1",
            commandIndex: 9,
            imageData: createMockImageData(1, 1),
            createdAt: 2000,
          },
        ],
        currentIndex: 7,
        layerWidth: 800,
        layerHeight: 600,
      };

      const checkpoint = findBestCheckpoint(state);

      expect(checkpoint?.id).toBe("cp1");
    });
  });

  describe("findBestCheckpointForLayer", () => {
    it("should return only checkpoints for the target layerId", () => {
      const state: HistoryState = {
        commands: [],
        checkpoints: [
          {
            id: "cp1",
            layerId: "layer_1",
            commandIndex: 4,
            imageData: createMockImageData(1, 1),
            createdAt: 1000,
          },
          {
            id: "cp2",
            layerId: "layer_2",
            commandIndex: 5,
            imageData: createMockImageData(1, 1),
            createdAt: 2000,
          },
        ],
        currentIndex: 7,
        layerWidth: 800,
        layerHeight: 600,
      };

      const cp = findBestCheckpointForLayer(state, "layer_1");
      expect(cp?.id).toBe("cp1");
    });

    it("should return the closest checkpoint before currentIndex", () => {
      const state: HistoryState = {
        commands: [],
        checkpoints: [
          {
            id: "cp1",
            layerId: "layer_1",
            commandIndex: 2,
            imageData: createMockImageData(1, 1),
            createdAt: 1000,
          },
          {
            id: "cp2",
            layerId: "layer_1",
            commandIndex: 6,
            imageData: createMockImageData(1, 1),
            createdAt: 2000,
          },
        ],
        currentIndex: 7,
        layerWidth: 800,
        layerHeight: 600,
      };

      const cp = findBestCheckpointForLayer(state, "layer_1");
      expect(cp?.id).toBe("cp2");
    });

    it("should return undefined when no checkpoints for the target layer", () => {
      const state: HistoryState = {
        commands: [],
        checkpoints: [
          {
            id: "cp1",
            layerId: "layer_2",
            commandIndex: 4,
            imageData: createMockImageData(1, 1),
            createdAt: 1000,
          },
        ],
        currentIndex: 7,
        layerWidth: 800,
        layerHeight: 600,
      };

      expect(findBestCheckpointForLayer(state, "layer_1")).toBeUndefined();
    });
  });

  describe("getCommandsToReplay (deprecated)", () => {
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
      const checkpoint: Checkpoint = {
        id: "cp1",
        layerId: "layer_1",
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

  describe("getCommandsToReplayForLayer", () => {
    it("should filter by layerId and return only draw commands", () => {
      const commands: Command[] = [
        createTestCommand(1000, "layer_1"),
        createTestCommand(1001, "layer_2"),
        createTestCommand(1002, "layer_1"),
        {
          type: "add-layer",
          layerId: "layer_2",
          insertIndex: 1,
          width: 100,
          height: 100,
          meta: { name: "L2", visible: true, opacity: 1 },
          timestamp: 1003,
        } as AddLayerCommand,
      ];
      const state: HistoryState = {
        commands,
        checkpoints: [],
        currentIndex: 3,
        layerWidth: 800,
        layerHeight: 600,
      };

      const toReplay = getCommandsToReplayForLayer(state, "layer_1");
      expect(toReplay).toHaveLength(2);
      expect(toReplay[0].type).toBe("stroke");
      expect(toReplay[1].type).toBe("stroke");
    });

    it("should respect checkpoint range", () => {
      const commands: Command[] = [
        createTestCommand(1000, "layer_1"),
        createTestCommand(1001, "layer_1"),
        createTestCommand(1002, "layer_1"),
      ];
      const checkpoint: Checkpoint = {
        id: "cp1",
        layerId: "layer_1",
        commandIndex: 0,
        imageData: createMockImageData(1, 1),
        createdAt: 1000,
      };
      const state: HistoryState = {
        commands,
        checkpoints: [checkpoint],
        currentIndex: 2,
        layerWidth: 800,
        layerHeight: 600,
      };

      const toReplay = getCommandsToReplayForLayer(
        state,
        "layer_1",
        checkpoint,
      );
      expect(toReplay).toHaveLength(2);
    });
  });

  describe("getAffectedLayerIds", () => {
    it("should return layerIds from draw commands in range", () => {
      const commands: Command[] = [
        createTestCommand(1000, "layer_1"),
        createTestCommand(1001, "layer_2"),
        createTestCommand(1002, "layer_1"),
      ];
      const state: HistoryState = {
        commands,
        checkpoints: [],
        currentIndex: 2,
        layerWidth: 800,
        layerHeight: 600,
      };

      const ids = getAffectedLayerIds(state, 0, 2);
      expect(ids.has("layer_1")).toBe(true);
      expect(ids.has("layer_2")).toBe(true);
      expect(ids.size).toBe(2);
    });

    it("should return single layerId for single-layer range", () => {
      const commands: Command[] = [
        createTestCommand(1000, "layer_1"),
        createTestCommand(1001, "layer_1"),
      ];
      const state: HistoryState = {
        commands,
        checkpoints: [],
        currentIndex: 1,
        layerWidth: 800,
        layerHeight: 600,
      };

      const ids = getAffectedLayerIds(state, 0, 1);
      expect(ids.size).toBe(1);
      expect(ids.has("layer_1")).toBe(true);
    });

    it("should return empty set for structural-only range", () => {
      const commands: Command[] = [
        {
          type: "add-layer",
          layerId: "layer_2",
          insertIndex: 1,
          width: 100,
          height: 100,
          meta: { name: "L2", visible: true, opacity: 1 },
          timestamp: 1000,
        } as AddLayerCommand,
        {
          type: "reorder-layer",
          layerId: "layer_2",
          fromIndex: 0,
          toIndex: 1,
          timestamp: 1001,
        } as ReorderLayerCommand,
      ];
      const state: HistoryState = {
        commands,
        checkpoints: [],
        currentIndex: 1,
        layerWidth: 800,
        layerHeight: 600,
      };

      const ids = getAffectedLayerIds(state, 0, 1);
      expect(ids.size).toBe(0);
    });
  });

  describe("computeCumulativeOffset (deprecated)", () => {
    function createWrapShift(
      dx: number,
      dy: number,
      layerId = "layer_1",
    ): WrapShiftCommand {
      return { type: "wrap-shift", layerId, dx, dy, timestamp: Date.now() };
    }

    it("should return (0, 0) for empty history", () => {
      const state = createHistoryState(800, 600);
      const offset = computeCumulativeOffset(state);
      expect(offset).toEqual({ x: 0, y: 0 });
    });

    it("should return (0, 0) when no wrap-shift commands", () => {
      const state: HistoryState = {
        commands: [createTestCommand(1000), createTestCommand(1001)],
        checkpoints: [],
        currentIndex: 1,
        layerWidth: 800,
        layerHeight: 600,
      };
      const offset = computeCumulativeOffset(state);
      expect(offset).toEqual({ x: 0, y: 0 });
    });

    it("should sum wrap-shift commands up to currentIndex", () => {
      const state: HistoryState = {
        commands: [
          createWrapShift(10, 20),
          createTestCommand(1000),
          createWrapShift(5, -10),
        ],
        checkpoints: [],
        currentIndex: 2,
        layerWidth: 800,
        layerHeight: 600,
      };
      const offset = computeCumulativeOffset(state);
      expect(offset).toEqual({ x: 15, y: 10 });
    });

    it("should respect currentIndex (ignore undone commands)", () => {
      const state: HistoryState = {
        commands: [
          createWrapShift(10, 20),
          createWrapShift(5, -10),
          createWrapShift(100, 100),
        ],
        checkpoints: [],
        currentIndex: 1,
        layerWidth: 800,
        layerHeight: 600,
      };
      const offset = computeCumulativeOffset(state);
      expect(offset).toEqual({ x: 15, y: 10 });
    });

    it("should return (0, 0) when currentIndex is -1", () => {
      const state: HistoryState = {
        commands: [createWrapShift(10, 20)],
        checkpoints: [],
        currentIndex: -1,
        layerWidth: 800,
        layerHeight: 600,
      };
      const offset = computeCumulativeOffset(state);
      expect(offset).toEqual({ x: 0, y: 0 });
    });

    it("should normalize negative offsets with modulo", () => {
      const state: HistoryState = {
        commands: [createWrapShift(-10, -20)],
        checkpoints: [],
        currentIndex: 0,
        layerWidth: 800,
        layerHeight: 600,
      };
      const offset = computeCumulativeOffset(state);
      expect(offset).toEqual({ x: 790, y: 580 });
    });

    it("should normalize offsets exceeding layer size", () => {
      const state: HistoryState = {
        commands: [createWrapShift(850, 1300)],
        checkpoints: [],
        currentIndex: 0,
        layerWidth: 800,
        layerHeight: 600,
      };
      const offset = computeCumulativeOffset(state);
      expect(offset).toEqual({ x: 50, y: 100 });
    });
  });

  describe("computeCumulativeOffsetForLayer", () => {
    function createWrapShift(
      dx: number,
      dy: number,
      layerId = "layer_1",
    ): WrapShiftCommand {
      return { type: "wrap-shift", layerId, dx, dy, timestamp: Date.now() };
    }

    it("should only sum wrap-shift for the target layer", () => {
      const state: HistoryState = {
        commands: [
          createWrapShift(10, 20, "layer_1"),
          createWrapShift(100, 200, "layer_2"),
          createWrapShift(5, -10, "layer_1"),
        ],
        checkpoints: [],
        currentIndex: 2,
        layerWidth: 800,
        layerHeight: 600,
      };
      const offset = computeCumulativeOffsetForLayer(state, "layer_1");
      expect(offset).toEqual({ x: 15, y: 10 });
    });

    it("should ignore other layers wrap-shifts", () => {
      const state: HistoryState = {
        commands: [createWrapShift(10, 20, "layer_2")],
        checkpoints: [],
        currentIndex: 0,
        layerWidth: 800,
        layerHeight: 600,
      };
      const offset = computeCumulativeOffsetForLayer(state, "layer_1");
      expect(offset).toEqual({ x: 0, y: 0 });
    });
  });
});
