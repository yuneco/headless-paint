import { describe, expect, it } from "vitest";
import { smoothStampPressure } from "./pressure-smoothing";

describe("stamp pressure smoothing", () => {
  it("is exact when disabled", () => {
    const result = smoothStampPressure(0.8, 16, 0, {
      value: 0.2,
      timestamp: 0,
    });
    expect(result).toEqual({ value: 0.8 });
  });

  it("attenuates short-period pressure changes causally", () => {
    const first = smoothStampPressure(0.4, 0, 50, undefined);
    const second = smoothStampPressure(0.8, 10, 50, first.state);
    expect(second.value).toBeGreaterThan(0.4);
    expect(second.value).toBeLessThan(0.5);
    expect(second.state?.timestamp).toBe(10);
  });

  it("falls back to raw pressure when timestamps are missing", () => {
    const result = smoothStampPressure(0.8, undefined, 50, {
      value: 0.2,
      timestamp: 0,
    });
    expect(result).toEqual({ value: 0.8 });
  });

  it("keeps the filtered value for emissions sharing a timestamp", () => {
    const previous = { value: 0.4, timestamp: 10 };
    const result = smoothStampPressure(0.9, 10, 50, previous);
    expect(result).toEqual({ value: 0.4, state: previous });
  });
});
