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

## Verification result (2026-08-24, reopened)

- Acrylic preset uses `smoothingMs: 50`.
- The React settings normalizer and persistence clone/parser retain the optional field. Missing old data keeps smoothing disabled; a negative/non-finite persisted value is rejected.
- Deterministic 300-point WebKit fixture, mixing OFF:
  - unsmoothed integration: width standard deviation `1.858 / 1.827 / 1.786px` at brightness thresholds `240 / 200 / 128`
  - main reference: `1.575 / 1.693 / 1.607px`
  - corrected integration: `1.100 / 1.010 / 0.999px`
- Mixing ON keeps the corrected geometry (`1.156 / 1.004 / 1.000px`), although the already-known long-stroke Acrylic mixing stall is a separate performance issue.
- The deterministic fixture only proved that 50ms smoothing attenuates the synthetic pressure series. It did not reproduce the Apple Pencil failure strongly enough to establish its root cause.
- Apple Pencil sensory verification failed: the unwanted width oscillation remains. Therefore `smoothingMs: 50` is a candidate mitigation, not an accepted fix.
- The investigation is reopened. Production can capture the next accepted input stroke as replay JSON, including callback batch boundaries, the active brush config, and the input filter. The captured failing stroke must be replayed through geometry, pressure, and effective-size spacing variants before another correction is accepted.
- Do not close this regression from horizontal synthetic width statistics alone. The final gate is a fixed replay of an actual failing Apple Pencil stroke plus Apple Pencil confirmation.

## Root cause update (2026-08-25)

The captured failing Apple Pencil stroke changed the diagnosis. Safari repeatedly returned an overlapping `getCoalescedEvents()` group on consecutive `pointermove` callbacks. The accepted point sequence therefore contained patterns such as `37792, 37796, 37792, 37796`: geometry moved backwards to an already rendered point and then forwards again. The resulting contour wave is not primarily a pressure-response artifact.

Input sampling now rejects candidates whose timestamp is older than the last accepted sample, and rejects an identical point repeated at the same timestamp. Different coordinates sharing one timestamp remain valid for coarse-clock environments.

Deterministic WebKit reproduction, same 300-point stroke with every coalesced batch deliberately presented twice:

- before stale-sample rejection: `599` accepted points; width standard deviation `1.513 / 1.442 / 1.456px` at brightness thresholds `240 / 200 / 128`
- after stale-sample rejection: `300` accepted points; `1.156 / 1.004 / 1.000px`

This reproduces and removes the failure mechanism present in the production capture. `smoothingMs: 50` remains a separate candidate mitigation until the Apple Pencil gate determines whether it is still needed. Do not use pressure smoothing to hide replayed coordinate input.

Final gate remains an iPad refresh followed by the same fast straight-stroke check. A new capture must contain a monotonic accepted timestamp sequence without repeated coalesced groups, and the visual width wave must be absent before this regression is closed.
