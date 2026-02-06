import { describe, expect, it } from "vitest";
import {
  addPointToSession,
  createClearCommand,
  createStrokeCommand,
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
    mode: "none" as const,
    origin: { x: 100, y: 100 },
    angle: 0,
    divisions: 1,
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

      // Starts from max(0, lastRenderedCommitIndex=1) = index 1
      expect(result3.renderUpdate.newlyCommitted).toEqual([
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ]);
    });
  });

  describe("endStrokeSession", () => {
    it("should return StrokeCommand for valid stroke (2+ points)", () => {
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
        inputPoints,
        filterPipeline,
      );

      expect(command).not.toBeNull();
      expect(command?.type).toBe("stroke");
      expect(command?.inputPoints).toEqual(inputPoints);
      expect(command?.color).toEqual(style.color);
      expect(command?.lineWidth).toBe(style.lineWidth);
    });

    it("should return null for invalid stroke (< 2 points)", () => {
      const filterOutput = {
        committed: [{ x: 10, y: 20, timestamp: 1000 }],
        pending: [],
      };
      const result = startStrokeSession(filterOutput, style, expandConfig);

      const inputPoints = [{ x: 10, y: 20, timestamp: 1000 }];

      const command = endStrokeSession(
        result.state,
        inputPoints,
        filterPipeline,
      );

      expect(command).toBeNull();
    });
  });

  describe("createStrokeCommand", () => {
    it("should create stroke command with provided parameters", () => {
      const inputPoints = [
        { x: 10, y: 20, timestamp: 1000 },
        { x: 30, y: 40, timestamp: 1002 },
      ];

      const command = createStrokeCommand(
        inputPoints,
        filterPipeline,
        expandConfig,
        style.color,
        style.lineWidth,
      );

      expect(command.type).toBe("stroke");
      expect(command.inputPoints).toEqual(inputPoints);
      expect(command.filterPipeline).toEqual(filterPipeline);
      expect(command.expand).toEqual(expandConfig);
      expect(command.color).toEqual(style.color);
      expect(command.lineWidth).toBe(style.lineWidth);
      expect(typeof command.timestamp).toBe("number");
    });
  });

  describe("createClearCommand", () => {
    it("should create clear command", () => {
      const command = createClearCommand();

      expect(command.type).toBe("clear");
      expect(typeof command.timestamp).toBe("number");
    });
  });
});
