export type StrokePhase =
  | { readonly phase: "idle" }
  | {
      readonly phase: "active";
      readonly layerId: string;
      readonly pendingOnly: boolean;
      readonly hasEmission: boolean;
      readonly pointCount: number;
    };

export type StrokeMachineEvent =
  | {
      readonly type: "start";
      readonly layerId: string;
      readonly pendingOnly: boolean;
      readonly hasEmission: boolean;
    }
  | { readonly type: "move" }
  | { readonly type: "confirm" }
  | { readonly type: "end" }
  | { readonly type: "cancel" }
  | { readonly type: "dispose" };

export type StrokeMachineEffect =
  | { readonly type: "snapshot-layer" }
  | { readonly type: "append-committed" }
  | { readonly type: "render-pending" }
  | { readonly type: "schedule-emission" }
  | { readonly type: "cancel-emission" }
  | { readonly type: "schedule-render" }
  | { readonly type: "finalize-commit" }
  | { readonly type: "restore-snapshot" }
  | { readonly type: "drawing-changed"; readonly isDrawing: boolean };

export interface StrokeTransitionResult {
  readonly next: StrokePhase;
  readonly effects: readonly StrokeMachineEffect[];
}

export function createInitialStrokePhase(): StrokePhase {
  return { phase: "idle" };
}

export function transitionStroke(
  state: StrokePhase,
  event: StrokeMachineEvent,
): StrokeTransitionResult {
  switch (state.phase) {
    case "idle":
      return handleIdle(state, event);
    case "active":
      return handleActive(state, event);
  }
}

function handleIdle(
  state: StrokePhase & { readonly phase: "idle" },
  event: StrokeMachineEvent,
): StrokeTransitionResult {
  if (event.type === "start") {
    return transitionToActive(event);
  }

  return noOp(state);
}

function handleActive(
  state: StrokePhase & { readonly phase: "active" },
  event: StrokeMachineEvent,
): StrokeTransitionResult {
  switch (event.type) {
    case "start": {
      const started = transitionToActive(event);
      return {
        next: started.next,
        effects: [
          { type: "cancel-emission" },
          { type: "restore-snapshot" },
          ...started.effects,
        ],
      };
    }
    case "move":
      return {
        next: {
          ...state,
          pointCount: state.pointCount + 1,
        },
        effects: [
          ...appendCommittedWhenConfirmed(state.pendingOnly),
          { type: "render-pending" },
          { type: "schedule-render" },
          ...scheduleEmissionWhenEnabled(state.hasEmission),
        ],
      };
    case "confirm":
      if (!state.pendingOnly) {
        return noOp(state);
      }

      return {
        next: {
          ...state,
          pendingOnly: false,
        },
        effects: [{ type: "snapshot-layer" }, { type: "append-committed" }],
      };
    case "end":
      return {
        next: { phase: "idle" },
        effects: [
          { type: "cancel-emission" },
          { type: "finalize-commit" },
          { type: "drawing-changed", isDrawing: false },
        ],
      };
    case "cancel":
      return {
        next: { phase: "idle" },
        effects: [
          { type: "cancel-emission" },
          { type: "restore-snapshot" },
          { type: "drawing-changed", isDrawing: false },
        ],
      };
    case "dispose":
      return {
        next: { phase: "idle" },
        effects: [
          { type: "cancel-emission" },
          { type: "drawing-changed", isDrawing: false },
        ],
      };
  }
}

function transitionToActive(
  event: StrokeMachineEvent & { readonly type: "start" },
): StrokeTransitionResult {
  return {
    next: {
      phase: "active",
      layerId: event.layerId,
      pendingOnly: event.pendingOnly,
      hasEmission: event.hasEmission,
      pointCount: 1,
    },
    effects: [
      { type: "snapshot-layer" },
      ...appendCommittedWhenConfirmed(event.pendingOnly),
      { type: "render-pending" },
      { type: "drawing-changed", isDrawing: true },
      ...scheduleEmissionWhenEnabled(event.hasEmission),
    ],
  };
}

function appendCommittedWhenConfirmed(
  pendingOnly: boolean,
): readonly StrokeMachineEffect[] {
  return pendingOnly ? [] : [{ type: "append-committed" }];
}

function scheduleEmissionWhenEnabled(
  hasEmission: boolean,
): readonly StrokeMachineEffect[] {
  return hasEmission ? [{ type: "schedule-emission" }] : [];
}

function noOp(state: StrokePhase): StrokeTransitionResult {
  return { next: state, effects: [] };
}
