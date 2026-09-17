import { describe, expect, it } from "vitest";
import {
  type BristleBranchRenderState,
  type BristleBrushConfig,
  DEFAULT_BRISTLE_DYNAMICS,
  DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
  DEFAULT_PRESSURE_CURVE,
} from "../types";
import { resolveSweepPoints } from "./bristle";
import type { EmissionPoint } from "./scheduler";
import { cloneBrushRenderState } from "./state";

const brushSize = 30;

function brush(handleLengthRatio: number): BristleBrushConfig {
  return {
    type: "bristle",
    dynamics: { ...DEFAULT_BRISTLE_DYNAMICS, handleLengthRatio },
    pressureDynamics: DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
  };
}

function emission(
  x: number,
  y: number,
  angle: number,
  distance: number,
): EmissionPoint {
  return {
    x,
    y,
    directionX: Math.cos(angle),
    directionY: Math.sin(angle),
    distance,
    emissionIndex: distance,
    pressure: 0.5,
    timestamp: undefined,
  };
}

function resolve(
  emissions: readonly EmissionPoint[],
  ratio: number,
  previous?: BristleBranchRenderState,
) {
  return resolveSweepPoints(
    emissions,
    previous,
    brushSize,
    brush(ratio),
    DEFAULT_PRESSURE_CURVE,
  );
}

function semicircle(steps = 720): readonly EmissionPoint[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (index * Math.PI) / steps;
    return emission(
      60 * Math.sin(angle),
      60 * (1 - Math.cos(angle)),
      angle,
      60 * angle,
    );
  });
}

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// frameX/Y is the longitudinal axis; (-frameY, frameX) is transverse.
function frameAngle(point: {
  readonly frameX: number;
  readonly frameY: number;
}) {
  return Math.atan2(point.frameY, point.frameX);
}

describe("bristle handle frame", () => {
  it("L=0 exactly preserves the pre-handle curve, cusp and lag output", () => {
    let x = 0;
    let y = 0;
    const emissions = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 3.6, 3.7, 3.8, 3.9].map(
      (angle, index) => {
        if (index > 0) {
          x += Math.cos(angle) * 3;
          y += Math.sin(angle) * 3;
        }
        return emission(x, y, angle, index * 3);
      },
    );
    let state: BristleBranchRenderState | undefined;
    const frames = emissions.map((point) => {
      const result = resolve([point], 0, state);
      const points = state ? result.points.slice(1) : result.points;
      state = result.state;
      return {
        points: points.map(({ frameX, frameY, breakBefore }) => [
          frameX,
          frameY,
          breakBefore,
        ]),
        frameSign: state.frameSign,
        lag: state.lag,
      };
    });
    // Recorded from the original resolver before adding the handle model.
    // Math.cos / Math.sin differ by 1 ulp between Node and Chromium, so the
    // snapshot compares values rounded to 12 decimals.
    const rounded = frames.map((frame) => ({
      ...frame,
      points: frame.points.map(([frameX, frameY, breakBefore]) => [
        Number((frameX as number).toFixed(12)),
        Number((frameY as number).toFixed(12)),
        breakBefore,
      ]),
    }));
    expect(rounded).toMatchSnapshot();
    const full = resolve(emissions, 0);
    expect(
      full.points.map(({ frameX, frameY, breakBefore }) => [
        frameX,
        frameY,
        breakBefore,
      ]),
    ).toEqual(frames.flatMap((frame) => frame.points));
    expect(full.state).toEqual(state);
  });

  it.each([
    [15, 5],
    [30, 2.5],
  ])(
    "L=%s keeps every longitudinal frame within %s degrees of horizontal under 1px jitter",
    (length, maxDegrees) => {
      const emissions = Array.from({ length: 201 }, (_, index) =>
        emission(
          index,
          index % 2,
          index === 0 ? 0 : index % 2 === 1 ? Math.PI / 4 : -Math.PI / 4,
          index * Math.SQRT2,
        ),
      );
      // Start horizontally, then alternate raw tangents by 90 degrees.
      const result = resolve(emissions, length / brushSize);
      expect(result.points).toHaveLength(emissions.length);
      for (const [index, point] of result.points.entries()) {
        const horizontalAngle = Math.atan2(
          Math.abs(point.frameY),
          Math.abs(point.frameX),
        );
        expect((horizontalAngle * 180) / Math.PI).toBeLessThanOrEqual(
          maxDegrees,
        );
        expect(point.breakBefore).toBe(false);
        expect(point.directionX).toBe(emissions[index].directionX);
        expect(point.directionY).toBe(emissions[index].directionY);
        expect(point.x).toBe(emissions[index].x);
        expect(point.y).toBe(emissions[index].y);
      }
      expect(result.state.frameSign).toBe(1);
      expect(result.state.lag).toBeUndefined();
    },
  );

  it("L=15 follows a radius-60 semicircle smoothly and converges to the geometric lag angle", () => {
    const emissions = semicircle();
    const { points, state } = resolve(emissions, 0.5);
    expect(points).toHaveLength(emissions.length);
    for (let index = 1; index < points.length; index++) {
      expect(
        (Math.abs(
          angleDelta(frameAngle(points[index - 1]), frameAngle(points[index])),
        ) *
          180) /
          Math.PI,
      ).toBeLessThan(5);
      expect(points[index].breakBefore).toBe(false);
    }
    // In the continuous pulled-string model, sin(lag) = L / radius.
    // The 0.262px sample spacing contributes less than 0.2 degrees of error.
    const endLags = points
      .slice(-40)
      .map((point) =>
        angleDelta(
          frameAngle(point),
          Math.atan2(point.directionY, point.directionX),
        ),
      );
    for (const lag of endLags) {
      expect((Math.abs(lag - Math.asin(15 / 60)) * 180) / Math.PI).toBeLessThan(
        0.2,
      );
    }
    expect(
      ((Math.max(...endLags) - Math.min(...endLags)) * 180) / Math.PI,
    ).toBeLessThan(0.02);
    expect(state.frameSign).toBe(1);
    expect(state.lag).toBeUndefined();
  });

  it("a 180-degree reversal flips frameSign after 2L without rotating the longitudinal frame sideways", () => {
    const emissions = Array.from({ length: 201 }, (_, index) => ({
      ...emission(index <= 100 ? index : 200 - index, 0, 0, index),
      directionX: index <= 100 ? 1 : -1,
    }));
    let state: BristleBranchRenderState | undefined;
    for (const point of emissions) {
      const result = resolve([point], 0.5, state);
      state = result.state;
      expect(state.frameSign).toBe(point.distance <= 130 ? 1 : -1);
      for (const resolved of result.points) {
        expect(Math.abs(resolved.frameY)).toBeLessThan(1e-12);
        expect(resolved.frameX).toBeCloseTo(1, 12);
      }
      if (point.distance === 131) {
        expect(state.lag?.startDistance).toBe(131);
        expect(result.points.at(-1)?.breakBefore).toBe(true);
      }
      if (
        point.distance >=
        100 + 2 * 15 + brushSize * DEFAULT_BRISTLE_DYNAMICS.lagLengthRatio + 1
      ) {
        expect(state.lag).toBeUndefined();
        expect(state.lastSweepPoint?.frameX).toBeCloseTo(1, 12);
      }
    }
  });

  it("retains the handle and its last taut direction at the slack boundary, through the handle and while stopped", () => {
    const initial = resolve(
      [emission(0, 0, 0, 0), emission(20, 5, 0.4, 21)],
      0.5,
    ).state;
    const handleX = initial.handleX as number;
    const handleY = initial.handleY as number;
    expect(initial.handleDirectionY).not.toBe(initial.incomingDirectionY);
    let state = initial;
    for (const point of [
      emission(handleX, handleY + 15, Math.PI / 2, 30), // dist = L
      emission(handleX, handleY, Math.PI, 45), // dist = 0
      emission(handleX - 1, handleY, Math.PI, 46),
      emission(handleX - 1, handleY, Math.PI / 2, 46), // no movement
    ]) {
      state = resolve([point], 0.5, state).state;
      expect([
        state.handleX,
        state.handleY,
        state.handleDirectionX,
        state.handleDirectionY,
      ]).toEqual([
        initial.handleX,
        initial.handleY,
        initial.handleDirectionX,
        initial.handleDirectionY,
      ]);
      expect(state.lastSweepPoint?.frameX).toBe(initial.handleDirectionX);
      expect(state.lastSweepPoint?.frameY).toBe(initial.handleDirectionY);
    }
  });

  it("matches a single flush at every split, including curved slack and reversal lag", () => {
    const forward = semicircle(180).slice(0, 91);
    const endDistance = forward[forward.length - 1].distance;
    const backward = forward
      .slice(0, -1)
      .reverse()
      .map((point, index) => ({
        ...point,
        directionX: -point.directionX,
        directionY: -point.directionY,
        distance: 2 * endDistance - point.distance,
        emissionIndex: forward.length + index,
      }));
    const emissions = [...forward, ...backward];
    const full = resolve(emissions, 0.5);
    expect(full.points.some((point) => point.breakBefore)).toBe(true);
    for (let split = 1; split < emissions.length; split++) {
      const first = resolve(emissions.slice(0, split), 0.5);
      const before = structuredClone(first.state);
      const second = resolve(emissions.slice(split), 0.5, first.state);
      // Each continuation prepends the preceding sweep point for rendering.
      expect(
        [...first.points, ...second.points.slice(1)],
        `split=${split}`,
      ).toEqual(full.points);
      expect(second.state, `split=${split}`).toEqual(full.state);
      expect(first.state).toEqual(before);
    }
  });

  it("initializes a new branch from its first tangent and leaves an empty flush unchanged", () => {
    const point = emission(20, 30, 0.7, 0);
    const result = resolve([point], 0.5);
    expect(result.state.handleX).toBe(point.x - point.directionX * 15);
    expect(result.state.handleY).toBe(point.y - point.directionY * 15);
    expect(result.state.handleDirectionX).toBe(point.directionX);
    expect(result.state.handleDirectionY).toBe(point.directionY);
    expect(resolve([], 0.5, result.state).state).toEqual(result.state);
  });

  it("clones the handle state without changing a continuation in curved slack", () => {
    const initial = resolve(
      [emission(0, 0, 0, 0), emission(20, 5, 0.4, 21)],
      0.5,
    ).state;
    const slack = resolve([emission(19, 4, Math.PI, 23)], 0.5, initial).state;
    const cloned = cloneBrushRenderState({
      heightMap: null,
      tipCanvas: null,
      seed: 7,
      branches: [{ accumulatedDistance: 23, emissionCount: 3, bristle: slack }],
    })?.branches[0].bristle;
    expect(cloned).toEqual(slack);
    expect(cloned).not.toBe(slack);
    const continuation = [emission(18, 3, Math.PI, 25)];
    expect(resolve(continuation, 0.5, cloned)).toEqual(
      resolve(continuation, 0.5, slack),
    );
  });
});
