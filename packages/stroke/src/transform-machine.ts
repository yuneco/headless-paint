import type { ContentBounds } from "@headless-paint/engine";

const IDENTITY_MATRIX: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export type TransformPixelSource = { readonly type: "layer" };

export type TransformPhase =
  | { readonly phase: "idle" }
  | {
      readonly phase: "active";
      readonly layerId: string;
      readonly source: TransformPixelSource;
      readonly bounds: ContentBounds;
      readonly matrix: readonly number[];
    };

export type TransformMachineEvent =
  | {
      readonly type: "begin";
      readonly layerId: string;
      readonly bounds: ContentBounds;
      readonly source?: TransformPixelSource;
    }
  | { readonly type: "set-matrix"; readonly matrix: ArrayLike<number> }
  | { readonly type: "commit" }
  | { readonly type: "cancel" };

export type TransformMachineEffect =
  | {
      readonly type: "bake-and-record";
      readonly layerId: string;
      readonly matrix: readonly number[];
    }
  | { readonly type: "session-ended" };

export interface TransformTransitionResult {
  readonly next: TransformPhase;
  readonly effects: readonly TransformMachineEffect[];
}

export function createInitialTransformPhase(): TransformPhase {
  return { phase: "idle" };
}

export function transitionTransform(
  state: TransformPhase,
  event: TransformMachineEvent,
): TransformTransitionResult {
  switch (state.phase) {
    case "idle":
      return handleIdle(state, event);
    case "active":
      return handleActive(state, event);
  }
}

function handleIdle(
  state: TransformPhase & { readonly phase: "idle" },
  event: TransformMachineEvent,
): TransformTransitionResult {
  if (event.type === "begin") {
    return {
      next: {
        phase: "active",
        layerId: event.layerId,
        source: event.source ?? { type: "layer" },
        bounds: { ...event.bounds },
        matrix: [...IDENTITY_MATRIX],
      },
      effects: [],
    };
  }

  return noOp(state);
}

function handleActive(
  state: TransformPhase & { readonly phase: "active" },
  event: TransformMachineEvent,
): TransformTransitionResult {
  switch (event.type) {
    case "begin":
      return noOp(state);
    case "set-matrix":
      return {
        next: {
          ...state,
          matrix: Array.from(event.matrix),
        },
        effects: [],
      };
    case "commit":
      return {
        next: { phase: "idle" },
        effects: [
          ...bakeAndRecordWhenChanged(state),
          { type: "session-ended" },
        ],
      };
    case "cancel":
      return {
        next: { phase: "idle" },
        effects: [{ type: "session-ended" }],
      };
  }
}

function bakeAndRecordWhenChanged(
  state: TransformPhase & { readonly phase: "active" },
): readonly TransformMachineEffect[] {
  if (isIdentityTransformMatrix(state.matrix)) return [];

  return [
    {
      type: "bake-and-record",
      layerId: state.layerId,
      matrix: [...state.matrix],
    },
  ];
}

function noOp(state: TransformPhase): TransformTransitionResult {
  return { next: state, effects: [] };
}

function isIdentityTransformMatrix(matrix: ArrayLike<number>): boolean {
  return IDENTITY_MATRIX.every((value, index) => matrix[index] === value);
}
