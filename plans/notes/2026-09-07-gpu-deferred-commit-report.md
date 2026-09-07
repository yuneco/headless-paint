# GPU deferred commit 実装・検収引き継ぎ

ブランチ: `experiment/gpu-commit-cadence`。コミットなし。`packages/*/docs` と既存テストは変更なし。

## 設計確認

- commit canvas は `gl-resources.ts` が確保する 1024² default framebuffer。通常の dab / field / bristle 描画は別 framebuffer に向く。default framebuffer を上書きする commit blit に入る前に pending を drain する。
- 1 pass の bitmap commit のみ遅延可能。`packCommitRound` の最初の packed 数が全 tiles 数と等しくない場合、全 pass を従来の同期経路で完了する。direct mode も同期。
- `fenceSync(SYNC_GPU_COMMANDS_COMPLETE, 0)` の後に `flush()` して fence も submit。`clientWaitSync(fence, 0, 0)` の ALREADY_SIGNALED / CONDITION_SATISFIED のみ転写、TIMEOUT_EXPIRED は false、WAIT_FAILED は同期 drain。fence allocation が null の場合も同期転写。
- 転写後に `deleteSync`。context lost 時は転写せず pending と fence を破棄する（lost context で finish はしない）。

仕様確認資料: [WebGL clientWaitSync](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/clientWaitSync)。

## 内部 IF の調整

既存 `per-flush-checkpoint-verification.test.ts` 等は `surface.commitToLayer(layer)` 直後に layer の画素を読む。既存テスト無変更・公開 API 変更なしを守るため、surface / accelerator の内部 `commitToLayer` に `defer = false` と pending を示す boolean 戻り値を追加した。runtime が所有する live perFlush だけ `defer: true` を渡す。

renderer 内部 config の `onGpuCommitPending(poll, drain)` を stroke runtime が注入する。callback のない standalone renderer と `gpuCommitCadence: "final"`、finalize は同期のまま。公開の `IncrementalStrokeRenderer` / `StrokeRuntimeDeps` / `BrushAccelerator` は変更なし。追加した `pollPendingCommit(owner)` / `drainPendingCommit(owner)` は accelerator の内部 bridge のみ。owner 不一致・surface なしでは poll=true / drain=no-op。

**Claude による docs の補足候補（今回は変更禁止）**: GPU docs の bitmap 非同期化の説明に「runtime が遅延指定した単一 pass」「低レベル既定・複数 pass・final は同期」を補足する余地あり。「context lost でも drain」の記載は今回の明示指示どおり破棄にした。また、8 回の setTimeout(0) は timer clamp / event loop 混雑により数 ms より長くなり得るため、「表示は最大でも数 ms」は厳密な時間保証にはならない。

## pending の状態遷移

1. live perFlush commit → 既存 pending を同期 drain → dirty tiles を blit → fence を submit → pending 1 件（options 内に layer / canvas / mode / source framebuffer、packed tiles、fence）を保持 → 即 return。
2. runtime が `deps.setTimeout(tick, 0)`。未完は再スケジュール、完了なら transferToImageBitmap → drawCommitTiles → bitmap close → deleteSync → pending なし → requestRender。
3. 8 回未完なら `drainPendingCommit(owner)` → finish → 転写 → deleteSync → requestRender。
4. 次 commit / endStroke / cancelStroke / restoreUndoToLayer / dispose でも同期 drain。cancel は古い pending を消費した後、base を accum に戻し同期転写する。cancel 後に古い pending が再転写されることはない。
5. context lost は pending を破棄。既存の stroke loss 検出・finalize 時 CPU recovery の契約を維持。
6. end / cancel / dispose / 新 stroke / pending 置換で timer を clear し、世代番号を更新。古い callback を手動実行されても処理しない。

## 計測

blit フェーズと遅延転写フェーズの実処理時間を同じ `gpuCommit` stage に加算（待機中の wall time は含めない）。同期 commit は従来どおり 1 stage、遅延 commit は blit と転写の 2 stage 記録になる。`bitmapMs` / `drawMs` の event は転写時に記録。`gpuCommitPolls` sample は pending を完了・drain・破棄した際に実際の poll 回数を 1 sample 記録（poll 前 drain は 0）。

## 変更ファイル

- `packages/engine/src/brush/gpu/commit-packing.ts`: blit / 転写分離、単一 pass の fence、既存 fallback の共有。
- `packages/engine/src/brush/gpu/gpu-stroke-surface.ts`: pending 1 件・poll / drain・lifecycle。
- `packages/engine/src/brush/gpu/accelerator.ts`: owner を検証する内部 bridge。
- `packages/engine/src/brush/perf-debug.ts`: gpuCommitPolls の宣言・初期化・snapshot。
- `packages/stroke/src/incremental-stroke.ts`: perFlush の遅延指定と内部 callback。
- `packages/stroke/src/stroke-runtime.ts`: 0 ms timer、8 回上限、停止・世代管理。
- `packages/engine/src/brush/gpu/deferred-commit.test.ts`: GL fake の非ブラウザ15件。
- `packages/engine/src/brush/gpu/accelerator-pending-commit.test.ts`: owner / surface なしの非ブラウザ1件。
- `packages/stroke/src/stroke-runtime-gpu-commit.test.ts`: 実 renderer と描画 stub・捕捉 timer の非ブラウザ8件。
- `packages/engine/src/brush/gpu/deferred-commit.browser.test.ts`: 実 GPU byte 比較7件。
- 本報告、計画の実装調整追記、`plans/agents-note.md`。

## 実行結果

- `pnpm -r build`: 成功。
- `pnpm lint`: 成功。
- `pnpm run typecheck`: 成功。
- `pnpm exec vitest run --browser.enabled=false packages/engine packages/stroke`（JSON reporter で記録）: 576 件中 279 成功、297 環境依存失敗。OffscreenCanvas 未定義・WebGL2 unavailable・その結果の null / 例外不一致のみ。ブラウザ依存テストも include されるためコマンド全体は exit 1。
- 上記から完全にブラウザ非依存な 20 ファイルを明示した vitest: **244 件全件成功**。追加の非ブラウザ24件を含む。部分的に browser 依存するファイルで成功した35件はこの244件には含まない。
- 実ブラウザ検収・Mac WebKit probe6 の moveMany −20% 以上・WebKit 同一入力複数 run の byte 比較は未実施（依頼どおり Claude 担当）。採用可否の判断は保留。

## セルフレビュー

`planning-flow` / `review-library-usage` に沿い、GPU docs、stroke-machine、engine / input / stroke README と既存 bridge / commit call sites を照合。既存の packing / draw / fallback / perf API を再利用し、engine に timer を追加せず stroke runtime が timer を所有。docs の補足候補は上記に記録し、指定どおり docs 自体は未変更。既存の決定性・parity・undo-1・per-flush checkpoint テストは無変更だが、ブラウザ green は未検収。

## 追加テスト名

### packages/stroke/src/stroke-runtime-gpu-commit.test.ts
- stroke runtime deferred GPU commit polling (no browser) reschedules TIMEOUT then requests a render when transfer completes
- stroke runtime deferred GPU commit polling (no browser) drains after eight unsuccessful polls and stops scheduling
- stroke runtime deferred GPU commit polling (no browser) end invalidates captured timer callbacks
- stroke runtime deferred GPU commit polling (no browser) cancel invalidates captured timer callbacks
- stroke runtime deferred GPU commit polling (no browser) dispose invalidates captured timer callbacks
- stroke runtime deferred GPU commit polling (no browser) a replacement flush cancels the old timer and resets its poll budget
- stroke runtime deferred GPU commit polling (no browser) zero-returning inert timers still allow synchronous finalization
- stroke runtime deferred GPU commit polling (no browser) final cadence does not defer or schedule polling even with the callback installed

### packages/engine/src/brush/gpu/accelerator-pending-commit.test.ts
- accelerator pending commit owner isolation (no browser) only the active owner can poll or drain; missing surfaces report completion

### packages/engine/src/brush/gpu/deferred-commit.browser.test.ts
- deferred bitmap commit pixel contract pending → endStroke is byte-identical to synchronous bitmap commit
- deferred bitmap commit pixel contract pending → drainPendingCommit is byte-identical to synchronous bitmap commit
- deferred bitmap commit pixel contract pending → dispose is byte-identical to synchronous bitmap commit
- deferred bitmap commit pixel contract poll completion (or bounded drain) is byte-identical to synchronous commit
- deferred bitmap commit pixel contract next flush drains the old canvas and preserves both commits byte-for-byte
- deferred bitmap commit pixel contract cancel clears pending and restores the pre-stroke bytes including uncommitted dabs
- deferred bitmap commit pixel contract retained undo after draining pending restores the pre-stroke bytes synchronously

### packages/engine/src/brush/gpu/deferred-commit.test.ts
- deferred GPU commit lifecycle (no browser) transfers only after signaled status 37146 and deletes the fence afterwards
- deferred GPU commit lifecycle (no browser) transfers only after signaled status 37148 and deletes the fence afterwards
- deferred GPU commit lifecycle (no browser) drains WAIT_FAILED instead of treating it as completion
- deferred GPU commit lifecycle (no browser) drains the previous canvas before the next commit clears it
- deferred GPU commit lifecycle (no browser) endStroke drains a pending commit once
- deferred GPU commit lifecycle (no browser) dispose drains a pending commit once
- deferred GPU commit lifecycle (no browser) drainPendingCommit drains a pending commit once
- deferred GPU commit lifecycle (no browser) cancel drains before restoring base and leaves no stale pending transfer
- deferred GPU commit lifecycle (no browser) context loss discards the fence without transferring
- deferred GPU commit lifecycle (no browser) multi-pass commits finish and transfer every pass without a fence
- deferred GPU commit lifecycle (no browser) direct commits remain synchronous
- deferred GPU commit lifecycle (no browser) a failed fence allocation falls back to synchronous transfer
- deferred GPU commit lifecycle (no browser) deferred transfer failure uses the existing direct fallback
- deferred GPU commit lifecycle (no browser) deferred size failure uses the existing direct fallback
- deferred GPU commit lifecycle (no browser) deferred draw failure uses the existing direct fallback

## 実ブラウザ未検収の全テスト名（Node 実行で環境依存失敗）

### packages/engine/src/content-bounds.test.ts
- getContentBounds should return null for an empty layer
- getContentBounds should return bounds for a single pixel
- getContentBounds should return bounds for pixel at top-left corner
- getContentBounds should return bounds for pixel at bottom-right corner
- getContentBounds should return full bounds for fully filled layer
- getContentBounds should return tight bounds for multiple pixels
- getContentBounds should detect pixels with any non-zero RGBA component
- getContentBounds should handle a horizontal line of pixels
- getContentBounds should handle a vertical line of pixels

### packages/engine/src/draw.test.ts
- drawLine should draw something on the layer
- drawLine should draw a horizontal line
- drawLine should draw a vertical line
- drawLine should respect lineWidth parameter
- drawCircle should draw a filled circle
- drawCircle should draw at center
- drawCircle larger radius should fill more pixels
- drawPath should draw nothing for empty points
- drawPath should draw a path through points

### packages/engine/src/incremental-render.test.ts
- appendToCommittedLayer should not modify layer when points are empty
- appendToCommittedLayer should draw path on layer
- appendToCommittedLayer should preserve existing drawing (append mode)
- appendToCommittedLayer should draw with overlapCount > 0 (bridge segment)
- appendToCommittedLayer overlapCount=0 should behave identically to no overlapCount
- appendToCommittedLayer should constrain normal drawing to existing alpha when alpha locked
- appendToCommittedLayer should erase normally when alpha locked
- renderPendingLayer should clear and redraw
- renderPendingLayer should clear layer when points are empty
- renderPendingLayer mixing有効時はpendingを描かず既存previewもclearする
- renderPendingLayer bristleはmixing設定に関係なくpendingを描かない
- composeLayers should compose visible layers
- composeLayers should skip invisible layers
- composeLayers should apply view transform
- composeLayers should apply pendingOverlay with pre-composite for opacity < 1
- composeLayers should apply pendingOverlay with eraser (destination-out)
- composeLayers should mask pendingOverlay with committed alpha when alpha locked
- composeLayers should skip pre-composite when all settings are normal
- composeLayers should apply blend mode with pre-composite
- composeLayers renderLayers should mask pendingOverlay with committed alpha when alpha locked

### packages/engine/src/layer-collection.test.ts
- addLayer should add layer at the end by default
- addLayer should insert at specified index
- addLayer should return new array without mutating original
- removeLayer should remove layer by ID
- removeLayer should return original array if ID not found
- findLayerById should find layer by ID
- findLayerById should return undefined for nonexistent ID
- getLayerIndex should return correct index
- getLayerIndex should return -1 for nonexistent ID
- moveLayer should move layer from one position to another
- moveLayer should return same array if fromIndex equals toIndex
- moveLayer should return same array for out-of-bounds indices
- moveLayer should preserve relative order of other elements
- updateLayerMeta should update specified fields only
- updateLayerMeta should return new array (immutable)

### packages/engine/src/layer-merge.test.ts
- mergeLayerDown should burn source into target and normalize target meta
- mergeLayerDown should apply opacity while burning hidden source pixels

### packages/engine/src/layer.test.ts
- createLayer should create a layer with correct dimensions
- createLayer should have default meta values
- createLayer should accept custom meta values
- createLayer should have canvas and ctx
- getPixel / setPixel should initialize pixels to transparent
- getPixel / setPixel should set and get pixel correctly
- getPixel / setPixel should return transparent black for out-of-bounds getPixel
- getPixel / setPixel should ignore out-of-bounds setPixel
- getImageData should return correct ImageData
- clearLayer should clear all pixels
- cloneLayer / copyLayerPixels should copy pixels and meta with overrides
- cloneLayer / copyLayerPixels should clear target before copying pixels

### packages/engine/src/pattern-preview.test.ts
- createPatternTile should return null when mode is none
- createPatternTile should return null when no visible layers
- createPatternTile should include background color when background is provided
- createPatternTile should not include background when background.visible is false
- createPatternTile should apply compositeOperation when compositing layers
- createPatternTile should produce different results with vs without background for blend modes
- createPatternTile should apply layer opacity in tile
- renderPatternPreview should render repeated tiles only outside the original layer area
- renderPatternPreview should keep offset grid rows visible outside the clipped layer area

### packages/engine/src/transform-layer.test.ts
- transformLayer should be no-op with identity matrix
- transformLayer should translate pixel by (dx, dy)
- transformLayer should clip content that moves outside layer bounds
- transformLayer should scale layer content
- transformLayer should reuse provided temp canvas
- transformLayer should resize temp canvas if size does not match
- transformLayer should handle multiple pixels translation

### packages/engine/src/wrap-shift.test.ts
- wrapShiftLayer should be no-op when dx and dy are zero
- wrapShiftLayer should be no-op when shift is a multiple of layer size
- wrapShiftLayer should shift pixel right by dx
- wrapShiftLayer should shift pixel down by dy
- wrapShiftLayer should wrap pixel around horizontally
- wrapShiftLayer should wrap pixel around vertically
- wrapShiftLayer should handle negative shifts
- wrapShiftLayer should be reversible: shift(+dx) then shift(-dx) = identity
- wrapShiftLayer should support cumulative shifts
- wrapShiftLayer should reuse provided temp canvas
- wrapShiftLayer should resize temp canvas if size does not match

### packages/stroke/src/command-executor.test.ts
- command executor undoes wrap-shift by shifting every layer in the opposite direction
- command executor redoes wrap-shift by shifting every layer in the recorded direction
- command executor rebuilds affected layers for a normal draw undo and returns visibility fixes
- command executor interrupts a normal draw redo when rebuild fails
- command executor undoes add-layer with a remove list op and nearest active hint
- command executor redoes add-layer by recreating the recorded layer id and inserting it
- command executor undoes remove-layer by recreating, rebuilding, inserting, and activating the removed layer
- command executor interrupts remove-layer undo when the removed layer lacks a checkpoint
- command executor redoes remove-layer with a remove list op and nearest active hint
- command executor undoes duplicate-layer by removing the duplicate and activating the source
- command executor redoes duplicate-layer by applying the command and returning a replace list op
- command executor interrupts duplicate-layer redo when the recorded command cannot be applied
- command executor undoes merge-layer-down by recreating the source, restoring target meta, rebuilding both, and inserting source
- command executor redoes merge-layer-down by applying the command and returning a replace list op
- command executor interrupts merge-layer-down redo when the recorded topology does not match

### packages/stroke/src/gpu-residency.test.ts
- GPU layer residency 筆圧で stampSize が変化しても snapshot array を stroke 中に再確保しない
- GPU layer residency 連続する2本目のGPU strokeでuploadを省略し、毎回uploadとpixel一致する
- GPU layer residency residency hit の通常 stroke は layer pixel を読み出さない
- GPU layer residency radial 4 Expand と併用して連続する2本目が residency hit する
- GPU layer residency 間のCPU strokeで無効化し、次のGPU strokeを再uploadしてpixel一致する
- GPU layer residency GPU stroke x3 のUndo rebuild後は次のGPU strokeがhitし、常駐無効時とbyte一致する
- GPU layer residency 通常 GPU stroke の cancel は history 復元せず byte 一致し次 stroke も residency hit する
- GPU layer residency radial 4 Expand GPU stroke の cancel は history 復元せず byte 一致し次 stroke も residency hit する
- GPU layer residency React Undoボタン順序のcancel→restore→undo→遅延end後もownerを残さず次がhitする
- GPU layer residency strokeStart stallに直前のresidency invalidation reasonを含める
- GPU layer residency stale owner回復eventに開始経路・開始時刻・回復経路を含める
- GPU layer residency GPU→CPU strokeのUndoでcheckpoint復元後のGPU replayを常駐維持する
- GPU layer residency CPU→GPU strokeのUndoでCPU replayが最後なら次のGPU strokeはmissする
- GPU layer residency 4本のAcrylic hatchをUndo→RedoしてもUndoなしのlayerとbyte一致する
- GPU layer residency dirty rectが1024²を超える単一Acrylic strokeのRedoを複数passでbyte一致commitする

### packages/stroke/src/parity.test.ts
- live-vs-replay parity round-pen basic: live vs replay
- live-vs-replay parity round-pen basic: undo rebuild matches pre-stroke pixels
- live-vs-replay parity round-pen basic: redo rebuild matches replay
- live-vs-replay parity round-pen eraser: live vs replay
- live-vs-replay parity round-pen eraser: undo rebuild matches pre-stroke pixels
- live-vs-replay parity round-pen eraser: redo rebuild matches replay
- live-vs-replay parity round-pen alpha lock: live vs replay
- live-vs-replay parity round-pen alpha lock: undo rebuild matches pre-stroke pixels
- live-vs-replay parity round-pen alpha lock: redo rebuild matches replay
- live-vs-replay parity stamp jitter: live vs replay
- live-vs-replay parity stamp jitter: undo rebuild matches pre-stroke pixels
- live-vs-replay parity stamp jitter: redo rebuild matches replay
- live-vs-replay parity stamp mixing: live vs replay
- live-vs-replay parity stamp mixing: undo rebuild matches pre-stroke pixels
- live-vs-replay parity stamp mixing: redo rebuild matches replay
- live-vs-replay parity rough bristle mixing: live vs replay
- live-vs-replay parity rough bristle mixing: undo rebuild matches pre-stroke pixels
- live-vs-replay parity rough bristle mixing: redo rebuild matches replay
- live-vs-replay parity spray lognormal: live vs replay
- live-vs-replay parity spray lognormal: undo rebuild matches pre-stroke pixels
- live-vs-replay parity spray lognormal: redo rebuild matches replay
- live-vs-replay parity spray bimodal: live vs replay
- live-vs-replay parity spray bimodal: undo rebuild matches pre-stroke pixels
- live-vs-replay parity spray bimodal: redo rebuild matches replay
- GPU mixing feedMany parity 複数 batch と replay 相当の単一 batch が byte-identical
- GPU undo-1 cache byte parity stamp replay: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity stamp replay: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity stamp replay: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity stamp radial checkpoint: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity stamp radial checkpoint: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity stamp radial checkpoint: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity rough replay: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity rough replay: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity rough replay: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity rough checkpoint: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity rough checkpoint: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU undo-1 cache byte parity rough checkpoint: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte
- GPU rough bristle parity Rough mixing ON の CPU/GPU が Tier B parity を満たす
- GPU rough bristle parity CPU perFlush mixing の live/replay/undo/redo が byte-identical
- GPU rough bristle parity GPU perFlush mixing の live/replay/undo/redo が byte-identical
- GPU rough bristle parity mixing OFF の live/replay/undo/redo が同一 backend 内で byte-identical
- GPU mixing lifecycle fallback runtimeはWEBGL_lose_context後にhistory復元してCPUで全入力を再実行する
- GPU mixing lifecycle fallback GPU stroke の cancel 中に context lost なら従来の layer 復元へ fallback する
- GPU mixing lifecycle fallback runtimeはstroke途中のaccelerator dispose後にhistory復元してCPUで全入力を再実行する
- GPU mixing lifecycle fallback incremental renderer直接利用は復元せず現在layer上でCPU全入力を再描画する
- GPU mixing lifecycle fallback dispose済みacceleratorはstroke全体をCPU経路で描く
- GPU mixing Expand parity radial 2 の branch field が 5 update ごとに CPU と一致する
- GPU mixing Expand parity radial 4 の中心重なり fixture が CPU と Tier B alpha parity を満たす
- GPU mixing Expand parity radial 4 の live 分割 batch と replay 相当単一 batch が byte-identical
- GPU mixing Expand parity radial 4 の live stroke と command replay が byte-identical
- GPU mixing Expand parity radial 64 が GPU を使い live/replay byte 一致と CPU Tier B parity を満たす
- GPU mixing Expand parity radial 65 は supportsBranchCount=false となり CPU fallback する

### packages/stroke/src/stroke-runtime.test.ts
- stroke-runtime coalesced input batches keeps every point and matches sequential rendering
- stroke-runtime coalesced input batches keeps rough bristle pixels independent of caller batch boundaries
- stroke-runtime emission does not fire while input arrives faster than the interval
- stroke-runtime emission keeps firing while the pointer is stationary and records synthetic points
- stroke-runtime emission does not fire after end, cancel, or dispose
- stroke-runtime lifecycle does not fire timers after dispose
- stroke-runtime lifecycle keeps two runtime instances isolated
- stroke-runtime lifecycle restores the previous snapshot when start is called while active
- stroke-runtime commit passes inputPoints, brushSeed, and alphaLocked to onCommit

### packages/engine/src/brush/bristle-mask.test.ts
- bristle surface grain 初回の未着彩cellへalpha floorを加えない
- bristle surface grain uses pixel-local pressure as contact against the Fine tooth height field
- bristle surface grain is deterministic for the same document origin, seed, and pressure
- bristle surface grain adds opaque contact opportunities when one stroke revisits a surface

### packages/engine/src/brush/bristle-mixing-interpolation.test.ts
- bristle perFlush run color interpolation cpu forward keeps adjacent centerline redness within 8/255 after a red band
- bristle perFlush run color interpolation cpu reverse keeps adjacent centerline redness within 8/255 after a red band
- bristle perFlush run color interpolation cpu vertical keeps adjacent centerline redness within 8/255 after a red band
- bristle perFlush run color interpolation webgl2 forward keeps adjacent centerline redness within 8/255 after a red band
- bristle perFlush run color interpolation webgl2 reverse keeps adjacent centerline redness within 8/255 after a red band
- bristle perFlush run color interpolation webgl2 vertical keeps adjacent centerline redness within 8/255 after a red band

### packages/engine/src/brush/bristle.test.ts
- bristle brush 連続sweepで長いストロークを列方向に分断しない
- bristle brush 筆圧は外形幅をほぼ維持したまま着彩面積を増やす
- bristle brush 同じ入力とseedから同じ描画結果を得る
- bristle brush incremental chunkとfull replayのcoverageを近似一致させる
- bristle brush 反復接触で同じgrainの低着彩部が段階的に埋まる
- bristle brush mixing有効時は描画先と異なるstroke開始snapshotを要求する
- bristle brush mixing状態を更新し同一strokeの次区間へ引き継ぐ
- bristle brush 複数checkpointのreadbackをflushあたり2回に束ねる

### packages/engine/src/brush/mixing.test.ts
- prepareBristleMixingInterpolationProfiles matches an independently uploaded material profile
- prepareBristleMixingInterpolationProfiles shares run endpoints and uses one end profile below one byte of weight

### packages/engine/src/brush/spray.test.ts
- spray brush 決定論性: チャンク分割描画と一括描画のピクセルが一致する
- spray brush 粒子数が散布半径の面積におおむね比例する
- spray brush pressureDynamics.density = 1 では低筆圧の粒子数が減る
- spray brush radialDistribution の恒等カーブは面積あたり密度をほぼ一様にする
- spray brush radialDistribution の中央寄せ密度プロファイルは中心密度を上げる
- spray brush radialDistribution のリング状密度プロファイルは中間リングを最密にする
- spray brush radialDistribution の全ゼロ密度は一様円盤へフォールバックする
- spray brush sizeJitterMode=lognormal は同seedで決定論性を保つ
- spray brush sizeJitterMode=bimodal は同seedで決定論性を保つ
- spray brush 極端なパラメータでは粒子数を SPRAY_MAX_PARTICLES_PER_EMISSION にクランプする
- spray brush 同じ state から pending を2回再描画しても結果が二重化しない
- spray brush radial Expand の branch ごとに同数の粒子を描画する
- spray brush round-pen では spray state を要求しない

### packages/engine/src/brush/stamp.test.ts
- renderBrushStroke round-pen round-pen で描画すると BrushRenderState を返す
- renderBrushStroke round-pen round-pen で渡した state がそのまま返される
- renderBrushStroke stamp brush スタンプブラシで描画すると accumulatedDistance が更新される
- renderBrushStroke stamp brush 低筆圧では実効tip径へのspacing追従により点線化を抑える
- renderBrushStroke stamp brush tipCanvas が null の場合は描画をスキップする
- renderBrushStroke stamp brush 連続呼び出しで accumulatedDistance が累積する
- renderBrushStroke stamp brush 決定論性: 同じ入力から同じ描画結果が得られる
- renderBrushStroke stamp brush 吹きつけ有効時は同一座標でも時間経過で描画が濃くなる
- renderBrushStroke stamp brush スタンプがキャンバスに実際に描画されている
- renderBrushStroke stamp brush 1点だけのスタンプストロークでも開始点に描画する
- renderBrushStroke stamp brush overlap 文脈だけの単一点では重複スタンプを打たない
- renderBrushStroke stamp brush jitter パラメータが描画結果に影響する
- renderBrushStroke stamp brush pressureDynamics.flow でスタンプの不透明度が変わる
- renderBrushStroke stamp brush incremental（overlap 付き）と replay で emissionCount が一致する
- renderBrushStroke stamp brush 筆圧平滑化状態はincrementalとreplayで一致する
- renderBrushStroke stamp brush 混色は現在dabを元色でdepositし、次位置用fieldへ局所色差を保持する
- renderBrushStroke stamp brush 混色には描画先と独立したstroke-start sourceLayerを要求する
- renderBrushStroke stamp brush 局所色を接触前方へ漏らさず進行方向の後方へ引く
- renderBrushStroke stamp brush 描画済み色の再取得checkpointはlayer全体ではなく有限tileを保持する
- renderBrushStroke stamp brush 混色更新はupdateDistanceごとに次のdabへ反映される

### packages/engine/src/brush/state.test.ts
- brush render state mixing state clone はnumeric fieldとcanvas ownershipを分離する

### packages/engine/src/brush/tip.test.ts
- generateBrushTip circle tip hard circle (hardness=1.0) は指定サイズの OffscreenCanvas を返す
- generateBrushTip circle tip hard circle は中心にピクセルが描画されている
- generateBrushTip circle tip soft circle (hardness=0.0) は中心が不透明で端が透明
- generateBrushTip circle tip 中間 hardness (0.5) は gradient stop が設定される
- generateBrushTip circle tip 色が正しく焼き込まれる
- generateBrushTip image tip registry が未指定の場合は例外を投げる
- generateBrushTip image tip imageId が見つからない場合は例外を投げる
- createBrushTipRegistry set/get で画像を保存・取得できる

### packages/engine/src/brush/gpu/accelerator.browser.test.ts
- BrushAccelerator browser lifecycle dispose 後の beginStroke は false
- BrushAccelerator browser lifecycle maxBranches を stroke 適格判定に使う
- BrushAccelerator browser lifecycle warmUp で residency hit、invalidate で miss になる
- BrushAccelerator browser lifecycle context lost 後の beginStroke は false

### packages/engine/src/brush/gpu/bristle-pass.test.ts
- GPU bristle mask parity 'left-to-right' mixing keeps picked-up band color on the touched side within Tier B
- GPU bristle mask parity 'right-to-left' mixing keeps picked-up band color on the touched side within Tier B
- GPU bristle mask parity matches the CPU raster for the same rough bristle simple mask and sweep
- GPU bristle mask parity reports procedural simple mask parity and stays deterministic
- GPU bristle mask parity keeps incremental rough bristle chunks within Tier B
- GPU bristle mask parity does not generate or upload a CPU mask field in the GPU path

### packages/engine/src/brush/gpu/deferred-commit.browser.test.ts
- deferred bitmap commit pixel contract pending → endStroke is byte-identical to synchronous bitmap commit
- deferred bitmap commit pixel contract pending → drainPendingCommit is byte-identical to synchronous bitmap commit
- deferred bitmap commit pixel contract pending → dispose is byte-identical to synchronous bitmap commit
- deferred bitmap commit pixel contract poll completion (or bounded drain) is byte-identical to synchronous commit
- deferred bitmap commit pixel contract next flush drains the old canvas and preserves both commits byte-for-byte
- deferred bitmap commit pixel contract cancel clears pending and restores the pre-stroke bytes including uncommitted dabs
- deferred bitmap commit pixel contract retained undo after draining pending restores the pre-stroke bytes synchronously

### packages/engine/src/brush/gpu/gpu-stroke-surface.test.ts
- GpuStrokeSurface bristle chunk の重複 mask を MAX 蓄積して layer に commit する
- GpuStrokeSurface perFlush は複数 bristle run を一つの atlas/composite にまとめる
- GpuStrokeSurface perFlush composite は flush 前後の field を距離進行度で補間する
- GpuStrokeSurface perFlush の flush-start sample は texture swap 後も現在の accum を参照する
- GpuStrokeSurface perFlush field は各 bristle run の checkpoint geometry を積分する
- GpuStrokeSurface 単色 field と円 tip の dab を layer に commit する
- GpuStrokeSurface branch ごとの field を独立保持し branch 順に重ねる
- GpuStrokeSurface 全 branch の snapshot を参照して 2D strip を 1 pass で更新する
- GpuStrokeSurface field strip は小さい stroke に切り替えても縮小再確保しない
- GpuStrokeSurface field update は live accum ではなく直近の checkpoint snapshot を読む
- GpuStrokeSurface field update pass が CPU sampling/mix/restore/diffusion と一致する
- GpuStrokeSurface branch 1 の 10 回連続 field update が CPU と一致する
- GpuStrokeSurface strip field の dab 補間が Canvas2D の field 拡大と一致する
- GpuStrokeSurface 2 batch 連続 commit で最初の deposit と layer の他領域を維持する
- GpuStrokeSurface 複数 batch の commit と未 commit dab を base から byte 一致復元する
- GpuStrokeSurface commit 前に accum へ flush 済みの dab も cancel で消す
- GpuStrokeSurface 512px を超える dirty rect を分割 commit して layer 全域を保つ
- GpuStrokeSurface transferToImageBitmapが0寸法を返したらWebGL canvas直接描画へfallbackする
- GpuStrokeSurface direct commit は transferToImageBitmap を使わずWebGL canvasを描画する
- GpuStrokeSurface ImageBitmapのdrawImageが例外ならWebGL canvas直接描画へfallbackする
- GpuStrokeSurface radial 4 Expand の branch 別 commit が従来の union commit と byte-identical

### packages/engine/src/brush/gpu/per-flush-checkpoint-verification.test.ts
- checkpoint alpha-weighted interpolation stamp sampler preserves yellow RGB and half alpha at a transparent boundary
- checkpoint alpha-weighted interpolation carried sampler preserves yellow RGB and half alpha at a transparent boundary
- checkpoint alpha-weighted interpolation flush-start sampler preserves yellow RGB and half alpha at a transparent boundary
- checkpoint alpha-weighted interpolation stamp checkpoint pickup matches CPU at a transparent yellow boundary
- checkpoint alpha-weighted interpolation carried checkpoint pickup matches CPU at a transparent yellow boundary
- checkpoint alpha-weighted interpolation flush-start checkpoint pickup matches CPU at a transparent yellow boundary
- perFlush carried checkpoint parity contract 'unchanged substrate'
- perFlush carried checkpoint parity contract 'no in-flush checkpoint'
- perFlush carried checkpoint parity contract 'carried white vs flush-start black'
- perFlush carried checkpoint parity contract matches with saturated early pickup and a short tail
- perFlush checkpoint copy elision copies only the last checkpoint per branch (1 branches), at its composite
- perFlush checkpoint copy elision copies only the last checkpoint per branch (2 branches), at its composite
