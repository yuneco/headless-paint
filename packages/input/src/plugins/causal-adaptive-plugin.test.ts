import { describe, expect, it } from "vitest";
import {
  compileFilterPipeline,
  createFilterPipelineState,
  processAllPoints,
  processPoint,
} from "../filter-pipeline";
import type { InputPoint } from "../types";

const CONFIG = {
  filters: [{ type: "causal-adaptive" as const, config: {} }],
};

describe("causal-adaptive filter", () => {
  it("各入力点を即座にcommitし、pendingを生成しない", () => {
    const compiled = compileFilterPipeline(CONFIG);
    let state = createFilterPipelineState(compiled);
    for (const point of points()) {
      const result = processPoint(state, point, compiled);
      state = result.state;
      expect(result.output.pending).toEqual([]);
      expect(result.output.committed).toHaveLength(state.allCommitted.length);
    }
  });

  it("低速の細かな揺れを抑え、pressureとtimestampは現在入力を保持する", () => {
    const output = processAllPoints(points(), compileFilterPipeline(CONFIG));
    expect(output).toHaveLength(4);
    expect(output[2]?.y).toBeLessThan(1);
    expect(output[2]?.pressure).toBe(0.7);
    expect(output[2]?.timestamp).toBe(8);
  });

  it("同じ入力からliveと一括処理で同じ結果を返す", () => {
    const compiled = compileFilterPipeline(CONFIG);
    const batch = processAllPoints(points(), compiled);
    let state = createFilterPipelineState(compiled);
    for (const point of points()) {
      state = processPoint(state, point, compiled).state;
    }
    expect(state.allCommitted).toEqual(batch);
  });
});

function points(): readonly InputPoint[] {
  return [
    { x: 0, y: 0, pressure: 0.2, timestamp: 0 },
    { x: 1, y: 0.4, pressure: 0.5, timestamp: 4 },
    { x: 2, y: 1.2, pressure: 0.7, timestamp: 8 },
    { x: 12, y: 1, pressure: 0.9, timestamp: 12 },
  ];
}
