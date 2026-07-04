# WS2 task 2: stroke-runtime

## Phase 1/2 status

- API design is already approved in `packages/stroke/docs/stroke-machine.md`.
- Implement `createStrokeRuntime(deps)` as an imperative shell around `transitionStroke`.
- Keep task scope to runtime live drawing; do not touch replay/session/history/types/parity/command-executor/stroke-machine or engine/react.

## Phase 3 plan

1. Add `packages/stroke/src/stroke-runtime.ts`.
2. Interpret stroke-machine effects by updating private runtime cells and calling engine/input/session APIs.
3. Add deterministic runtime tests with injected clock/timer.
4. Export runtime API from `packages/stroke/src/index.ts`.
5. Run build, test, and lint.

## Notes

- `brushSeed` is generated from `deps.randomSeed?.()` when omitted, with a default implementation based on `Math.random`; runtime implementation should avoid direct `Math.random` usage outside that default dependency normalization.
- Emission timer uses `deps.now()` for synthetic point timestamps and re-enters `move()`.
- `samplingLayer` for mixing shares `committedSnapshot`.

## Result

- Added `stroke-runtime.ts` and deterministic runtime tests.
- Exported runtime API from `@headless-paint/stroke` and the aggregate core entry.
- Updated stroke docs for `randomSeed` and runtime API listing.
- Verification: `pnpm build`, `pnpm test`, and `pnpm lint` all passed. Test result kept 7 expected failures.
