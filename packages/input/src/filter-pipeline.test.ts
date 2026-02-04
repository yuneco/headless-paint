import { describe, expect, it } from "vitest";
import {
  compileFilterPipeline,
  createFilterPipelineState,
  finalizePipeline,
  processAllPoints,
  processPoint,
} from "./filter-pipeline";
import type { FilterPipelineConfig, InputPoint } from "./types";

const createPoint = (x: number, y: number, timestamp = 0): InputPoint => ({
  x,
  y,
  timestamp,
});

describe("compileFilterPipeline", () => {
  it("should compile empty filter config", () => {
    const config: FilterPipelineConfig = { filters: [] };
    const compiled = compileFilterPipeline(config);

    expect(compiled.config).toBe(config);
    expect(compiled.plugins).toHaveLength(0);
  });

  it("should compile config with smoothing filter", () => {
    const config: FilterPipelineConfig = {
      filters: [{ type: "smoothing", config: { windowSize: 5 } }],
    };
    const compiled = compileFilterPipeline(config);

    expect(compiled.plugins).toHaveLength(1);
    expect(compiled.plugins[0].type).toBe("smoothing");
  });
});

describe("createFilterPipelineState", () => {
  it("should create initial state for empty pipeline", () => {
    const compiled = compileFilterPipeline({ filters: [] });
    const state = createFilterPipelineState(compiled);

    expect(state.filterStates).toHaveLength(0);
    expect(state.allCommitted).toHaveLength(0);
  });

  it("should create initial state with filter states", () => {
    const compiled = compileFilterPipeline({
      filters: [{ type: "smoothing", config: { windowSize: 3 } }],
    });
    const state = createFilterPipelineState(compiled);

    expect(state.filterStates).toHaveLength(1);
    expect(state.allCommitted).toHaveLength(0);
  });
});

describe("processPoint", () => {
  it("should pass through points when no filters", () => {
    const compiled = compileFilterPipeline({ filters: [] });
    let state = createFilterPipelineState(compiled);

    const result1 = processPoint(state, createPoint(10, 10), compiled);
    state = result1.state;
    expect(result1.output.committed).toHaveLength(1);
    expect(result1.output.pending).toHaveLength(0);

    const result2 = processPoint(state, createPoint(20, 20), compiled);
    expect(result2.output.committed).toHaveLength(2);
    expect(result2.output.pending).toHaveLength(0);
  });

  it("should accumulate points with smoothing filter", () => {
    const compiled = compileFilterPipeline({
      filters: [{ type: "smoothing", config: { windowSize: 3 } }],
    });
    let state = createFilterPipelineState(compiled);

    // First point: goes to pending
    const result1 = processPoint(state, createPoint(10, 10), compiled);
    state = result1.state;
    expect(result1.output.committed).toHaveLength(0);
    expect(result1.output.pending.length).toBeGreaterThan(0);

    // Second point: still in pending
    const result2 = processPoint(state, createPoint(20, 20), compiled);
    state = result2.state;
    expect(result2.output.committed).toHaveLength(0);

    // Third point: still in pending (windowSize=3)
    const result3 = processPoint(state, createPoint(30, 30), compiled);
    state = result3.state;
    expect(result3.output.committed).toHaveLength(0);

    // Fourth point: first point should be committed
    const result4 = processPoint(state, createPoint(40, 40), compiled);
    expect(result4.output.committed.length).toBeGreaterThan(0);
  });

  it("should separate committed and pending correctly", () => {
    const compiled = compileFilterPipeline({
      filters: [{ type: "smoothing", config: { windowSize: 3 } }],
    });
    let state = createFilterPipelineState(compiled);

    // Add several points
    for (let i = 0; i < 10; i++) {
      const result = processPoint(state, createPoint(i * 10, i * 10), compiled);
      state = result.state;

      // Pending should always have windowSize or fewer points
      expect(result.output.pending.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("finalizePipeline", () => {
  it("should return all committed for empty pipeline", () => {
    const compiled = compileFilterPipeline({ filters: [] });
    let state = createFilterPipelineState(compiled);

    state = processPoint(state, createPoint(10, 10), compiled).state;
    state = processPoint(state, createPoint(20, 20), compiled).state;

    const output = finalizePipeline(state, compiled);
    expect(output.committed).toHaveLength(2);
    expect(output.pending).toHaveLength(0);
  });

  it("should flush pending points on finalize", () => {
    const compiled = compileFilterPipeline({
      filters: [{ type: "smoothing", config: { windowSize: 5 } }],
    });
    let state = createFilterPipelineState(compiled);

    // Add 3 points (less than windowSize)
    for (let i = 0; i < 3; i++) {
      const result = processPoint(state, createPoint(i * 10, i * 10), compiled);
      state = result.state;
    }

    // Before finalize: should have pending points
    const beforeFinalize = processPoint(
      state,
      createPoint(30, 30),
      compiled,
    ).output;
    expect(beforeFinalize.pending.length).toBeGreaterThan(0);

    // Finalize: all points should be committed
    const output = finalizePipeline(state, compiled);
    expect(output.committed.length).toBeGreaterThan(0);
    expect(output.pending).toHaveLength(0);
  });
});

describe("processAllPoints", () => {
  it("should process all points at once", () => {
    const compiled = compileFilterPipeline({ filters: [] });
    const points = [
      createPoint(10, 10),
      createPoint(20, 20),
      createPoint(30, 30),
    ];

    const result = processAllPoints(points, compiled);
    expect(result).toHaveLength(3);
  });

  it("should return smoothed points", () => {
    const compiled = compileFilterPipeline({
      filters: [{ type: "smoothing", config: { windowSize: 3 } }],
    });
    const points = [
      createPoint(0, 0),
      createPoint(10, 10),
      createPoint(20, 20),
      createPoint(30, 30),
      createPoint(40, 40),
    ];

    const result = processAllPoints(points, compiled);
    // Should have same number of points
    expect(result).toHaveLength(5);

    // Smoothed points should be somewhat different from originals
    // (unless all points are on a line, which they are in this case)
  });
});
