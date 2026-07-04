import { describe, expect, it } from "vitest";
import { createInitialStrokePhase, transitionStroke } from "./stroke-machine";
import type {
  StrokeMachineEffect,
  StrokeMachineEvent,
  StrokePhase,
} from "./stroke-machine";

function active(
  overrides: Partial<Extract<StrokePhase, { readonly phase: "active" }>> = {},
): Extract<StrokePhase, { readonly phase: "active" }> {
  return {
    phase: "active",
    layerId: "layer-a",
    pendingOnly: false,
    hasEmission: false,
    pointCount: 3,
    ...overrides,
  };
}

const startRegular: StrokeMachineEvent = {
  type: "start",
  layerId: "layer-b",
  pendingOnly: false,
  hasEmission: false,
};

const startPendingWithEmission: StrokeMachineEvent = {
  type: "start",
  layerId: "layer-c",
  pendingOnly: true,
  hasEmission: true,
};

function expectNoOp(state: StrokePhase, event: StrokeMachineEvent): void {
  const result = transitionStroke(state, event);
  expect(result.next).toBe(state);
  expect(result.effects).toEqual([]);
}

describe("stroke-machine", () => {
  it("creates the initial idle phase", () => {
    expect(createInitialStrokePhase()).toEqual({ phase: "idle" });
  });

  describe("idle", () => {
    it("transitions to active on regular start", () => {
      const result = transitionStroke(createInitialStrokePhase(), startRegular);

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-b",
        pendingOnly: false,
        hasEmission: false,
        pointCount: 1,
      });
      expect(result.effects).toEqual([
        { type: "snapshot-layer" },
        { type: "append-committed" },
        { type: "render-pending" },
        { type: "drawing-changed", isDrawing: true },
      ]);
    });

    it("omits committed append and schedules emission on pending start with emission", () => {
      const result = transitionStroke(
        createInitialStrokePhase(),
        startPendingWithEmission,
      );

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-c",
        pendingOnly: true,
        hasEmission: true,
        pointCount: 1,
      });
      expect(result.effects).toEqual([
        { type: "snapshot-layer" },
        { type: "render-pending" },
        { type: "drawing-changed", isDrawing: true },
        { type: "schedule-emission" },
      ]);
    });

    it.each<StrokeMachineEvent>([
      { type: "move" },
      { type: "confirm" },
      { type: "end" },
      { type: "cancel" },
      { type: "dispose" },
    ])("ignores %s", (event) => {
      const state = createInitialStrokePhase();
      expectNoOp(state, event);
    });
  });

  describe("active regular", () => {
    it("auto-cancels the current stroke before starting a new regular stroke", () => {
      const result = transitionStroke(active(), startRegular);

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-b",
        pendingOnly: false,
        hasEmission: false,
        pointCount: 1,
      });
      expect(result.effects).toEqual([
        { type: "cancel-emission" },
        { type: "restore-snapshot" },
        { type: "snapshot-layer" },
        { type: "append-committed" },
        { type: "render-pending" },
        { type: "drawing-changed", isDrawing: true },
      ]);
    });

    it("increments pointCount and appends committed chunks on move", () => {
      const result = transitionStroke(active(), { type: "move" });

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-a",
        pendingOnly: false,
        hasEmission: false,
        pointCount: 4,
      });
      expect(result.effects).toEqual([
        { type: "append-committed" },
        { type: "render-pending" },
        { type: "schedule-render" },
      ]);
    });

    it("schedules emission on move when the active stroke has emission", () => {
      const result = transitionStroke(active({ hasEmission: true }), {
        type: "move",
      });

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-a",
        pendingOnly: false,
        hasEmission: true,
        pointCount: 4,
      });
      expect(result.effects).toEqual([
        { type: "append-committed" },
        { type: "render-pending" },
        { type: "schedule-render" },
        { type: "schedule-emission" },
      ]);
    });

    it("ignores confirm", () => {
      const state = active();
      expectNoOp(state, { type: "confirm" });
    });

    it("finalizes on end", () => {
      const result = transitionStroke(active(), { type: "end" });

      expect(result.next).toEqual({ phase: "idle" });
      expect(result.effects).toEqual([
        { type: "cancel-emission" },
        { type: "finalize-commit" },
        { type: "drawing-changed", isDrawing: false },
      ]);
    });

    it("restores on cancel", () => {
      const result = transitionStroke(active(), { type: "cancel" });

      expect(result.next).toEqual({ phase: "idle" });
      expect(result.effects).toEqual([
        { type: "cancel-emission" },
        { type: "restore-snapshot" },
        { type: "drawing-changed", isDrawing: false },
      ]);
    });

    it("disposes without restoring or finalizing", () => {
      const result = transitionStroke(active(), { type: "dispose" });

      expect(result.next).toEqual({ phase: "idle" });
      expect(result.effects).toEqual([
        { type: "cancel-emission" },
        { type: "drawing-changed", isDrawing: false },
      ]);
    });
  });

  describe("active pendingOnly", () => {
    it("auto-cancels the current stroke before starting a new pending stroke", () => {
      const result = transitionStroke(
        active({ pendingOnly: true, hasEmission: true }),
        startPendingWithEmission,
      );

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-c",
        pendingOnly: true,
        hasEmission: true,
        pointCount: 1,
      });
      expect(result.effects).toEqual([
        { type: "cancel-emission" },
        { type: "restore-snapshot" },
        { type: "snapshot-layer" },
        { type: "render-pending" },
        { type: "drawing-changed", isDrawing: true },
        { type: "schedule-emission" },
      ]);
    });

    it("moves without committed append", () => {
      const result = transitionStroke(
        active({ pendingOnly: true, hasEmission: true }),
        { type: "move" },
      );

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-a",
        pendingOnly: true,
        hasEmission: true,
        pointCount: 4,
      });
      expect(result.effects).toEqual([
        { type: "render-pending" },
        { type: "schedule-render" },
        { type: "schedule-emission" },
      ]);
    });

    it("confirms pending drawing into committed mode", () => {
      const result = transitionStroke(active({ pendingOnly: true }), {
        type: "confirm",
      });

      expect(result.next).toEqual({
        phase: "active",
        layerId: "layer-a",
        pendingOnly: false,
        hasEmission: false,
        pointCount: 3,
      });
      expect(result.effects).toEqual([
        { type: "snapshot-layer" },
        { type: "append-committed" },
      ]);
    });

    it.each<readonly [StrokeMachineEvent, readonly StrokeMachineEffect[]]>([
      [
        { type: "end" },
        [
          { type: "cancel-emission" },
          { type: "finalize-commit" },
          { type: "drawing-changed", isDrawing: false },
        ],
      ],
      [
        { type: "cancel" },
        [
          { type: "cancel-emission" },
          { type: "restore-snapshot" },
          { type: "drawing-changed", isDrawing: false },
        ],
      ],
      [
        { type: "dispose" },
        [
          { type: "cancel-emission" },
          { type: "drawing-changed", isDrawing: false },
        ],
      ],
    ])("returns to idle on %s", (event, effects) => {
      const result = transitionStroke(active({ pendingOnly: true }), event);

      expect(result.next).toEqual({ phase: "idle" });
      expect(result.effects).toEqual(effects);
    });
  });
});
