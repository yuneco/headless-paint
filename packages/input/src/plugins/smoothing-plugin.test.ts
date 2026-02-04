import { describe, expect, it } from "vitest";
import type { InputPoint, SmoothingConfig } from "../types";
import { smoothingPlugin } from "./smoothing-plugin";

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

describe("smoothingPlugin", () => {
  describe("type", () => {
    it('should have type "smoothing"', () => {
      expect(smoothingPlugin.type).toBe("smoothing");
    });
  });

  describe("createState", () => {
    it("should create initial state with empty buffer", () => {
      const config: SmoothingConfig = { windowSize: 5 };
      const state = smoothingPlugin.createState(config);

      expect(state).toHaveProperty("buffer");
      expect(state).toHaveProperty("windowSize", 5);
    });
  });

  describe("process", () => {
    it("should accumulate points in buffer until windowSize", () => {
      const config: SmoothingConfig = { windowSize: 3 };
      let state = smoothingPlugin.createState(config);

      // First point
      const result1 = smoothingPlugin.process(state, createPoint(10, 10));
      state = result1.state;
      expect(result1.committed).toHaveLength(0);
      expect(result1.pending).toHaveLength(1);

      // Second point
      const result2 = smoothingPlugin.process(state, createPoint(20, 20));
      state = result2.state;
      expect(result2.committed).toHaveLength(0);
      expect(result2.pending).toHaveLength(2);

      // Third point
      const result3 = smoothingPlugin.process(state, createPoint(30, 30));
      state = result3.state;
      expect(result3.committed).toHaveLength(0);
      expect(result3.pending).toHaveLength(3);

      // Fourth point - should emit first committed
      const result4 = smoothingPlugin.process(state, createPoint(40, 40));
      expect(result4.committed).toHaveLength(1);
      expect(result4.pending).toHaveLength(3);
    });

    it("should produce smoothed coordinates", () => {
      const config: SmoothingConfig = { windowSize: 3 };
      let state = smoothingPlugin.createState(config);

      // Add points forming a jagged line
      const points = [
        createPoint(0, 0),
        createPoint(10, 20), // spike
        createPoint(20, 0),
        createPoint(30, 20), // spike
        createPoint(40, 0),
      ];

      for (const point of points) {
        const result = smoothingPlugin.process(state, point);
        state = result.state;
      }

      // Committed points should be smoothed (not exactly 0 or 20)
      const finalResult = smoothingPlugin.process(state, createPoint(50, 0));
      expect(finalResult.committed.length).toBeGreaterThan(0);

      const committed = finalResult.committed[0];
      // The smoothed y should be between 0 and 20 (averaging effect)
      expect(committed.y).toBeGreaterThanOrEqual(0);
      expect(committed.y).toBeLessThanOrEqual(20);
    });

    it("should preserve pressure information", () => {
      const config: SmoothingConfig = { windowSize: 3 };
      let state = smoothingPlugin.createState(config);

      const points = [
        createPoint(0, 0, 0, 0.5),
        createPoint(10, 10, 0, 0.6),
        createPoint(20, 20, 0, 0.7),
        createPoint(30, 30, 0, 0.8),
      ];

      for (const point of points) {
        const result = smoothingPlugin.process(state, point);
        state = result.state;
      }

      // Check that pending points have pressure
      const lastResult = smoothingPlugin.process(
        state,
        createPoint(40, 40, 0, 0.9),
      );
      const committed = lastResult.committed[0];
      expect(committed.pressure).toBeDefined();
      expect(committed.pressure).toBeGreaterThan(0);
      expect(committed.pressure).toBeLessThanOrEqual(1);
    });
  });

  describe("finalize", () => {
    it("should flush all remaining buffer points", () => {
      const config: SmoothingConfig = { windowSize: 5 };
      let state = smoothingPlugin.createState(config);

      // Add 3 points (less than windowSize)
      for (let i = 0; i < 3; i++) {
        const result = smoothingPlugin.process(
          state,
          createPoint(i * 10, i * 10),
        );
        state = result.state;
      }

      // Finalize should commit all 3 points
      const finalResult = smoothingPlugin.finalize(state);
      expect(finalResult.committed).toHaveLength(3);
      expect(finalResult.pending).toHaveLength(0);
    });

    it("should return empty for empty buffer", () => {
      const config: SmoothingConfig = { windowSize: 3 };
      const state = smoothingPlugin.createState(config);

      const result = smoothingPlugin.finalize(state);
      expect(result.committed).toHaveLength(0);
      expect(result.pending).toHaveLength(0);
    });

    it("should produce smoothed points even at end", () => {
      const config: SmoothingConfig = { windowSize: 3 };
      let state = smoothingPlugin.createState(config);

      // Add jagged points
      const points = [
        createPoint(0, 0),
        createPoint(10, 50), // big spike
        createPoint(20, 0),
      ];

      for (const point of points) {
        const result = smoothingPlugin.process(state, point);
        state = result.state;
      }

      const finalResult = smoothingPlugin.finalize(state);

      // Middle point should be smoothed
      const middlePoint = finalResult.committed[1];
      expect(middlePoint.y).toBeGreaterThan(0);
      expect(middlePoint.y).toBeLessThan(50);
    });
  });
});
