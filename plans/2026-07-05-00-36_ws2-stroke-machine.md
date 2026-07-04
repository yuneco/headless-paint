# WS2 stroke-machine implementation plan

## Context

- User approved policy 1: `transitionStroke` returns `{ next, effects }`.
- `StrokePhase.active` includes `hasEmission: boolean`.
- Scope is limited to `packages/stroke/src/stroke-machine.ts`, its tests, and `index.ts` export.

## Phases

1. Confirm existing stroke-machine docs and gesture state-machine style.
2. Implement pure transition types and functions from the approved docs/spec.
3. Add exhaustive transition tests for idle and active variants.
4. Run build, root test, lint, then self-review against docs and existing package style.
