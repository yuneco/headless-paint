import { describe, expect, it } from "vitest";
import {
  addPointToSession,
  createAddLayerCommand,
  createClearCommand,
  createRemoveLayerCommand,
  createReorderLayerCommand,
  createStrokeCommand,
  createWrapShiftCommand,
  endStrokeSession,
  startStrokeSession,
} from "./session";
import type { StrokeStyle } from "./types";

describe("session", () => {
  const style: StrokeStyle = {
    color: { r: 0, g: 0, b: 0, a: 255 },
    lineWidth: 3,
  };

  const expandConfig = {
    levels: [
      {
        mode: "none" as const,
        offset: { x: 100, y: 100 },
        angle: 0,
        divisions: 1,
      },
    ],
  };

  const filterPipeline = { filters: [] };

  describe("startStrokeSession", () => {
    it("should create initial session state", () => {
      const filterOutput = {
        committed: [{ x: 10, y: 20, timestamp: 1000 }],
        pending: [],
      };

      const result = startStrokeSession(filterOutput, style, expandConfig);

      expect(result.state.allCommitted).toEqual([
        { x: 10, y: 20, timestamp: 1000 },
      ]);
      expect(result.state.currentPending).toEqual([]);
      // lastRenderedCommitIndex は描画済み committed の最終インデックス
      expect(result.state.lastRenderedCommitIndex).toBe(0);
      expect(result.state.style).toEqual(style);
      expect(result.state.expand).toEqual(expandConfig);
    });

    it("should return render update with newly committed points", () => {
      const filterOutput = {
        committed: [{ x: 10, y: 20, timestamp: 1000 }],
        pending: [{ x: 15, y: 25, timestamp: 1001 }],
      };

      const result = startStrokeSession(filterOutput, style, expandConfig);

      expect(result.renderUpdate.newlyCommitted).toEqual([{ x: 10, y: 20 }]);
      // currentPending includes last committed point for visual continuity
      expect(result.renderUpdate.currentPending).toEqual([
        { x: 10, y: 20 },
        { x: 15, y: 25 },
      ]);
    });

    it("should return committedOverlapCount = 0", () => {
      const filterOutput = {
        committed: [{ x: 10, y: 20, timestamp: 1000 }],
        pending: [],
      };

      const result = startStrokeSession(filterOutput, style, expandConfig);
      expect(result.renderUpdate.committedOverlapCount).toBe(0);
    });
  });

  describe("addPointToSession", () => {
    it("should replace committed from cumulative filterOutput and calculate newlyCommitted", () => {
      const filterOutput1 = {
        committed: [{ x: 10, y: 20, timestamp: 1000 }],
        pending: [],
      };
      const result1 = startStrokeSession(filterOutput1, style, expandConfig);

      // filterOutput.committed is cumulative (all committed from pipeline start)
      const filterOutput2 = {
        committed: [
          { x: 10, y: 20, timestamp: 1000 },
          { x: 30, y: 40, timestamp: 1002 },
        ],
        pending: [{ x: 35, y: 45, timestamp: 1003 }],
      };
      const result2 = addPointToSession(result1.state, filterOutput2);

      expect(result2.state.allCommitted).toHaveLength(2);
      expect(result2.state.currentPending).toHaveLength(1);
      // newlyCommitted: max(0, lastRenderedCommitIndex=0)=0 から開始
      // オーバーラップ1点を含み、パスの連続性を確保
      expect(result2.renderUpdate.newlyCommitted).toEqual([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ]);
      // currentPending includes last committed point for visual continuity
      expect(result2.renderUpdate.currentPending).toEqual([
        { x: 30, y: 40 },
        { x: 35, y: 45 },
      ]);
    });

    it("should update lastRenderedCommitIndex and include overlap for continuity", () => {
      const filterOutput1 = {
        committed: [{ x: 10, y: 20, timestamp: 1000 }],
        pending: [],
      };
      const result1 = startStrokeSession(filterOutput1, style, expandConfig);

      // Cumulative committed
      const filterOutput2 = {
        committed: [
          { x: 10, y: 20, timestamp: 1000 },
          { x: 30, y: 40, timestamp: 1002 },
        ],
        pending: [],
      };
      const result2 = addPointToSession(result1.state, filterOutput2);

      expect(result2.state.lastRenderedCommitIndex).toBe(1);

      // Next add: newlyCommitted includes overlap point for path continuity
      const filterOutput3 = {
        committed: [
          { x: 10, y: 20, timestamp: 1000 },
          { x: 30, y: 40, timestamp: 1002 },
          { x: 50, y: 60, timestamp: 1004 },
        ],
        pending: [],
      };
      const result3 = addPointToSession(result2.state, filterOutput3);

      // With COMMITTED_OVERLAP_COUNT=3, starts from max(0, 1-(3-1))=0
      // committedOverlapCount = min(3, 1+1) = 2
      expect(result3.renderUpdate.committedOverlapCount).toBe(2);
      expect(result3.renderUpdate.newlyCommitted).toEqual([
        { x: 10, y: 20 }, // overlap
        { x: 30, y: 40 }, // overlap
        { x: 50, y: 60 }, // new
      ]);
    });

    it("should return committedOverlapCount=1 on first addPointToSession", () => {
      const filterOutput1 = {
        committed: [{ x: 10, y: 20, timestamp: 1000 }],
        pending: [],
      };
      const result1 = startStrokeSession(filterOutput1, style, expandConfig);

      const filterOutput2 = {
        committed: [
          { x: 10, y: 20, timestamp: 1000 },
          { x: 30, y: 40, timestamp: 1002 },
        ],
        pending: [],
      };
      const result2 = addPointToSession(result1.state, filterOutput2);

      // lastRenderedCommitIndex was 0, so min(3, 0+1) = 1
      expect(result2.renderUpdate.committedOverlapCount).toBe(1);
    });

    it("should cap committedOverlapCount at 3 after enough points", () => {
      let state = startStrokeSession(
        {
          committed: [{ x: 0, y: 0, timestamp: 1000 }],
          pending: [],
        },
        style,
        expandConfig,
      ).state;

      // Add points incrementally until we have 5 committed
      for (let i = 1; i <= 4; i++) {
        const committed = Array.from({ length: i + 1 }, (_, j) => ({
          x: j * 10,
          y: 0,
          timestamp: 1000 + j,
        }));
        const result = addPointToSession(state, { committed, pending: [] });
        state = result.state;

        if (i >= 3) {
          expect(result.renderUpdate.committedOverlapCount).toBe(3);
        }
      }
    });
  });

  describe("endStrokeSession", () => {
    it("should return StrokeCommand with layerId for valid stroke (2+ points)", () => {
      const filterOutput = {
        committed: [
          { x: 10, y: 20, timestamp: 1000 },
          { x: 30, y: 40, timestamp: 1002 },
        ],
        pending: [],
      };
      const result = startStrokeSession(filterOutput, style, expandConfig);

      const inputPoints = [
        { x: 10, y: 20, timestamp: 1000 },
        { x: 30, y: 40, timestamp: 1002 },
      ];

      const command = endStrokeSession(
        result.state,
        "layer_1",
        inputPoints,
        filterPipeline,
      );

      expect(command).not.toBeNull();
      expect(command?.type).toBe("stroke");
      expect(command?.layerId).toBe("layer_1");
      expect(command?.inputPoints).toEqual(inputPoints);
      expect(command?.color).toEqual(style.color);
      expect(command?.lineWidth).toBe(style.lineWidth);
    });

    it("should return StrokeCommand for single-point stroke (1 point)", () => {
      const filterOutput = {
        committed: [{ x: 10, y: 20, timestamp: 1000 }],
        pending: [],
      };
      const result = startStrokeSession(filterOutput, style, expandConfig);

      const inputPoints = [{ x: 10, y: 20, timestamp: 1000 }];

      const command = endStrokeSession(
        result.state,
        "layer_1",
        inputPoints,
        filterPipeline,
      );

      expect(command).not.toBeNull();
      expect(command?.type).toBe("stroke");
      expect(command?.layerId).toBe("layer_1");
    });

    it("should return null for empty stroke (0 points)", () => {
      const filterOutput = {
        committed: [],
        pending: [],
      };
      const result = startStrokeSession(filterOutput, style, expandConfig);

      const command = endStrokeSession(
        result.state,
        "layer_1",
        [],
        filterPipeline,
      );

      expect(command).toBeNull();
    });
  });

  describe("createStrokeCommand", () => {
    it("should create stroke command with layerId as first argument", () => {
      const inputPoints = [
        { x: 10, y: 20, timestamp: 1000 },
        { x: 30, y: 40, timestamp: 1002 },
      ];

      const command = createStrokeCommand(
        "layer_1",
        inputPoints,
        filterPipeline,
        expandConfig,
        style.color,
        style.lineWidth,
      );

      expect(command.type).toBe("stroke");
      expect(command.layerId).toBe("layer_1");
      expect(command.inputPoints).toEqual(inputPoints);
      expect(command.filterPipeline).toEqual(filterPipeline);
      expect(command.expand).toEqual(expandConfig);
      expect(command.color).toEqual(style.color);
      expect(command.lineWidth).toBe(style.lineWidth);
      expect(typeof command.timestamp).toBe("number");
    });
  });

  describe("createClearCommand", () => {
    it("should create clear command with layerId", () => {
      const command = createClearCommand("layer_1");

      expect(command.type).toBe("clear");
      expect(command.layerId).toBe("layer_1");
      expect(typeof command.timestamp).toBe("number");
    });
  });

  describe("createWrapShiftCommand", () => {
    it("should create wrap-shift command", () => {
      const command = createWrapShiftCommand(10, 20);

      expect(command.type).toBe("wrap-shift");
      expect(command.dx).toBe(10);
      expect(command.dy).toBe(20);
      expect(typeof command.timestamp).toBe("number");
    });
  });

  describe("createAddLayerCommand", () => {
    it("should create add-layer command with all fields", () => {
      const meta = { name: "Layer 2", visible: true, opacity: 1 };
      const command = createAddLayerCommand("layer_2", 1, 800, 600, meta);

      expect(command.type).toBe("add-layer");
      expect(command.layerId).toBe("layer_2");
      expect(command.insertIndex).toBe(1);
      expect(command.width).toBe(800);
      expect(command.height).toBe(600);
      expect(command.meta).toEqual(meta);
      expect(typeof command.timestamp).toBe("number");
    });
  });

  describe("createRemoveLayerCommand", () => {
    it("should create remove-layer command with layerId, removedIndex, and meta", () => {
      const meta = { name: "My Layer", visible: true, opacity: 0.8 };
      const command = createRemoveLayerCommand("layer_1", 0, meta);

      expect(command.type).toBe("remove-layer");
      expect(command.layerId).toBe("layer_1");
      expect(command.removedIndex).toBe(0);
      expect(command.meta).toEqual(meta);
      expect(typeof command.timestamp).toBe("number");
    });
  });

  describe("createReorderLayerCommand", () => {
    it("should create reorder-layer command with layerId, fromIndex, toIndex", () => {
      const command = createReorderLayerCommand("layer_1", 0, 2);

      expect(command.type).toBe("reorder-layer");
      expect(command.layerId).toBe("layer_1");
      expect(command.fromIndex).toBe(0);
      expect(command.toIndex).toBe(2);
      expect(typeof command.timestamp).toBe("number");
    });
  });
});
