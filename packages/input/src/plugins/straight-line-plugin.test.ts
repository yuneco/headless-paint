import { describe, expect, it } from "vitest";
import { compileFilterPipeline, processAllPoints } from "../filter-pipeline";
import type { InputPoint } from "../types";
import { straightLinePlugin } from "./straight-line-plugin";

const createPoint = (
  x: number,
  y: number,
  timestamp = 0,
  pressure?: number,
): InputPoint => ({
  x,
  y,
  timestamp,
  pressure,
});

describe("straightLinePlugin", () => {
  describe("type", () => {
    it('should have type "straight-line"', () => {
      expect(straightLinePlugin.type).toBe("straight-line");
    });
  });

  describe("createState", () => {
    it("should create initial state", () => {
      const state = straightLinePlugin.createState({});
      expect(state).toHaveProperty("startPoint", null);
      expect(state).toHaveProperty("lastPoint", null);
      expect(state).toHaveProperty("pressures");
    });
  });

  describe("process", () => {
    it("should keep committed empty and put first point in pending", () => {
      const state = straightLinePlugin.createState({});
      const result = straightLinePlugin.process(
        state,
        createPoint(10, 20, 0, 0.5),
      );

      expect(result.committed).toHaveLength(0);
      expect(result.pending).toHaveLength(1);
      expect(result.pending[0].x).toBe(10);
      expect(result.pending[0].y).toBe(20);
      expect(result.pending[0].pressure).toBe(0.5);
    });

    it("should output start→current in pending for subsequent points", () => {
      let state = straightLinePlugin.createState({});

      const r1 = straightLinePlugin.process(state, createPoint(0, 0, 0, 0.5));
      state = r1.state;

      const r2 = straightLinePlugin.process(
        state,
        createPoint(100, 200, 10, 0.7),
      );
      state = r2.state;

      expect(r2.committed).toHaveLength(0);
      expect(r2.pending).toHaveLength(2);
      // start point
      expect(r2.pending[0].x).toBe(0);
      expect(r2.pending[0].y).toBe(0);
      // current point
      expect(r2.pending[1].x).toBe(100);
      expect(r2.pending[1].y).toBe(200);
    });

    it("should apply real-time median pressure to pending points", () => {
      let state = straightLinePlugin.createState({});

      // pressures: [0.2]
      const r1 = straightLinePlugin.process(state, createPoint(0, 0, 0, 0.2));
      state = r1.state;
      expect(r1.pending[0].pressure).toBe(0.2);

      // pressures: [0.2, 0.8] → median = 0.5
      const r2 = straightLinePlugin.process(state, createPoint(10, 10, 1, 0.8));
      state = r2.state;
      expect(r2.pending[0].pressure).toBe(0.5);
      expect(r2.pending[1].pressure).toBe(0.5);

      // pressures: [0.2, 0.8, 0.6] → sorted [0.2, 0.6, 0.8] → median = 0.6
      const r3 = straightLinePlugin.process(state, createPoint(20, 20, 2, 0.6));
      expect(r3.pending[0].pressure).toBe(0.6);
      expect(r3.pending[1].pressure).toBe(0.6);
    });

    it("should use 0.5 as default pressure when pressure is undefined", () => {
      const state = straightLinePlugin.createState({});
      const r1 = straightLinePlugin.process(
        state,
        createPoint(0, 0, 0), // no pressure
      );
      expect(r1.pending[0].pressure).toBe(0.5);
    });
  });

  describe("finalize", () => {
    it("should return empty when no points were processed", () => {
      const state = straightLinePlugin.createState({});
      const result = straightLinePlugin.finalize(state);
      expect(result.committed).toHaveLength(0);
      expect(result.pending).toHaveLength(0);
    });

    it("should return 1 point for single-point stroke", () => {
      let state = straightLinePlugin.createState({});
      const r = straightLinePlugin.process(state, createPoint(10, 20, 0, 0.7));
      state = r.state;

      const result = straightLinePlugin.finalize(state);
      expect(result.committed).toHaveLength(1);
      expect(result.committed[0].x).toBe(10);
      expect(result.committed[0].y).toBe(20);
      expect(result.committed[0].pressure).toBe(0.7);
      expect(result.pending).toHaveLength(0);
    });

    it("should return start+end with median pressure for multi-point stroke", () => {
      let state = straightLinePlugin.createState({});

      // Process 5 points with varying pressures
      const points: InputPoint[] = [
        createPoint(0, 0, 0, 0.3),
        createPoint(10, 10, 1, 0.5),
        createPoint(20, 20, 2, 0.7),
        createPoint(30, 30, 3, 0.4),
        createPoint(100, 200, 4, 0.9),
      ];

      for (const p of points) {
        const r = straightLinePlugin.process(state, p);
        state = r.state;
      }

      const result = straightLinePlugin.finalize(state);

      expect(result.committed).toHaveLength(2);

      // start point coordinates
      expect(result.committed[0].x).toBe(0);
      expect(result.committed[0].y).toBe(0);

      // end point coordinates
      expect(result.committed[1].x).toBe(100);
      expect(result.committed[1].y).toBe(200);

      // median of [0.3, 0.5, 0.7, 0.4, 0.9] → sorted [0.3, 0.4, 0.5, 0.7, 0.9] → 0.5
      expect(result.committed[0].pressure).toBe(0.5);
      expect(result.committed[1].pressure).toBe(0.5);

      expect(result.pending).toHaveLength(0);
    });

    it("should compute median correctly for even number of pressures", () => {
      let state = straightLinePlugin.createState({});
      const points: InputPoint[] = [
        createPoint(0, 0, 0, 0.2),
        createPoint(10, 10, 1, 0.4),
        createPoint(20, 20, 2, 0.6),
        createPoint(30, 30, 3, 0.8),
      ];

      for (const p of points) {
        const r = straightLinePlugin.process(state, p);
        state = r.state;
      }

      const result = straightLinePlugin.finalize(state);
      // sorted: [0.2, 0.4, 0.6, 0.8] → median = (0.4 + 0.6) / 2 = 0.5
      expect(result.committed[0].pressure).toBe(0.5);
    });
  });

  describe("processAllPoints (replay)", () => {
    it("should produce same result as incremental process + finalize", () => {
      const compiled = compileFilterPipeline({
        filters: [{ type: "straight-line", config: {} }],
      });

      const points: InputPoint[] = [
        createPoint(0, 0, 0, 0.3),
        createPoint(25, 50, 1, 0.5),
        createPoint(50, 100, 2, 0.7),
        createPoint(75, 150, 3, 0.4),
        createPoint(100, 200, 4, 0.6),
      ];

      const result = processAllPoints(points, compiled);

      expect(result).toHaveLength(2);
      expect(result[0].x).toBe(0);
      expect(result[0].y).toBe(0);
      expect(result[1].x).toBe(100);
      expect(result[1].y).toBe(200);

      // median of [0.3, 0.5, 0.7, 0.4, 0.6] → sorted [0.3, 0.4, 0.5, 0.6, 0.7] → 0.5
      expect(result[0].pressure).toBe(0.5);
      expect(result[1].pressure).toBe(0.5);
    });

    it("should handle single point", () => {
      const compiled = compileFilterPipeline({
        filters: [{ type: "straight-line", config: {} }],
      });

      const result = processAllPoints([createPoint(42, 84, 0, 0.6)], compiled);

      expect(result).toHaveLength(1);
      expect(result[0].x).toBe(42);
      expect(result[0].y).toBe(84);
      expect(result[0].pressure).toBe(0.6);
    });
  });
});
