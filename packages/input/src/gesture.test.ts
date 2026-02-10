import { describe, expect, it } from "vitest";
import {
  DEFAULT_GESTURE_CONFIG,
  createGestureState,
  processGestureEvent,
} from "./gesture";
import { createViewTransform } from "./transform";
import type { GesturePointerEvent, GestureState } from "./types";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function touchDown(
  pointerId: number,
  x: number,
  y: number,
  timestamp: number,
): GesturePointerEvent {
  return {
    pointerId,
    pointerType: "touch",
    x,
    y,
    pressure: 1.0,
    timestamp,
    eventType: "down",
  };
}

function touchMove(
  pointerId: number,
  x: number,
  y: number,
  timestamp: number,
): GesturePointerEvent {
  return {
    pointerId,
    pointerType: "touch",
    x,
    y,
    pressure: 1.0,
    timestamp,
    eventType: "move",
  };
}

function touchUp(
  pointerId: number,
  x: number,
  y: number,
  timestamp: number,
): GesturePointerEvent {
  return {
    pointerId,
    pointerType: "touch",
    x,
    y,
    pressure: 0,
    timestamp,
    eventType: "up",
  };
}

function touchCancel(
  pointerId: number,
  timestamp: number,
): GesturePointerEvent {
  return {
    pointerId,
    pointerType: "touch",
    x: 0,
    y: 0,
    pressure: 0,
    timestamp,
    eventType: "cancel",
  };
}

const config = DEFAULT_GESTURE_CONFIG;

function process(state: GestureState, event: GesturePointerEvent) {
  return processGestureEvent(state, event, config, createViewTransform());
}

// ------------------------------------------------------------
// Tests
// ------------------------------------------------------------

describe("gesture state machine", () => {
  describe("idle -> single_down", () => {
    it("should transition on touch down and emit draw-start", () => {
      const state = createGestureState();
      const [next, events] = process(state, touchDown(1, 100, 200, 1000));

      expect(next.phase).toBe("single_down");
      if (next.phase === "single_down") {
        expect(next.primaryPointerId).toBe(1);
        expect(next.downTimestamp).toBe(1000);
        expect(next.downPos).toEqual({ x: 100, y: 200 });
        expect(next.lastPos).toEqual({ x: 100, y: 200 });
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("draw-start");
      if (events[0].type === "draw-start") {
        expect(events[0].point.pointerId).toBe(1);
      }
    });
  });

  describe("single_down -> drawing", () => {
    it("should transition when move exceeds confirmDistancePx and emit draw-confirm + draw-move", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));

      // Move 20px (> 10px threshold)
      const [s2, events] = process(s1, touchMove(1, 120, 200, 1050));

      expect(s2.phase).toBe("drawing");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("draw-confirm");
      expect(events[1].type).toBe("draw-move");
    });

    it("should stay in single_down and emit draw-move when move is below threshold", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));

      // Move 5px (< 10px threshold)
      const [s2, events] = process(s1, touchMove(1, 103, 204, 1020));

      expect(s2.phase).toBe("single_down");
      if (s2.phase === "single_down") {
        expect(s2.lastPos).toEqual({ x: 103, y: 204 });
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("draw-move");
    });
  });

  describe("single_down -> gesture", () => {
    it("should transition on 2nd finger within grace window and emit draw-cancel + pinch-start", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));

      // 2nd finger within 150ms grace window
      const [s2, events] = process(s1, touchDown(2, 300, 400, 1100));

      expect(s2.phase).toBe("gesture");
      if (s2.phase === "gesture") {
        expect(s2.primaryPointerId).toBe(1);
        expect(s2.secondaryPointerId).toBe(2);
        expect(s2.gestureMoved).toBe(false);
      }
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("draw-cancel");
      expect(events[1].type).toBe("pinch-start");
      if (events[1].type === "pinch-start") {
        // Transform should be defined
        expect(events[1].transform).toBeDefined();
      }
    });

    it("should ignore 2nd finger outside grace window", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));

      // 2nd finger after 200ms (> 150ms grace window)
      const [s2, events] = process(s1, touchDown(2, 300, 400, 1200));

      expect(s2.phase).toBe("single_down");
      expect(events).toHaveLength(0);
    });
  });

  describe("single_down -> idle", () => {
    it("should transition on touch up and emit draw-end", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));

      const [s2, events] = process(s1, touchUp(1, 100, 200, 1050));

      expect(s2.phase).toBe("idle");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("draw-end");
    });

    it("should transition on cancel and emit draw-cancel", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));

      const [s2, events] = process(s1, touchCancel(1, 1050));

      expect(s2.phase).toBe("idle");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("draw-cancel");
    });
  });

  describe("drawing -> idle", () => {
    it("should transition on touch up and emit draw-end", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchMove(1, 120, 200, 1050)); // confirm

      expect(s2.phase).toBe("drawing");

      const [s3, events] = process(s2, touchUp(1, 130, 200, 1100));

      expect(s3.phase).toBe("idle");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("draw-end");
    });

    it("should emit draw-move on primary pointer move", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchMove(1, 120, 200, 1050));

      expect(s2.phase).toBe("drawing");

      const [s3, events] = process(s2, touchMove(1, 130, 210, 1060));

      expect(s3.phase).toBe("drawing");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("draw-move");
    });
  });

  describe("drawing -> gesture", () => {
    it("should transition on 2nd finger within grace window and emit draw-cancel + pinch-start", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchMove(1, 120, 200, 1050));

      expect(s2.phase).toBe("drawing");

      // 2nd finger at 1100 (within 150ms of downTimestamp=1000)
      const [s3, events] = process(s2, touchDown(2, 300, 400, 1100));

      expect(s3.phase).toBe("gesture");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("draw-cancel");
      expect(events[1].type).toBe("pinch-start");
    });
  });

  describe("drawing does not transition on late 2nd finger", () => {
    it("should ignore 2nd finger outside grace window", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchMove(1, 120, 200, 1050));

      expect(s2.phase).toBe("drawing");

      // 2nd finger at 1200 (> 150ms after downTimestamp=1000)
      const [s3, events] = process(s2, touchDown(2, 300, 400, 1200));

      expect(s3.phase).toBe("drawing");
      expect(events).toHaveLength(0);
    });
  });

  describe("gesture -> pinch-move", () => {
    it("should emit pinch-move with ViewTransform on finger move", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchDown(2, 300, 200, 1050));

      expect(s2.phase).toBe("gesture");

      // Move finger 2
      const [s3, events] = process(s2, touchMove(2, 350, 200, 1100));

      expect(s3.phase).toBe("gesture");
      if (s3.phase === "gesture") {
        expect(s3.gestureMoved).toBe(true);
        expect(s3.lastScreenP2).toEqual({ x: 350, y: 200 });
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("pinch-move");
      if (events[0].type === "pinch-move") {
        expect(events[0].transform).toBeDefined();
      }
    });

    it("should ignore move from unknown pointer", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchDown(2, 300, 200, 1050));

      expect(s2.phase).toBe("gesture");

      // Move from pointer 3 (unknown)
      const [s3, events] = process(s2, touchMove(3, 500, 500, 1100));

      expect(s3.phase).toBe("gesture");
      expect(events).toHaveLength(0);
    });
  });

  describe("gesture -> gesture_ending -> idle (undo)", () => {
    it("should emit undo when short tap with no movement", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchDown(2, 300, 200, 1050));

      expect(s2.phase).toBe("gesture");

      // First finger up (no move happened)
      const [s3, events3] = process(s2, touchUp(1, 100, 200, 1080));

      expect(s3.phase).toBe("gesture_ending");
      if (s3.phase === "gesture_ending") {
        expect(s3.remainingPointerId).toBe(2);
        expect(s3.gestureMoved).toBe(false);
      }
      expect(events3).toHaveLength(0);

      // Second finger up, within undoMaxDurationMs (300ms from downTimestamp=1000)
      const [s4, events4] = process(s3, touchUp(2, 300, 200, 1150));

      expect(s4.phase).toBe("idle");
      expect(events4).toHaveLength(1);
      expect(events4[0].type).toBe("undo");
    });
  });

  describe("gesture -> gesture_ending -> idle (pinch-end)", () => {
    it("should emit pinch-end when gesture had movement", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchDown(2, 300, 200, 1050));

      expect(s2.phase).toBe("gesture");

      // Move finger 2 → gestureMoved = true
      const [s3] = process(s2, touchMove(2, 350, 200, 1100));

      // First finger up
      const [s4] = process(s3, touchUp(1, 100, 200, 1150));

      expect(s4.phase).toBe("gesture_ending");
      if (s4.phase === "gesture_ending") {
        expect(s4.gestureMoved).toBe(true);
      }

      // Second finger up
      const [s5, events5] = process(s4, touchUp(2, 350, 200, 1200));

      expect(s5.phase).toBe("idle");
      expect(events5).toHaveLength(1);
      expect(events5[0].type).toBe("pinch-end");
    });

    it("should emit pinch-end when gesture duration exceeds undoMaxDurationMs", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchDown(2, 300, 200, 1050));

      expect(s2.phase).toBe("gesture");

      // First finger up (no movement)
      const [s3] = process(s2, touchUp(1, 100, 200, 1100));

      expect(s3.phase).toBe("gesture_ending");

      // Second finger up after 400ms (> 300ms undoMaxDurationMs)
      const [s4, events4] = process(s3, touchUp(2, 300, 200, 1400));

      expect(s4.phase).toBe("idle");
      expect(events4).toHaveLength(1);
      expect(events4[0].type).toBe("pinch-end");
    });
  });

  describe("cancel handling", () => {
    it("should emit draw-cancel from drawing on cancel", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchMove(1, 120, 200, 1050));

      expect(s2.phase).toBe("drawing");

      const [s3, events] = process(s2, touchCancel(1, 1100));

      expect(s3.phase).toBe("idle");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("draw-cancel");
    });

    it("should emit pinch-end from gesture on cancel", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchDown(2, 300, 200, 1050));

      expect(s2.phase).toBe("gesture");

      const [s3, events] = process(s2, touchCancel(1, 1100));

      expect(s3.phase).toBe("idle");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("pinch-end");
    });

    it("should emit pinch-end from gesture_ending on cancel", () => {
      const state = createGestureState();
      const [s1] = process(state, touchDown(1, 100, 200, 1000));
      const [s2] = process(s1, touchDown(2, 300, 200, 1050));
      const [s3] = process(s2, touchUp(1, 100, 200, 1100));

      expect(s3.phase).toBe("gesture_ending");

      const [s4, events] = process(s3, touchCancel(2, 1150));

      expect(s4.phase).toBe("idle");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("pinch-end");
    });
  });

  describe("idle ignores non-down events", () => {
    it("should return same state and no events on move", () => {
      const state = createGestureState();
      const [next, events] = process(state, touchMove(1, 100, 200, 1000));

      expect(next.phase).toBe("idle");
      expect(events).toHaveLength(0);
    });

    it("should return same state and no events on up", () => {
      const state = createGestureState();
      const [next, events] = process(state, touchUp(1, 100, 200, 1000));

      expect(next.phase).toBe("idle");
      expect(events).toHaveLength(0);
    });
  });
});
