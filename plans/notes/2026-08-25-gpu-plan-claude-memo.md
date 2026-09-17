# Discussion memo: alternative speed-up approaches for Rough bristle / Acrylic

Context: plan at `plans/2026-08-25-00-29_brush-gpu-acceleration-investigation.md` proposes WebGL2-first GPU spikes.
User constraints for this discussion:
- Target is brush renderer speed itself. Undo/checkpoint strategy and "hide the latency" approaches are OUT of scope.
- Parameter/algorithm tweaks that keep quality are allowed candidates, but they need visual evaluation, so they rank below approaches whose effectiveness can be verified autonomously (parity tests + benchmarks).
- WebGPU is acceptable if the gain is large AND an unsupported environment falls back to the existing CPU route. Safari 26 ships WebGPU.
- Goal of plan revision: (1) add missing candidates, (2) restructure so that effectiveness can be isolated quickly and cheaply.

## Findings from code reading (Claude side)

### Rough bristle (mixing off default)
- NO getImageData on this path. Cost is pure CPU raster + Canvas2D command volume. Per chunk (~32ms flush):
  - `createBristleMaskField`: bands=max(30, ceil(size/0.82)) × samples(≈chunk px). 2–3 valueNoise2d per cell ≈ 24 hash calls/cell. ~470k hash ops/chunk at size 40 / 400px. Float32Array allocated per chunk, overlap region recomputed. (bristle-mask.ts:149-198)
  - `rasterizeTriangle` per segment ×2: per pixel bilinear field sample + activation + `hasSurfaceContact` (2 hash chains + 2 Math.exp) + `samplePressure` recomputed per pixel. Pixels visited ~2× due to overlap. (bristle-mask.ts:224-360)
  - `drawSweep`: setTransform + drawImage of a 2px-wide profile atlas per emission (geometryStepPx=1 → ~1 drawImage per px of arc). (bristle.ts:395-443)
  - 2 × new OffscreenCanvas + createImageData + putImageData + 2 full-bbox composites + 1 drawImage to layer, per chunk. (bristle.ts:343, bristle-mask.ts:73,84,145)
  - AABB bbox for diagonal chunks wastes area.
- Profile atlas is 2px wide: ink is effectively a 1D transverse profile. So ink alpha could be evaluated inside the same per-pixel raster loop (profile[v] × mask), eliminating N drawImage + 2 composites entirely — CPU or GPU.

### Acrylic (stamp + mixing)
- Only sync point: `getImageData` of the checkpoint tile (~133² at size 40) every 36px (mixing.ts:233). Material update every 15px is CPU-only on cached pixels.
- Per dab: save/translate/rotate/drawImage(renderCanvas) + updateMixingAfterDeposit. Material update: 2 × Float32Array(576) alloc, putImageData 18×8, 2 drawImage on tip, destination-in.
- Per stroke: full-document sampling layer copy (incremental-stroke.ts:256-268).
- Prior measurement: readback reduction already took p95 24→11ms; remaining max cost is the checkpoint tile readback.

## Candidate list (Claude proposal — please critique, add, reorder)

| ID | Candidate | Autonomously verifiable? | Expected gain | Cost |
|---|---|---|---|---|
| C1 | **Stage profiling harness first**: instrument bristle stages (field build / triangle raster / drawSweep / canvas alloc / composite) and acrylic stages (dab draw / material update / checkpoint readback) with performance.now() accumulators behind a debug flag; run on fixed fixture in WebKit+Chromium. | yes | 0 directly; decides everything else | small |
| C2 | **Null-stage upper-bound experiments**: replace a stage with a trivial stub (e.g. mask=all-1, field=constant, skip drawSweep) and measure. Gives max possible gain of GPU-izing that stage BEFORE writing any shader. | yes (perf only) | decision quality | tiny |
| C3 | **CPU micro-opts, byte-identical**: pool OffscreenCanvas/ImageData per brush state; hoist samplePressure; cache grain/field across overlap; avoid per-emission object alloc; reuse checkpoint ImageData buffer; drop per-dab mulberry32 closure; unroll diffusion. Verified by existing determinism/parity tests requiring identical output. | yes (byte-identical) | maybe 1.2–2× on CPU part | small |
| C4 | **Fold ink into mask raster** (1D profile lookup per pixel), remove drawSweep + source-in/destination-in. Not byte-identical (Canvas2D bilinear vs manual) → needs parity metric, but visually near-identical. | mostly (parity metric) | removes ~N drawImage/chunk | medium |
| C5 | **Field cost reduction**: precompute valueNoise per band-row into a per-stroke texture keyed by distance (field is a function of (distance, cross, seed)); or reduce hash count via tiled noise LUT. Deterministic, byte-identical achievable if same math order. | yes | field stage → near 0 | medium |
| C6 | **WASM SIMD port of bristle-mask** (Rust/AssemblyScript). Deterministic, CPU, works in Node/headless too (no fallback duality!). Float32 math order can be matched for byte identity or near. | yes | 3–6× on raster stage | medium-high (toolchain) |
| C7 | **WebGL2 mask+ink fragment shader** (plan E1) | partial (parity metric; GPU timing needs fence) | high on raster, unknown net due to drawImage(WebGL→2D) | high |
| C8 | **WebGPU variant** of C7 with fallback. Compute/storage textures make max-accumulate and stroke-resident state easier; no EXT_float_blend concerns. | same as C7 | ≥ C7 | high |
| C9 | **Acrylic: eliminate checkpoint getImageData** via CPU shadow of the stroke-local dirty tile (we know every deposit: it's drawImage of renderCanvas whose pixels are CPU-known). Complex only for blending semantics (source-over with alpha) — could be reimplemented in CPU. Byte-parity NOT achievable vs Canvas2D compositing; parity metric. | partial | removes the only sync | high |
| C10 | **Acrylic: coarser/async readback** — checkpoint less often relative to updates by making pickup sample from a stale tile plus CPU-shadowed recent deposits (hybrid of C9). | partial | reduces sync freq | medium |
| C11 | **Acrylic: GPU-resident stroke tile** (plan E3) in WebGPU (storage texture; 18×8 field in a buffer; pickup via texture sample; deposit via compute) | partial | high if residency holds | very high |
| C12 | **Parameter tuning** (geometryStepPx 1→adaptive, transverseMaskCellPx, bands min 30, updateDistance/checkpointDistance) | perf yes, quality needs eyes | 1.5–3× | tiny, but rank low per user |
| C13 | **Reduce per-chunk Canvas2D command count** even on CPU path: tighter OBB instead of AABB; skip composites when coloredProfile. | yes | small-medium | small |

## Proposed restructure of the execution flow
E0' = C1 + C2 (profiling + null-stage upper bounds) in both browsers. Output: a stage-time table per brush. Decision rules:
- If raster stage ≥ 60% of bristle chunk time → GPU/WASM candidates viable; else prioritise C3/C4/C13.
- Null-mask experiment result ≈ upper bound of C7/C8; if < 30% improvement, skip GPU for mask.
- For acrylic, if checkpoint readback ≥ 50% of p95 → C9/C10/C11; else CPU micro-opts.
E1' = C3 (+C13) since byte-identical and zero risk; ship regardless.
E2' = C4/C5 or C6 depending on E0' — CPU path improvements that also benefit Node/replay and don't create a backend split.
E3' = GPU (C7 vs C8 decided by a 1-day drawImage(GPU canvas→2D) transfer micro-benchmark on Safari — measure the bridge cost before any shader).
E4' = Acrylic per decision rule.

Questions for codex:
1. Which candidates are wrong/infeasible given the actual code? Any I missed (e.g. OffscreenCanvas in Worker, ImageBitmap paths, `createImageBitmap` async readback, Canvas2D filters, `globalCompositeOperation: "lighter"` tricks for max accumulate)?
2. Is C6 (WASM) realistic in this repo's toolchain (pnpm, vite, vitest browser mode, Biome)? Which language/toolchain would you pick?
3. Is the decision-rule structure sound? What thresholds would you use?
4. For GPU: WebGL2 first or WebGPU first, given Safari 26 has WebGPU and fallback to CPU exists anyway? What is the cheapest experiment to measure the WebGL/WebGPU→Canvas2D bridge cost in Safari?
5. Anything about the incremental/replay/Undo call structure that changes the ranking (e.g. replay feeds points one-by-one, per-command sampling-layer copy)?
