# Brush stall recording plan

## Constraints

- Work on `experiment/brush-acceleration`; do not commit.
- Do not edit `packages/*/docs` or `work.local/`.
- Keep public exports and persisted schemas unchanged.
- Preserve behavior when `gpuDab: "off"`.

## Phase 1: internal API design

- Extend the existing private `brushPerfDebug` object with batch lifecycle and event recording.
- A batch captures elapsed time, point/branch counts, selected stage deltas, GPU residency/reallocation/commit details, timestamp, and prior-batch gap.
- Keep only batches over `experiments.stallThresholdMs` (default 60 ms), plus stroke-start batches that reallocate a surface/texture; cap the ring buffer at 32.
- No package documentation change: the user explicitly forbids `packages/*/docs` edits and no public API changes.

## Phase 2: usage review

- `stroke-runtime.moveMany()` brackets its existing `moveMany` timing with `beginBatch()` / `endBatch()`.
- GPU internals report events while a batch is active.
- The existing Material brush evaluation panel reads `snapshot().stalls`, renders one compact summary per record only under `perfDebug=1`, and copies the JSON snapshot using the existing clipboard pattern.
- The requested UI example and copy behavior are treated as the approved usage image supplied by the user.

## Phase 3: implementation and tests

- Implement batch/event aggregation and reset/snapshot behavior.
- Instrument GPU residency, texture reallocations, and commit passes/pixels.
- Add the Stalls panel and clipboard action.
- Add non-browser tests for threshold filtering and the 32-entry cap.
- Run targeted tests, then `pnpm -r build`, `pnpm lint`, and `pnpm test -- --run`.

## Phase 4: architect/self-review

- Review changed files against requirements, existing perf-debug patterns, functional/readonly conventions, and docs/API boundaries.
- Confirm no prohibited paths, public exports, or persisted schemas changed, and report all reallocation trigger sites.
