import { describe, expect, it } from "vitest";
import {
  type TransformMachineEvent,
  type TransformPhase,
  type TransformPixelSource,
  createInitialTransformPhase,
  transitionTransform,
} from "./transform-machine";

const bounds = { x: 1, y: 2, width: 30, height: 40 };
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
const translated = [1, 0, 0, 0, 1, 0, 12, 34, 1] as const;

function active(
  overrides: Partial<
    Extract<TransformPhase, { readonly phase: "active" }>
  > = {},
): Extract<TransformPhase, { readonly phase: "active" }> {
  return {
    phase: "active",
    layerId: "layer-a",
    source: { type: "layer" },
    bounds,
    matrix: identity,
    ...overrides,
  };
}

function expectNoOp(state: TransformPhase, event: TransformMachineEvent): void {
  const result = transitionTransform(state, event);
  expect(result.next).toBe(state);
  expect(result.effects).toEqual([]);
}

describe("transform-machine", () => {
  it("creates the initial idle phase", () => {
    expect(createInitialTransformPhase()).toEqual({ phase: "idle" });
  });

  describe("idle", () => {
    it("begins a layer transform with identity matrix", () => {
      const result = transitionTransform(createInitialTransformPhase(), {
        type: "begin",
        layerId: "layer-a",
        bounds,
      });

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-a",
        source: { type: "layer" },
        bounds,
        matrix: identity,
      });
      expect(result.effects).toEqual([]);
    });

    it("keeps an explicit source", () => {
      const source: TransformPixelSource = { type: "layer" };
      const result = transitionTransform(createInitialTransformPhase(), {
        type: "begin",
        layerId: "layer-a",
        bounds,
        source,
      });

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-a",
        source,
        bounds,
        matrix: identity,
      });
    });

    it.each<TransformMachineEvent>([
      { type: "set-matrix", matrix: translated },
      { type: "commit" },
      { type: "cancel" },
    ])("ignores %s", (event) => {
      const state = createInitialTransformPhase();
      expectNoOp(state, event);
    });
  });

  describe("active", () => {
    it("ignores nested begin", () => {
      const state = active();
      expectNoOp(state, {
        type: "begin",
        layerId: "layer-b",
        bounds: { x: 9, y: 9, width: 9, height: 9 },
      });
    });

    it("updates matrix without producing effects", () => {
      const result = transitionTransform(active(), {
        type: "set-matrix",
        matrix: translated,
      });

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-a",
        source: { type: "layer" },
        bounds,
        matrix: translated,
      });
      expect(result.effects).toEqual([]);
    });

    it("commits an identity transform without bake-and-record", () => {
      const result = transitionTransform(active({ matrix: identity }), {
        type: "commit",
      });

      expect(result.next).toEqual({ phase: "idle" });
      expect(result.effects).toEqual([{ type: "session-ended" }]);
    });

    it("commits a changed transform with bake-and-record before session-ended", () => {
      const result = transitionTransform(active({ matrix: translated }), {
        type: "commit",
      });

      expect(result.next).toEqual({ phase: "idle" });
      expect(result.effects).toEqual([
        {
          type: "bake-and-record",
          layerId: "layer-a",
          matrix: translated,
        },
        { type: "session-ended" },
      ]);
    });

    it("cancels without baking", () => {
      const result = transitionTransform(active({ matrix: translated }), {
        type: "cancel",
      });

      expect(result.next).toEqual({ phase: "idle" });
      expect(result.effects).toEqual([{ type: "session-ended" }]);
    });
  });
});
