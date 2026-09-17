# bristle run 内混色補間 実装報告（2026-09-06）

実装・静的検査済み。ブラウザ検収、修正前の失敗確認、CPU 性能計測は未完了。ブランチ `experiment/bristle-mixing-quality`、コミットなし。

## 変更ファイル

- `packages/engine/src/brush/gpu/gpu-stroke-surface.ts`: branch ごとの run 開始/終了重みと local.x 範囲を composite target に保持。
- `packages/engine/src/brush/gpu/bristle-pass.ts`: `uFieldMixWeights` / `uFieldMixSpan` を vec2 uniform として upload。
- `packages/engine/src/brush/gpu/shader-sources.ts`: composite の `sampleMaterial` で画素ごとに F0/F1 の重みを補間。
- `packages/engine/src/brush/mixing.ts`: run ごとの readonly `(w0, w1)` を受け、開始/終了 profile を返す。共通の端点重みは atlas slot / canvas を共有。
- `packages/engine/src/brush/bristle.ts`: CPU の run 開始重みを 0 から累積し、2 profile を線形グラデーションで blend。
- `packages/engine/src/brush/mixing.test.ts`: 既存の独立 upload との画素一致テストを2端点へ適応し、共有と定数扱いの閾値テストを追加。
- `packages/engine/src/brush/bristle-mixing-interpolation.test.ts`: CPU/GPU × 順方向/逆方向/垂直の中心線回帰6件を追加。
- `plans/agents-note.md`: 階段状の混色に関するメモを実装・検収待ちへ更新。
- 本報告。

`packages/*/docs` 全28ファイルは HEAD と byte 一致。`gpu/bristle-pass.test.ts`、`gpu/per-flush-checkpoint-verification.test.ts`、`packages/stroke/src/parity.test.ts` も HEAD と byte 一致。Tier B、cross-backend parity、両方向の touched-side 検証、checkpoint 一致契約は変更していない。公開 API / persisted 型の変更なし。

## GPU の (w0, w1, x0, x1)

1. `drawPerFlushBranchSegments` の composite 準備ループで、branch ごとの `compositedDistances` が `runStartDistance`。`max(0, segment.update?.distancePx ?? 0)` を足して `runEndDistance` とする。
2. 同じ branch の `updateDistances` を `totalDistance` とし、`w0 = clamp(runStartDistance / totalDistance)`、`w1 = clamp(runEndDistance / totalDistance)`。最初は w0=0、次の run は直前の w1 から始まる。totalDistance=0 は (1,1)。更新のない末尾 run は直前の終了重みを維持。
3. `segment.update` を branch の `latestMaterialFieldUpdates` に反映した後、`bristleTarget` が同じ geometry を取得。run の全 chunk にわたる最初の sweep segment の `fromX/fromY`、最後の `toX/toY` を読む。
4. `x = cos(angle) * (documentX-centerX) + sin(angle) * (documentY-centerY)` を両端へ適用して x0/x1 とする。shader の local.x と同じ frame・単位。逆方向は angle により local.x が進行方向へ向く。複数 chunk の run でも共通の範囲を使う。
5. shader は `t = clamp((local.x-x0) / max(x1-x0, 0.0001), 0, 1)`、`weight = mix(w0,w1,t)`。`abs(w1-w0) < 1/255` は w1 固定。

既存 segment/chunk から端点を取得できたため、surface の大きな構造変更は不要だった。field 更新・checkpoint・diffusion の順序を変えていない。

## CPU blend

`prepareBristleMixingInterpolationProfiles` は開始/終了 field を各端点重みで混ぜて従来の低解像度 atlas に一括 upload し、tip profile へ転写する。隣接 run の共通端点は Map で共有する。`abs(w1-w0) < 1/255` のときは終了 profile 1枚だけ返す。

`renderSweepRun` は profile 2枚の場合だけ ink0 / ink1 を従来の `drawSweep` で描く。run の始点→終点を bbox ローカル座標へ移した `createLinearGradient`（alpha 0→1）を用い、ink0 に `destination-out`、ink1 に `destination-in` を適用し、`lighter` で加算する。premultiplied RGB と alpha を相補的に足すため、source-over で2枚を重ねる場合の中間点の alpha 低下を避けられる。その後の mask `destination-in` と layerDraw は従来どおり各1回。run の両端距離が 0.001px 未満なら終了 profile で1回描き、退化したグラデーションを作らない。

## 追加テストと修正前の失敗確認

新規ファイルの describe: `bristle perFlush run color interpolation`。

- `cpu forward keeps adjacent centerline redness within 8/255 after a red band`
- `cpu reverse keeps adjacent centerline redness within 8/255 after a red band`
- `cpu vertical keeps adjacent centerline redness within 8/255 after a red band`
- `webgl2 forward keeps adjacent centerline redness within 8/255 after a red band`
- `webgl2 reverse keeps adjacent centerline redness within 8/255 after a red band`
- `webgl2 vertical keeps adjacent centerline redness within 8/255 after a red band`

紙目なし・均一毛束・一定筆圧で36pxの run を7個含む1 flush を描く。有限の赤帯を通過した後、中心線の151画素で `r-(g+b)/2` を測り、隣接差最大値 ≤8/255 を要求する。色変化幅 >64/255 により無混色・定数色での偽陽性を防ぎ、alpha ≥254 で blend による濃度低下も検出する。

`mixing.test.ts` の追加名: `prepareBristleMixingInterpolationProfiles shares run endpoints and uses one end profile below one byte of weight`。差0、差<1/255、差=1/255、および隣接端点の canvas 共有を検証する。

**修正前の定数重みに戻したときの失敗は未確認。修正後の画素テスト通過も未確認。** Browser mode がテスト収集前に `listen EPERM: operation not permitted ::1:63315` で失敗したため、新旧の画素比較を実行できていない。Node では新規7件も OffscreenCanvas 不在で失敗しており、これは回帰検出の証拠として扱わない。Claude 検収では同じ追加回帰ファイルを HEAD の production ソースを置いた隔離コピーでも実行し、旧式の maxAdjacentDelta が閾値を超えることを確認する必要がある。

## 実行コマンドと結果

- `pnpm -r build`: exit 0。7 workspace package/app の build 成功。ログに型エラー・warning なし。
- `pnpm lint`: exit 0、198ファイル、修正なし。
- `pnpm run typecheck`: exit 0。
- `git diff --check`: exit 0。
- `pnpm exec vitest run packages/engine/src/brush/bristle-mixing-interpolation.test.ts`: exit 1、listen EPERM、テストは0件実行。
- `pnpm exec vitest run --browser.enabled=false packages/engine packages/stroke --reporter=json --outputFile=/private/tmp/bristle-interpolation-node-final.json`: exit 1、539件中249成功・290失敗。ブラウザ依存テストも Node で収集する既存設定のため、このコマンド全体は通過していない。
- 以下16ファイルに限定した `pnpm exec vitest run --browser.enabled=false ...`: exit 0、214/214成功。上記249成功の内数。残り35成功は Canvas 依存テストと混在するファイルの純粋関数ケース。

```sh
pnpm exec vitest run --browser.enabled=false \
  packages/engine/src/expand.test.ts \
  packages/engine/src/stroke-interpolation.test.ts \
  packages/engine/src/transform-geometry.test.ts \
  packages/stroke/src/gpu-undo-cache.test.ts \
  packages/stroke/src/history.test.ts \
  packages/stroke/src/layer-operations.test.ts \
  packages/stroke/src/replay.test.ts \
  packages/stroke/src/session.test.ts \
  packages/stroke/src/stroke-machine.test.ts \
  packages/stroke/src/transform-machine.test.ts \
  packages/stroke/src/types.test.ts \
  packages/engine/src/brush/material-field.test.ts \
  packages/engine/src/brush/pressure-smoothing.test.ts \
  packages/engine/src/brush/prng.test.ts \
  packages/engine/src/brush/scheduler.test.ts \
  packages/engine/src/brush/gpu/accelerator.test.ts
```

失敗の内訳: OffscreenCanvas 不在251件、WebGL2 accelerator 不在33件、accelerator=null の期待不一致4件、Canvas 不在により期待した tip 例外へ到達しなかった2件。以下に全テスト名を列挙する。

## セルフレビュー・残る検収

`planning-flow` / `review-library-usage` に従い、engine/input/stroke の README、engine の brush-api / gpu-acceleration と実装の対応を確認した。既存 field atlas、drawSweep、geometry を利用し、input/stroke へ責務を追加していない。内部 profile の型と呼び出し側の整合は typecheck で確認。docs への追記・修正はしていない。

- 実ブラウザで追加回帰6件と profile 2件、および既存全テストを検収。
- 同じ回帰を旧定数重みの production ソースでも実行し、失敗を確認。
- 保護対象の Tier B / cross-backend parity / checkpoint 契約の継続通過を確認。今回測定不能のため閾値超過の有無は未判定。
- CPU 混色ONの性能増分が +15%以内かを Claude 側で測定。

## Canvas / WebGL がなく検証できなかったテスト全名

### packages/engine/src/content-bounds.test.ts

- `getContentBounds should return null for an empty layer`
- `getContentBounds should return bounds for a single pixel`
- `getContentBounds should return bounds for pixel at top-left corner`
- `getContentBounds should return bounds for pixel at bottom-right corner`
- `getContentBounds should return full bounds for fully filled layer`
- `getContentBounds should return tight bounds for multiple pixels`
- `getContentBounds should detect pixels with any non-zero RGBA component`
- `getContentBounds should handle a horizontal line of pixels`
- `getContentBounds should handle a vertical line of pixels`

### packages/engine/src/draw.test.ts

- `drawLine should draw something on the layer`
- `drawLine should draw a horizontal line`
- `drawLine should draw a vertical line`
- `drawLine should respect lineWidth parameter`
- `drawCircle should draw a filled circle`
- `drawCircle should draw at center`
- `drawCircle larger radius should fill more pixels`
- `drawPath should draw nothing for empty points`
- `drawPath should draw a path through points`

### packages/engine/src/incremental-render.test.ts

- `appendToCommittedLayer should not modify layer when points are empty`
- `appendToCommittedLayer should draw path on layer`
- `appendToCommittedLayer should preserve existing drawing (append mode)`
- `appendToCommittedLayer should draw with overlapCount > 0 (bridge segment)`
- `appendToCommittedLayer overlapCount=0 should behave identically to no overlapCount`
- `appendToCommittedLayer should constrain normal drawing to existing alpha when alpha locked`
- `appendToCommittedLayer should erase normally when alpha locked`
- `renderPendingLayer should clear and redraw`
- `renderPendingLayer should clear layer when points are empty`
- `renderPendingLayer mixing有効時はpendingを描かず既存previewもclearする`
- `renderPendingLayer bristleはmixing設定に関係なくpendingを描かない`
- `composeLayers should compose visible layers`
- `composeLayers should skip invisible layers`
- `composeLayers should apply view transform`
- `composeLayers should apply pendingOverlay with pre-composite for opacity < 1`
- `composeLayers should apply pendingOverlay with eraser (destination-out)`
- `composeLayers should mask pendingOverlay with committed alpha when alpha locked`
- `composeLayers should skip pre-composite when all settings are normal`
- `composeLayers should apply blend mode with pre-composite`
- `composeLayers renderLayers should mask pendingOverlay with committed alpha when alpha locked`

### packages/engine/src/layer-collection.test.ts

- `addLayer should add layer at the end by default`
- `addLayer should insert at specified index`
- `addLayer should return new array without mutating original`
- `removeLayer should remove layer by ID`
- `removeLayer should return original array if ID not found`
- `findLayerById should find layer by ID`
- `findLayerById should return undefined for nonexistent ID`
- `getLayerIndex should return correct index`
- `getLayerIndex should return -1 for nonexistent ID`
- `moveLayer should move layer from one position to another`
- `moveLayer should return same array if fromIndex equals toIndex`
- `moveLayer should return same array for out-of-bounds indices`
- `moveLayer should preserve relative order of other elements`
- `updateLayerMeta should update specified fields only`
- `updateLayerMeta should return new array (immutable)`

### packages/engine/src/layer-merge.test.ts

- `mergeLayerDown should burn source into target and normalize target meta`
- `mergeLayerDown should apply opacity while burning hidden source pixels`

### packages/engine/src/layer.test.ts

- `createLayer should create a layer with correct dimensions`
- `createLayer should have default meta values`
- `createLayer should accept custom meta values`
- `createLayer should have canvas and ctx`
- `getPixel / setPixel should initialize pixels to transparent`
- `getPixel / setPixel should set and get pixel correctly`
- `getPixel / setPixel should return transparent black for out-of-bounds getPixel`
- `getPixel / setPixel should ignore out-of-bounds setPixel`
- `getImageData should return correct ImageData`
- `clearLayer should clear all pixels`
- `cloneLayer / copyLayerPixels should copy pixels and meta with overrides`
- `cloneLayer / copyLayerPixels should clear target before copying pixels`

### packages/engine/src/pattern-preview.test.ts

- `createPatternTile should return null when mode is none`
- `createPatternTile should return null when no visible layers`
- `createPatternTile should include background color when background is provided`
- `createPatternTile should not include background when background.visible is false`
- `createPatternTile should apply compositeOperation when compositing layers`
- `createPatternTile should produce different results with vs without background for blend modes`
- `createPatternTile should apply layer opacity in tile`
- `renderPatternPreview should render repeated tiles only outside the original layer area`
- `renderPatternPreview should keep offset grid rows visible outside the clipped layer area`

### packages/engine/src/transform-layer.test.ts

- `transformLayer should be no-op with identity matrix`
- `transformLayer should translate pixel by (dx, dy)`
- `transformLayer should clip content that moves outside layer bounds`
- `transformLayer should scale layer content`
- `transformLayer should reuse provided temp canvas`
- `transformLayer should resize temp canvas if size does not match`
- `transformLayer should handle multiple pixels translation`

### packages/engine/src/wrap-shift.test.ts

- `wrapShiftLayer should be no-op when dx and dy are zero`
- `wrapShiftLayer should be no-op when shift is a multiple of layer size`
- `wrapShiftLayer should shift pixel right by dx`
- `wrapShiftLayer should shift pixel down by dy`
- `wrapShiftLayer should wrap pixel around horizontally`
- `wrapShiftLayer should wrap pixel around vertically`
- `wrapShiftLayer should handle negative shifts`
- `wrapShiftLayer should be reversible: shift(+dx) then shift(-dx) = identity`
- `wrapShiftLayer should support cumulative shifts`
- `wrapShiftLayer should reuse provided temp canvas`
- `wrapShiftLayer should resize temp canvas if size does not match`

### packages/stroke/src/command-executor.test.ts

- `command executor undoes wrap-shift by shifting every layer in the opposite direction`
- `command executor redoes wrap-shift by shifting every layer in the recorded direction`
- `command executor rebuilds affected layers for a normal draw undo and returns visibility fixes`
- `command executor interrupts a normal draw redo when rebuild fails`
- `command executor undoes add-layer with a remove list op and nearest active hint`
- `command executor redoes add-layer by recreating the recorded layer id and inserting it`
- `command executor undoes remove-layer by recreating, rebuilding, inserting, and activating the removed layer`
- `command executor interrupts remove-layer undo when the removed layer lacks a checkpoint`
- `command executor redoes remove-layer with a remove list op and nearest active hint`
- `command executor undoes duplicate-layer by removing the duplicate and activating the source`
- `command executor redoes duplicate-layer by applying the command and returning a replace list op`
- `command executor interrupts duplicate-layer redo when the recorded command cannot be applied`
- `command executor undoes merge-layer-down by recreating the source, restoring target meta, rebuilding both, and inserting source`
- `command executor redoes merge-layer-down by applying the command and returning a replace list op`
- `command executor interrupts merge-layer-down redo when the recorded topology does not match`

### packages/stroke/src/gpu-residency.test.ts

- `GPU layer residency 筆圧で stampSize が変化しても snapshot array を stroke 中に再確保しない`
- `GPU layer residency 連続する2本目のGPU strokeでuploadを省略し、毎回uploadとpixel一致する`
- `GPU layer residency residency hit の通常 stroke は layer pixel を読み出さない`
- `GPU layer residency radial 4 Expand と併用して連続する2本目が residency hit する`
- `GPU layer residency 間のCPU strokeで無効化し、次のGPU strokeを再uploadしてpixel一致する`
- `GPU layer residency GPU stroke x3 のUndo rebuild後は次のGPU strokeがhitし、常駐無効時とbyte一致する`
- `GPU layer residency 通常 GPU stroke の cancel は history 復元せず byte 一致し次 stroke も residency hit する`
- `GPU layer residency radial 4 Expand GPU stroke の cancel は history 復元せず byte 一致し次 stroke も residency hit する`
- `GPU layer residency React Undoボタン順序のcancel→restore→undo→遅延end後もownerを残さず次がhitする`
- `GPU layer residency strokeStart stallに直前のresidency invalidation reasonを含める`
- `GPU layer residency stale owner回復eventに開始経路・開始時刻・回復経路を含める`
- `GPU layer residency GPU→CPU strokeのUndoでcheckpoint復元後のGPU replayを常駐維持する`
- `GPU layer residency CPU→GPU strokeのUndoでCPU replayが最後なら次のGPU strokeはmissする`
- `GPU layer residency 4本のAcrylic hatchをUndo→RedoしてもUndoなしのlayerとbyte一致する`
- `GPU layer residency dirty rectが1024²を超える単一Acrylic strokeのRedoを複数passでbyte一致commitする`

### packages/stroke/src/parity.test.ts

- `live-vs-replay parity round-pen basic: live vs replay`
- `live-vs-replay parity round-pen basic: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity round-pen basic: redo rebuild matches replay`
- `live-vs-replay parity round-pen eraser: live vs replay`
- `live-vs-replay parity round-pen eraser: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity round-pen eraser: redo rebuild matches replay`
- `live-vs-replay parity round-pen alpha lock: live vs replay`
- `live-vs-replay parity round-pen alpha lock: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity round-pen alpha lock: redo rebuild matches replay`
- `live-vs-replay parity stamp jitter: live vs replay`
- `live-vs-replay parity stamp jitter: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity stamp jitter: redo rebuild matches replay`
- `live-vs-replay parity stamp mixing: live vs replay`
- `live-vs-replay parity stamp mixing: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity stamp mixing: redo rebuild matches replay`
- `live-vs-replay parity rough bristle mixing: live vs replay`
- `live-vs-replay parity rough bristle mixing: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity rough bristle mixing: redo rebuild matches replay`
- `live-vs-replay parity spray lognormal: live vs replay`
- `live-vs-replay parity spray lognormal: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity spray lognormal: redo rebuild matches replay`
- `live-vs-replay parity spray bimodal: live vs replay`
- `live-vs-replay parity spray bimodal: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity spray bimodal: redo rebuild matches replay`
- `GPU mixing feedMany parity 複数 batch と replay 相当の単一 batch が byte-identical`
- `GPU undo-1 cache byte parity stamp replay: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity stamp replay: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity stamp replay: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity stamp radial checkpoint: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity stamp radial checkpoint: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity stamp radial checkpoint: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity rough replay: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity rough replay: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity rough replay: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity rough checkpoint: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity rough checkpoint: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity rough checkpoint: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU rough bristle parity Rough mixing ON の CPU/GPU が Tier B parity を満たす`
- `GPU rough bristle parity CPU perFlush mixing の live/replay/undo/redo が byte-identical`
- `GPU rough bristle parity GPU perFlush mixing の live/replay/undo/redo が byte-identical`
- `GPU rough bristle parity mixing OFF の live/replay/undo/redo が同一 backend 内で byte-identical`
- `GPU mixing lifecycle fallback runtimeはWEBGL_lose_context後にhistory復元してCPUで全入力を再実行する`
- `GPU mixing lifecycle fallback GPU stroke の cancel 中に context lost なら従来の layer 復元へ fallback する`
- `GPU mixing lifecycle fallback runtimeはstroke途中のaccelerator dispose後にhistory復元してCPUで全入力を再実行する`
- `GPU mixing lifecycle fallback incremental renderer直接利用は復元せず現在layer上でCPU全入力を再描画する`
- `GPU mixing lifecycle fallback dispose済みacceleratorはstroke全体をCPU経路で描く`
- `GPU mixing Expand parity radial 2 の branch field が 5 update ごとに CPU と一致する`
- `GPU mixing Expand parity radial 4 の中心重なり fixture が CPU と Tier B alpha parity を満たす`
- `GPU mixing Expand parity radial 4 の live 分割 batch と replay 相当単一 batch が byte-identical`
- `GPU mixing Expand parity radial 4 の live stroke と command replay が byte-identical`
- `GPU mixing Expand parity radial 64 が GPU を使い live/replay byte 一致と CPU Tier B parity を満たす`
- `GPU mixing Expand parity radial 65 は supportsBranchCount=false となり CPU fallback する`

### packages/stroke/src/stroke-runtime.test.ts

- `stroke-runtime coalesced input batches keeps every point and matches sequential rendering`
- `stroke-runtime coalesced input batches keeps rough bristle pixels independent of caller batch boundaries`
- `stroke-runtime emission does not fire while input arrives faster than the interval`
- `stroke-runtime emission keeps firing while the pointer is stationary and records synthetic points`
- `stroke-runtime emission does not fire after end, cancel, or dispose`
- `stroke-runtime lifecycle does not fire timers after dispose`
- `stroke-runtime lifecycle keeps two runtime instances isolated`
- `stroke-runtime lifecycle restores the previous snapshot when start is called while active`
- `stroke-runtime commit passes inputPoints, brushSeed, and alphaLocked to onCommit`

### packages/engine/src/brush/bristle-mask.test.ts

- `bristle surface grain 初回の未着彩cellへalpha floorを加えない`
- `bristle surface grain uses pixel-local pressure as contact against the Fine tooth height field`
- `bristle surface grain is deterministic for the same document origin, seed, and pressure`
- `bristle surface grain adds opaque contact opportunities when one stroke revisits a surface`

### packages/engine/src/brush/bristle-mixing-interpolation.test.ts

- `bristle perFlush run color interpolation cpu forward keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation cpu reverse keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation cpu vertical keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation webgl2 forward keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation webgl2 reverse keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation webgl2 vertical keeps adjacent centerline redness within 8/255 after a red band`

### packages/engine/src/brush/bristle.test.ts

- `bristle brush 連続sweepで長いストロークを列方向に分断しない`
- `bristle brush 筆圧は外形幅をほぼ維持したまま着彩面積を増やす`
- `bristle brush 同じ入力とseedから同じ描画結果を得る`
- `bristle brush incremental chunkとfull replayのcoverageを近似一致させる`
- `bristle brush 反復接触で同じgrainの低着彩部が段階的に埋まる`
- `bristle brush mixing有効時は描画先と異なるstroke開始snapshotを要求する`
- `bristle brush mixing状態を更新し同一strokeの次区間へ引き継ぐ`
- `bristle brush 複数checkpointのreadbackをflushあたり2回に束ねる`

### packages/engine/src/brush/mixing.test.ts

- `prepareBristleMixingInterpolationProfiles matches an independently uploaded material profile`
- `prepareBristleMixingInterpolationProfiles shares run endpoints and uses one end profile below one byte of weight`

### packages/engine/src/brush/spray.test.ts

- `spray brush 決定論性: チャンク分割描画と一括描画のピクセルが一致する`
- `spray brush 粒子数が散布半径の面積におおむね比例する`
- `spray brush pressureDynamics.density = 1 では低筆圧の粒子数が減る`
- `spray brush radialDistribution の恒等カーブは面積あたり密度をほぼ一様にする`
- `spray brush radialDistribution の中央寄せ密度プロファイルは中心密度を上げる`
- `spray brush radialDistribution のリング状密度プロファイルは中間リングを最密にする`
- `spray brush radialDistribution の全ゼロ密度は一様円盤へフォールバックする`
- `spray brush sizeJitterMode=lognormal は同seedで決定論性を保つ`
- `spray brush sizeJitterMode=bimodal は同seedで決定論性を保つ`
- `spray brush 極端なパラメータでは粒子数を SPRAY_MAX_PARTICLES_PER_EMISSION にクランプする`
- `spray brush 同じ state から pending を2回再描画しても結果が二重化しない`
- `spray brush radial Expand の branch ごとに同数の粒子を描画する`
- `spray brush round-pen では spray state を要求しない`

### packages/engine/src/brush/stamp.test.ts

- `renderBrushStroke round-pen round-pen で描画すると BrushRenderState を返す`
- `renderBrushStroke round-pen round-pen で渡した state がそのまま返される`
- `renderBrushStroke stamp brush スタンプブラシで描画すると accumulatedDistance が更新される`
- `renderBrushStroke stamp brush 低筆圧では実効tip径へのspacing追従により点線化を抑える`
- `renderBrushStroke stamp brush tipCanvas が null の場合は描画をスキップする`
- `renderBrushStroke stamp brush 連続呼び出しで accumulatedDistance が累積する`
- `renderBrushStroke stamp brush 決定論性: 同じ入力から同じ描画結果が得られる`
- `renderBrushStroke stamp brush 吹きつけ有効時は同一座標でも時間経過で描画が濃くなる`
- `renderBrushStroke stamp brush スタンプがキャンバスに実際に描画されている`
- `renderBrushStroke stamp brush 1点だけのスタンプストロークでも開始点に描画する`
- `renderBrushStroke stamp brush overlap 文脈だけの単一点では重複スタンプを打たない`
- `renderBrushStroke stamp brush jitter パラメータが描画結果に影響する`
- `renderBrushStroke stamp brush pressureDynamics.flow でスタンプの不透明度が変わる`
- `renderBrushStroke stamp brush incremental（overlap 付き）と replay で emissionCount が一致する`
- `renderBrushStroke stamp brush 筆圧平滑化状態はincrementalとreplayで一致する`
- `renderBrushStroke stamp brush 混色は現在dabを元色でdepositし、次位置用fieldへ局所色差を保持する`
- `renderBrushStroke stamp brush 混色には描画先と独立したstroke-start sourceLayerを要求する`
- `renderBrushStroke stamp brush 局所色を接触前方へ漏らさず進行方向の後方へ引く`
- `renderBrushStroke stamp brush 描画済み色の再取得checkpointはlayer全体ではなく有限tileを保持する`
- `renderBrushStroke stamp brush 混色更新はupdateDistanceごとに次のdabへ反映される`

### packages/engine/src/brush/state.test.ts

- `brush render state mixing state clone はnumeric fieldとcanvas ownershipを分離する`

### packages/engine/src/brush/tip.test.ts

- `generateBrushTip circle tip hard circle (hardness=1.0) は指定サイズの OffscreenCanvas を返す`
- `generateBrushTip circle tip hard circle は中心にピクセルが描画されている`
- `generateBrushTip circle tip soft circle (hardness=0.0) は中心が不透明で端が透明`
- `generateBrushTip circle tip 中間 hardness (0.5) は gradient stop が設定される`
- `generateBrushTip circle tip 色が正しく焼き込まれる`
- `generateBrushTip image tip registry が未指定の場合は例外を投げる`
- `generateBrushTip image tip imageId が見つからない場合は例外を投げる`
- `createBrushTipRegistry set/get で画像を保存・取得できる`

### packages/engine/src/brush/gpu/accelerator.browser.test.ts

- `BrushAccelerator browser lifecycle dispose 後の beginStroke は false`
- `BrushAccelerator browser lifecycle maxBranches を stroke 適格判定に使う`
- `BrushAccelerator browser lifecycle warmUp で residency hit、invalidate で miss になる`
- `BrushAccelerator browser lifecycle context lost 後の beginStroke は false`

### packages/engine/src/brush/gpu/bristle-pass.test.ts

- `GPU bristle mask parity 'left-to-right' mixing keeps picked-up band color on the touched side within Tier B`
- `GPU bristle mask parity 'right-to-left' mixing keeps picked-up band color on the touched side within Tier B`
- `GPU bristle mask parity matches the CPU raster for the same rough bristle simple mask and sweep`
- `GPU bristle mask parity reports procedural simple mask parity and stays deterministic`
- `GPU bristle mask parity keeps incremental rough bristle chunks within Tier B`
- `GPU bristle mask parity does not generate or upload a CPU mask field in the GPU path`

### packages/engine/src/brush/gpu/gpu-stroke-surface.test.ts

- `GpuStrokeSurface bristle chunk の重複 mask を MAX 蓄積して layer に commit する`
- `GpuStrokeSurface perFlush は複数 bristle run を一つの atlas/composite にまとめる`
- `GpuStrokeSurface perFlush composite は flush 前後の field を距離進行度で補間する`
- `GpuStrokeSurface perFlush の flush-start sample は texture swap 後も現在の accum を参照する`
- `GpuStrokeSurface perFlush field は各 bristle run の checkpoint geometry を積分する`
- `GpuStrokeSurface 単色 field と円 tip の dab を layer に commit する`
- `GpuStrokeSurface branch ごとの field を独立保持し branch 順に重ねる`
- `GpuStrokeSurface 全 branch の snapshot を参照して 2D strip を 1 pass で更新する`
- `GpuStrokeSurface field strip は小さい stroke に切り替えても縮小再確保しない`
- `GpuStrokeSurface field update は live accum ではなく直近の checkpoint snapshot を読む`
- `GpuStrokeSurface field update pass が CPU sampling/mix/restore/diffusion と一致する`
- `GpuStrokeSurface branch 1 の 10 回連続 field update が CPU と一致する`
- `GpuStrokeSurface strip field の dab 補間が Canvas2D の field 拡大と一致する`
- `GpuStrokeSurface 2 batch 連続 commit で最初の deposit と layer の他領域を維持する`
- `GpuStrokeSurface 複数 batch の commit と未 commit dab を base から byte 一致復元する`
- `GpuStrokeSurface commit 前に accum へ flush 済みの dab も cancel で消す`
- `GpuStrokeSurface 512px を超える dirty rect を分割 commit して layer 全域を保つ`
- `GpuStrokeSurface transferToImageBitmapが0寸法を返したらWebGL canvas直接描画へfallbackする`
- `GpuStrokeSurface direct commit は transferToImageBitmap を使わずWebGL canvasを描画する`
- `GpuStrokeSurface ImageBitmapのdrawImageが例外ならWebGL canvas直接描画へfallbackする`
- `GpuStrokeSurface radial 4 Expand の branch 別 commit が従来の union commit と byte-identical`

### packages/engine/src/brush/gpu/per-flush-checkpoint-verification.test.ts

- `checkpoint alpha-weighted interpolation stamp sampler preserves yellow RGB and half alpha at a transparent boundary`
- `checkpoint alpha-weighted interpolation carried sampler preserves yellow RGB and half alpha at a transparent boundary`
- `checkpoint alpha-weighted interpolation flush-start sampler preserves yellow RGB and half alpha at a transparent boundary`
- `checkpoint alpha-weighted interpolation stamp checkpoint pickup matches CPU at a transparent yellow boundary`
- `checkpoint alpha-weighted interpolation carried checkpoint pickup matches CPU at a transparent yellow boundary`
- `checkpoint alpha-weighted interpolation flush-start checkpoint pickup matches CPU at a transparent yellow boundary`
- `perFlush carried checkpoint parity contract 'unchanged substrate'`
- `perFlush carried checkpoint parity contract 'no in-flush checkpoint'`
- `perFlush carried checkpoint parity contract 'carried white vs flush-start black'`
- `perFlush carried checkpoint parity contract matches with saturated early pickup and a short tail`
- `perFlush checkpoint copy elision copies only the last checkpoint per branch (1 branches), at its composite`
- `perFlush checkpoint copy elision copies only the last checkpoint per branch (2 branches), at its composite`

