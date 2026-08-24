import { describe, expect, it } from "vitest";
import { createSamplingState, shouldAcceptPoint } from "./sampling";

describe("shouldAcceptPoint", () => {
  it("accepts the first point", () => {
    const [accepted, state] = shouldAcceptPoint(
      { x: 0, y: 0 },
      100,
      createSamplingState(),
      { minDistance: 2 },
    );

    expect(accepted).toBe(true);
    expect(state).toEqual({
      lastPoint: { x: 0, y: 0 },
      lastTimestamp: 100,
    });
  });

  it("rejects a repeated overlapping coalesced batch", () => {
    let state = createSamplingState();
    const acceptedTimestamps: number[] = [];
    const candidates = [
      { x: 0, timestamp: 100 },
      { x: 10, timestamp: 104 },
      { x: 20, timestamp: 108 },
      // 次のpointermoveが直前のcoalesced batchを再提示するケース
      { x: 10, timestamp: 104 },
      { x: 20, timestamp: 108 },
      { x: 30, timestamp: 112 },
    ];

    for (const candidate of candidates) {
      const [accepted, nextState] = shouldAcceptPoint(
        { x: candidate.x, y: 0 },
        candidate.timestamp,
        state,
        { minDistance: 2 },
      );
      state = nextState;
      if (accepted) acceptedTimestamps.push(candidate.timestamp);
    }

    expect(acceptedTimestamps).toEqual([100, 104, 108, 112]);
    expect(state).toEqual({
      lastPoint: { x: 30, y: 0 },
      lastTimestamp: 112,
    });
  });

  it("rejects an identical point at the same timestamp and any older point", () => {
    const [, initial] = shouldAcceptPoint(
      { x: 0, y: 0 },
      100,
      createSamplingState(),
      { minDistance: 2 },
    );

    const [equalAccepted, equalState] = shouldAcceptPoint(
      { x: 0, y: 0 },
      100,
      initial,
      { minDistance: 2 },
    );
    const [olderAccepted, olderState] = shouldAcceptPoint(
      { x: 100, y: 0 },
      99,
      initial,
      { minDistance: 2 },
    );

    expect(equalAccepted).toBe(false);
    expect(equalState).toBe(initial);
    expect(olderAccepted).toBe(false);
    expect(olderState).toBe(initial);
  });

  it("allows a different point at the same timestamp for coarse clocks", () => {
    const [, initial] = shouldAcceptPoint(
      { x: 0, y: 0 },
      100,
      createSamplingState(),
      { minDistance: 2 },
    );
    const [accepted, state] = shouldAcceptPoint({ x: 10, y: 0 }, 100, initial, {
      minDistance: 2,
    });

    expect(accepted).toBe(true);
    expect(state).toEqual({
      lastPoint: { x: 10, y: 0 },
      lastTimestamp: 100,
    });
  });

  it("keeps the existing distance and time interval behavior for newer points", () => {
    const [, initial] = shouldAcceptPoint(
      { x: 0, y: 0 },
      100,
      createSamplingState(),
      { minDistance: 2, minTimeInterval: 10 },
    );
    const [tooClose, unchanged] = shouldAcceptPoint(
      { x: 1, y: 0 },
      105,
      initial,
      { minDistance: 2, minTimeInterval: 10 },
    );
    const [acceptedByTime, updated] = shouldAcceptPoint(
      { x: 1, y: 0 },
      110,
      initial,
      { minDistance: 2, minTimeInterval: 10 },
    );

    expect(tooClose).toBe(false);
    expect(unchanged).toBe(initial);
    expect(acceptedByTime).toBe(true);
    expect(updated).toEqual({
      lastPoint: { x: 1, y: 0 },
      lastTimestamp: 110,
    });
  });
});
