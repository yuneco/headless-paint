# Acrylic coalesced-pressure wave regression

## Evidence

- Apple Pencil production capture shows periodic apparent-width changes with `size=0.3`, `flow=0.4`, `sizeJitter=0`.
- A deterministic 300-point straight stroke with the same pressure series renders smooth on `main@47e6db4` but wavy on the integration branch.
- The integration result is unchanged after disabling mixing, causal input filtering, and effective-size spacing. Constant-pressure input is uniform.
- The remaining behavioral difference is high-frequency input: Production now consumes every `getCoalescedEvents()` sample, while main only consumed one representative point per pointer callback. Main therefore discarded most short-period pressure variation together with useful coordinates.

## Decision

Keep all normalized input samples. Pressure interpretation belongs to the brush engine, not the input adapter. Add optional causal pressure smoothing to stamp `PressureDynamics`:

```ts
interface PressureDynamics {
  readonly size: number;
  readonly flow: number;
  readonly smoothingMs?: number;
}
```

- omitted / non-positive: disabled, preserving every existing brush
- positive: causal exponential smoothing over emission timestamps before `size` and `flow` evaluation
- Acrylic preset: enable a modest smoothing duration; other presets remain disabled
- filtered pressure is branch render state so incremental, replay, Undo/Redo, and Expand use the same deterministic sequence
- spacing scheduling continues to use raw pressure in this first correction. It may place harmless extra dabs during a transition, but does not discard input or create a second scheduler path.

## Verification gate

1. Unit: disabled path is exact; enabled path attenuates short-period pressure changes; incremental and replay states/pixels agree.
2. Deterministic WebKit: main and Production straight-stroke width profiles are compared from the same recorded coordinate/pressure sequence.
3. Regression: constant-pressure width remains unchanged; mixing ON/OFF does not alter geometry.
4. Full `pnpm -r build`, `pnpm test`, and `pnpm lint`.

## Residual risk

- Causal smoothing necessarily delays very fast intentional pressure changes. Acrylic should use a short preset-specific value and requires final Apple Pencil sensory confirmation.
- This does not change the common temporal smoothing/pending policy. Rough bristle remains on its coverage-pressure model; pencil and pen retain raw pressure.

## Verification result (2026-08-24)

- Acrylic preset uses `smoothingMs: 50`.
- The React settings normalizer and persistence clone/parser retain the optional field. Missing old data keeps smoothing disabled; a negative/non-finite persisted value is rejected.
- Deterministic 300-point WebKit fixture, mixing OFF:
  - unsmoothed integration: width standard deviation `1.858 / 1.827 / 1.786px` at brightness thresholds `240 / 200 / 128`
  - main reference: `1.575 / 1.693 / 1.607px`
  - corrected integration: `1.100 / 1.010 / 0.999px`
- Mixing ON keeps the corrected geometry (`1.156 / 1.004 / 1.000px`), although the already-known long-stroke Acrylic mixing stall is a separate performance issue.
- Remaining gate: Apple Pencilで一定筆圧の直線と、意図的に筆圧を上下させる線を比較し、周期的な膨縮が消えつつ意図した太さ変化が鈍すぎないことを確認する。
