# Checkpoint alpha 補間: 検証結果

## 変更ファイル

- `packages/engine/src/brush/mixing.ts`
- `packages/engine/src/brush/gpu/shader-sources.ts`
- `packages/engine/src/brush/mixing.test.ts`
- `packages/engine/src/brush/material-field.test.ts`
- `packages/engine/src/brush/gpu/per-flush-checkpoint-verification.test.ts`
- `packages/engine/docs/gpu-acceleration.md`
- `plans/agents-note.md`
- `plans/2026-09-06-15-56_checkpoint-alpha-interpolation.md`
- `plans/2026-09-06-15-56_checkpoint-alpha-verification.md`

## 実行コマンドと結果

- `pnpm -r build`: exit 0。declaration diagnostics を含め error / warning なし。
- `pnpm lint`: exit 0（197 files）。
- `pnpm run typecheck`: exit 0。
- `pnpm exec vitest run --browser.enabled=false packages/engine --reporter=json --outputFile=/tmp/headless-paint-alpha-tests.json`: exit 1。337件中145件成功、192件は Canvas / WebGL のない Node 環境で実行不能（失敗扱い）。ブラウザ依存テストを除外しない指定コマンド全体は green ではない。
- `pnpm exec vitest run --browser.enabled=false packages/engine/src/brush/mixing.test.ts packages/engine/src/brush/material-field.test.ts --testNamePattern 'sampleRotatedCheckpoint|material field|getActiveMixing'`: exit 0。12件成功、Canvas依存の既存1件は選択対象外。
- 修正前の `sampleBilinear` のみ一時適用し、`--testNamePattern 'sampleRotatedCheckpoint|keeps yellow baseColor'` で同じ2ファイルを実行: 追加CPU回帰6件すべて失敗。直後に修正版を復元済み。

## 追加テスト

- mixing.test.ts: `preserves opaque color at a half-alpha $label boundary`（horizontal / vertical / outside tile）。RGB=C、alpha=128（0.5のbyte丸め）。
- mixing.test.ts: `returns zero RGBA when all contributing texels are transparent`。透明texelにRGB値があってもRGBAゼロ。
- mixing.test.ts: `weights all four colors by their alpha before unpremultiplying`。4近傍の異なるalphaを考慮し、透明texelの隠れたRGBを除外。
- material-field.test.ts: `keeps yellow baseColor when mixing repeatedly across transparent substrate`。黄色・半透明境界・透明をsampleし、pickupを強く、restoreをゼロにして20回更新してもbaseColorを維持。
- per-flush-checkpoint-verification.test.ts: `%s sampler preserves yellow RGB and half alpha at a transparent boundary`（stamp / carried / flush-start）。production GLSLのsampling関数を直接実行し、境界のRGB/alpha、tile外、完全透明をreadPixelsで検証。ブラウザ検収待ち。
- 同ファイル: `%s checkpoint pickup matches CPU at a transparent yellow boundary`（同3経路）。既存GpuStrokeSurfaceのcheckpoint経路で、青fieldへの半透明黄色のpickupを独立期待値とCPU結果（差1byte以内）で比較。ブラウザ検収待ち。

## セルフレビュー

- 公開API / 型定義、material-field.ts の pickup / restore / diffusion は未変更。
- per-flush-checkpoint-verification.test.ts の既存部分（carried parity contract以降）はHEADとbyte一致。bristle-pass.test.ts を含む既存Tier Bテストは未変更。
- samplingの内部関数を既存の公開範囲のまま使用し、GPUテストは既存createProgram / GpuStrokeSurfaceを再利用。
- engine / input / stroke のdocs/README.md、engineのbrush-api.md / gpu-acceleration.mdを参照し、実装・文書整合を確認。
- 実ブラウザのCPU/GPU parityを通過したとの主張はしない。最終検収はClaude。コミットなし。

## Node 環境で検証できなかったテスト名

失敗内訳: OffscreenCanvas未定義186件、WebGL生成がnullのassertion4件、Canvas未定義が期待する例外より先に発生2件。以下は実ブラウザで再実行する。

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

### packages/engine/src/brush/bristle-mask.test.ts

- `bristle surface grain 初回の未着彩cellへalpha floorを加えない`
- `bristle surface grain uses pixel-local pressure as contact against the Fine tooth height field`
- `bristle surface grain is deterministic for the same document origin, seed, and pressure`
- `bristle surface grain adds opaque contact opportunities when one stroke revisits a surface`

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
