# Spray sizeJitterMode reduction plan

## Objective

Reduce `SpraySizeJitterMode` to `"lognormal" | "bimodal"` only. Remove `"uniform"` and `"power"` without migration, fallback, or compatibility behavior.

## Phase 1: API and docs

- Update the public `SpraySizeJitterMode` union in `packages/engine/src/types.ts`.
- Change spray defaults from `"uniform"` to `"bimodal"` in `DEFAULT_SPRAY_DYNAMICS` and `SPRAY_AIRBRUSH`.
- Update engine docs so the public API and samples mention only `"lognormal"` and `"bimodal"`.
- Keep the documented particle RNG consumption contract: `u`, `v`, `sizeU1`, `sizeU2`, `sizeU3`, `z`.

## Phase 2: Usage review

- `apps/web` debug control should expose only `"lognormal"` and `"bimodal"`.
- React persistence should accept only `"lognormal"` and `"bimodal"` for imported spray brushes.
- Unknown or removed values should reject the settings object instead of falling back.

## Phase 3: Implementation

- Remove `"uniform"` and `"power"` branches from spray particle size calculation.
- Do not change `sprayAt` RNG call count or order; always consume three size RNG values before opacity RNG.
- Update engine and react tests to remove `"uniform"` / `"power"` cases and assert rejection of unknown values.

## Phase 4: Review and verification

- Confirm implementation and docs match bidirectionally.
- Run `pnpm -r build && pnpm test && pnpm lint`.
- Do not commit.
- Do not edit generated `dist` or `.d.ts` files by hand.
