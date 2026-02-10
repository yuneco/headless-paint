import { screenToLayer } from "./coordinate";
import { computeSimilarityTransform } from "./transform";
import type {
  GestureConfig,
  GestureEvent,
  GesturePointerEvent,
  GestureState,
  Point,
  ViewTransform,
} from "./types";

/**
 * デフォルトのジェスチャー設定
 */
export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  graceWindowMs: 150,
  confirmDistancePx: 10,
  undoMaxMovePx: 20,
  undoMaxDurationMs: 300,
};

/**
 * ジェスチャー状態の初期値を作成
 */
export function createGestureState(): GestureState {
  return { phase: "idle" };
}

/**
 * ポインターイベントを処理し、状態遷移と出力イベントを返す。
 * 純粋関数。同じ入力に対して常に同じ出力を返す。
 */
export function processGestureEvent(
  state: GestureState,
  event: GesturePointerEvent,
  config: GestureConfig,
  currentTransform: ViewTransform,
): [GestureState, readonly GestureEvent[]] {
  switch (state.phase) {
    case "idle":
      return handleIdle(state, event);
    case "single_down":
      return handleSingleDown(state, event, config, currentTransform);
    case "drawing":
      return handleDrawing(state, event, config, currentTransform);
    case "gesture":
      return handleGesture(state, event);
    case "gesture_ending":
      return handleGestureEnding(state, event, config);
  }
}

// ------------------------------------------------------------
// Phase handlers
// ------------------------------------------------------------

function handleIdle(
  state: GestureState & { readonly phase: "idle" },
  event: GesturePointerEvent,
): [GestureState, readonly GestureEvent[]] {
  if (event.eventType === "down") {
    return [
      {
        phase: "single_down",
        primaryPointerId: event.pointerId,
        downTimestamp: event.timestamp,
        downPos: { x: event.x, y: event.y },
        lastPos: { x: event.x, y: event.y },
      },
      [{ type: "draw-start", point: event }],
    ];
  }
  return [state, []];
}

function handleSingleDown(
  state: GestureState & { readonly phase: "single_down" },
  event: GesturePointerEvent,
  config: GestureConfig,
  currentTransform: ViewTransform,
): [GestureState, readonly GestureEvent[]] {
  // 2nd finger down within grace window → gesture
  if (
    event.eventType === "down" &&
    event.pointerId !== state.primaryPointerId
  ) {
    const elapsed = event.timestamp - state.downTimestamp;
    if (elapsed <= config.graceWindowMs) {
      return transitionToGesture(
        state.primaryPointerId,
        event.pointerId,
        state.lastPos,
        { x: event.x, y: event.y },
        event.timestamp,
        currentTransform,
      );
    }
    // Outside grace window → ignore
    return [state, []];
  }

  // Primary pointer move
  if (
    event.eventType === "move" &&
    event.pointerId === state.primaryPointerId
  ) {
    const dx = event.x - state.downPos.x;
    const dy = event.y - state.downPos.y;
    const distSq = dx * dx + dy * dy;
    const thresholdSq = config.confirmDistancePx * config.confirmDistancePx;

    if (distSq >= thresholdSq) {
      // Transition to drawing
      return [
        {
          phase: "drawing",
          primaryPointerId: state.primaryPointerId,
          downTimestamp: state.downTimestamp,
        },
        [{ type: "draw-confirm" }, { type: "draw-move", point: event }],
      ];
    }
    // Stay single_down, update lastPos
    return [
      {
        ...state,
        lastPos: { x: event.x, y: event.y },
      },
      [{ type: "draw-move", point: event }],
    ];
  }

  // Primary pointer up → draw-end
  if (event.eventType === "up" && event.pointerId === state.primaryPointerId) {
    return [{ phase: "idle" }, [{ type: "draw-end" }]];
  }

  // Cancel → draw-cancel
  if (event.eventType === "cancel") {
    return [{ phase: "idle" }, [{ type: "draw-cancel" }]];
  }

  return [state, []];
}

function handleDrawing(
  state: GestureState & { readonly phase: "drawing" },
  event: GesturePointerEvent,
  config: GestureConfig,
  currentTransform: ViewTransform,
): [GestureState, readonly GestureEvent[]] {
  // 2nd finger down → check grace window
  if (
    event.eventType === "down" &&
    event.pointerId !== state.primaryPointerId
  ) {
    const elapsed = event.timestamp - state.downTimestamp;
    if (elapsed <= config.graceWindowMs) {
      // drawing state does not track the primary pointer's screen position.
      // Use the 2nd finger's position as surrogate for both anchors.
      // computeSimilarityTransform returns null for coincident layer points,
      // so currentTransform is used as fallback — correct initial behavior
      // until the next move event provides distinct positions.
      return transitionToGesture(
        state.primaryPointerId,
        event.pointerId,
        { x: event.x, y: event.y }, // surrogate for primary's last screen pos
        { x: event.x, y: event.y },
        state.downTimestamp,
        currentTransform,
      );
    }
    // Outside grace window → ignore
    return [state, []];
  }

  // Primary pointer move → draw-move
  if (
    event.eventType === "move" &&
    event.pointerId === state.primaryPointerId
  ) {
    return [state, [{ type: "draw-move", point: event }]];
  }

  // Primary pointer up → draw-end
  if (event.eventType === "up" && event.pointerId === state.primaryPointerId) {
    return [{ phase: "idle" }, [{ type: "draw-end" }]];
  }

  // Cancel → draw-cancel
  if (event.eventType === "cancel") {
    return [{ phase: "idle" }, [{ type: "draw-cancel" }]];
  }

  return [state, []];
}

function handleGesture(
  state: GestureState & { readonly phase: "gesture" },
  event: GesturePointerEvent,
): [GestureState, readonly GestureEvent[]] {
  // Move → update corresponding pointer, compute new transform
  if (event.eventType === "move") {
    const isPrimary = event.pointerId === state.primaryPointerId;
    const isSecondary = event.pointerId === state.secondaryPointerId;

    if (!isPrimary && !isSecondary) return [state, []];

    const newScreenP1: Point = isPrimary
      ? { x: event.x, y: event.y }
      : state.lastScreenP1;
    const newScreenP2: Point = isSecondary
      ? { x: event.x, y: event.y }
      : state.lastScreenP2;

    const transform = computeSimilarityTransform(
      state.layerP1,
      state.layerP2,
      newScreenP1,
      newScreenP2,
    );

    const newState: GestureState = {
      ...state,
      lastScreenP1: newScreenP1,
      lastScreenP2: newScreenP2,
      gestureMoved: true,
    };

    if (transform) {
      return [newState, [{ type: "pinch-move", transform }]];
    }
    // computeSimilarityTransform returned null → use previous transform
    // Recompute from previous screen positions as fallback
    const fallback = computeSimilarityTransform(
      state.layerP1,
      state.layerP2,
      state.lastScreenP1,
      state.lastScreenP2,
    );
    if (fallback) {
      return [newState, [{ type: "pinch-move", transform: fallback }]];
    }
    // Both null (degenerate) → no event
    return [newState, []];
  }

  // One finger up → gesture_ending
  if (event.eventType === "up") {
    const isPrimary = event.pointerId === state.primaryPointerId;
    const isSecondary = event.pointerId === state.secondaryPointerId;

    if (!isPrimary && !isSecondary) return [state, []];

    const remainingPointerId = isPrimary
      ? state.secondaryPointerId
      : state.primaryPointerId;

    return [
      {
        phase: "gesture_ending",
        remainingPointerId,
        layerP1: state.layerP1,
        layerP2: state.layerP2,
        lastScreenP1: state.lastScreenP1,
        lastScreenP2: state.lastScreenP2,
        downTimestamp: state.downTimestamp,
        gestureMoved: state.gestureMoved,
      },
      [],
    ];
  }

  // Cancel → idle + pinch-end
  if (event.eventType === "cancel") {
    return [{ phase: "idle" }, [{ type: "pinch-end" }]];
  }

  return [state, []];
}

function handleGestureEnding(
  state: GestureState & { readonly phase: "gesture_ending" },
  event: GesturePointerEvent,
  config: GestureConfig,
): [GestureState, readonly GestureEvent[]] {
  // Remaining finger up → idle
  if (
    event.eventType === "up" &&
    event.pointerId === state.remainingPointerId
  ) {
    const duration = event.timestamp - state.downTimestamp;
    if (!state.gestureMoved && duration < config.undoMaxDurationMs) {
      return [{ phase: "idle" }, [{ type: "undo" }]];
    }
    return [{ phase: "idle" }, [{ type: "pinch-end" }]];
  }

  // Cancel → idle + pinch-end
  if (event.eventType === "cancel") {
    return [{ phase: "idle" }, [{ type: "pinch-end" }]];
  }

  return [state, []];
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * single_down / drawing → gesture への遷移を共通化
 */
function transitionToGesture(
  primaryPointerId: number,
  secondaryPointerId: number,
  screenP1: Point,
  screenP2: Point,
  downTimestamp: number,
  currentTransform: ViewTransform,
): [GestureState, readonly GestureEvent[]] {
  // Convert screen positions to layer space for anchors
  const layerP1 = screenToLayer(screenP1, currentTransform) ?? screenP1;
  const layerP2 = screenToLayer(screenP2, currentTransform) ?? screenP2;

  // Compute initial transform from the anchor points
  const transform =
    computeSimilarityTransform(layerP1, layerP2, screenP1, screenP2) ??
    currentTransform;

  return [
    {
      phase: "gesture",
      primaryPointerId,
      secondaryPointerId,
      layerP1,
      layerP2,
      lastScreenP1: screenP1,
      lastScreenP2: screenP2,
      downTimestamp,
      gestureMoved: false,
    },
    [{ type: "draw-cancel" }, { type: "pinch-start", transform }],
  ];
}
