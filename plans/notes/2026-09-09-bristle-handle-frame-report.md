# Bristle 引きずり柄モデル 実装報告（未コミット）

branch: `experiment/paper-tooth-heightmap`。設計正本: `plans/2026-09-09-20-49_bristle-handle-frame.md` と engine docs。

## 変更ファイルと要点

- `packages/engine/src/types.ts`: required readonly `handleLengthRatio`（既定0.5）、optional readonly `handleX/Y`・`handleDirectionX/Y`。
- `packages/engine/src/brush/bristle.ts`: 柄を張ったときだけ移動・方向更新。たるみ中は保持方向を使用し、stateで引き継ぐ。フレーム・incoming・cusp・lagへの方向入力だけを差し替え、掃引点の生の接線は維持。単体テストから呼ぶため resolver を内部モジュールで export（パッケージエントリには追加しない）。
- `packages/engine/src/brush/state.ts`: 自明な補完として、既存clone処理でも柄の4フィールドをコピー。コピー時の状態欠落を防ぐ。pendingのno-op方針は変更しない。
- `packages/react/src/persistence.ts`: 有限0..4を検証し、欠落のみDEFAULTの0.5で補完。null・NaN・無限・文字列・範囲外はreject。
- `apps/web/src/components/DebugPanel.tsx`: Dropout/Sizeと同じPenフォルダーにHandle length（柄の長さ）、0..2、step 0.05。既存setBrushを利用し、bristle選択時だけ表示、設定変更にも追随。
- `packages/engine/src/brush/bristle-handle-frame.test.ts` と `__snapshots__/bristle-handle-frame.test.ts.snap`: 柄モデルの単体回帰。snapshotは柄の実装を加える前のresolverから取得し、以降更新していない。
- `packages/react/src/persistence.test.ts`: round-trip、欠落補完、範囲検証を追加。既存fixtureへDEFAULT_BRISTLE_DYNAMICSをspreadし、新しいrequiredフィールドに追随。
- 計画ファイル、`plans/agents-note.md`、本報告: 実装結果・補完・検収待ち範囲を記録。

## 追加テスト名

- `round-trips bristle handleLengthRatio=0`
- `round-trips bristle handleLengthRatio=0.5`
- `round-trips bristle handleLengthRatio=1.25`
- `round-trips bristle handleLengthRatio=4`
- `restores missing bristle handleLengthRatio as 0.5`
- `rejects bristle handleLengthRatio outside finite 0..4`
- `L=0 exactly preserves the pre-handle curve, cusp and lag output`
- `L=15 keeps every longitudinal frame within 5 degrees of horizontal under 1px jitter`
- `L=30 keeps every longitudinal frame within 2.5 degrees of horizontal under 1px jitter`
- `L=15 follows a radius-60 semicircle smoothly and converges to the geometric lag angle`
- `a 180-degree reversal flips frameSign after 2L without rotating the longitudinal frame sideways`
- `retains the handle and its last taut direction at the slack boundary, through the handle and while stopped`
- `matches a single flush at every split, including curved slack and reversal lag`
- `initializes a new branch from its first tangent and leaves an empty flush unchanged`
- `clones the handle state without changing a continuation in curved slack`

既存テストの期待値・閾値・入力条件は変更していない。既存persistence fixtureへの既定値補完のみ。既存bristleテストにはcusp/lagを直接検証するものがなかったため、変更前の出力fixtureと新規テストで確認した。

横ブレ試験は開始接線を横向きにし、以後xを1px進めつつy=0,1を交互に与える。初回の柄は仕様どおり開始接線で初期化する。半円は半径60px、720分割。終端40点の遅れ角が連続極限asin(15/60)から0.2°以内、ばらつき0.02°未満であることを確認。flush試験は曲線＋折返し181 emissionsの全180分割位置で点列とstateの厳密一致を確認する。

## 実行結果

- `pnpm -r build`: 成功。API ExtractorのTypeScript版差、webの500kB超chunkに関する警告あり。
- `pnpm typecheck`: 成功。
- `pnpm lint`: 成功。
- ノンブラウザVitest: 33ファイル、403成功、0失敗、Canvas依存8件を名前で除外。追加15件は全成功。
- `git diff --check`: 成功。engine docsの差分なし。ルートにpng/txt/logのデバッグ成果物なし。コミットなし。

再実行コマンド（Canvas依存ケースを含むファイルは下記の名前で除外）:

```sh
pnpm exec vitest run --browser.enabled=false \
  packages/input/src/filter-pipeline.test.ts \
  packages/input/src/gesture.test.ts \
  packages/input/src/sampling.test.ts \
  packages/input/src/transform.test.ts \
  packages/engine/src/expand.test.ts \
  packages/engine/src/stroke-interpolation.test.ts \
  packages/engine/src/transform-geometry.test.ts \
  packages/react/src/persistence.test.ts \
  packages/stroke/src/gpu-undo-cache.test.ts \
  packages/stroke/src/history.test.ts \
  packages/stroke/src/layer-operations.test.ts \
  packages/stroke/src/replay.test.ts \
  packages/stroke/src/session.test.ts \
  packages/stroke/src/stroke-machine.test.ts \
  packages/stroke/src/transform-machine.test.ts \
  packages/stroke/src/types.test.ts \
  packages/input/src/plugins/causal-adaptive-plugin.test.ts \
  packages/input/src/plugins/smoothing-plugin.test.ts \
  packages/input/src/plugins/straight-line-plugin.test.ts \
  packages/engine/src/brush/bristle-handle-frame.test.ts \
  packages/engine/src/brush/bristle-mask.test.ts \
  packages/engine/src/brush/bristle-mixing-profile-selection.test.ts \
  packages/engine/src/brush/bristle-pressure-dynamics.test.ts \
  packages/engine/src/brush/height-map.test.ts \
  packages/engine/src/brush/material-field.test.ts \
  packages/engine/src/brush/mixing.test.ts \
  packages/engine/src/brush/pressure-smoothing.test.ts \
  packages/engine/src/brush/prng.test.ts \
  packages/engine/src/brush/scheduler.test.ts \
  packages/engine/src/brush/state.test.ts \
  packages/engine/src/brush/gpu/accelerator-pending-commit.test.ts \
  packages/engine/src/brush/gpu/accelerator.test.ts \
  packages/engine/src/brush/gpu/deferred-commit.test.ts \
  -t '^(?!.*(?:exports and imports document snapshot|mixing state clone|bristle surface grain|prepareBristleMixingInterpolationProfiles))'
```

## セルフレビューとdocsとの差異

planning-flow / review-library-usageに沿い、engineのtypes.md・brush-api.md・README、input/strokeのREADME、usePenSettings・既存の設定更新経路・branch clone・pending no-opを確認。公開型・既定値・方向の保存契約はdocsと一致。cuspの閾値式、frameSignの決め方、lagの回転式、dropout・紙目・混色の意味論は変更していない。docs変更なし、今回の設計との差異なし。

## 未実行テスト名と残る検収

ユーザー指定どおりbrowser runnerは実行していない。CPU/WebGL2実ブラウザでの横ブレ比較、DebugPanel操作の目視確認、browserのフル検収は未実施。

以下はroot Vitest設定の全収集テストと今回Nodeで成功したテストとの差分。Canvas/WebGL依存ファイル内の未選別の純粋関数ケースも含み、全件を実行不能と診断したものではない。`persistence > exports and imports document snapshot`もCanvas依存で未実行。

### `packages/engine/src/brush/bristle-mask.test.ts`

- `bristle surface grain > 初回の未着彩cellへalpha floorを加えない`
- `bristle surface grain > uses pixel-local pressure as contact against the Fine tooth height field`
- `bristle surface grain > is deterministic for the same document origin, seed, and pressure`
- `bristle surface grain > adds opaque contact opportunities when one stroke revisits a surface`

### `packages/engine/src/brush/bristle-mixing-interpolation.test.ts`

- `bristle perFlush run color interpolation > cpu forward keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation > cpu reverse keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation > cpu vertical keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation > webgl2 forward keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation > webgl2 reverse keeps adjacent centerline redness within 8/255 after a red band`
- `bristle perFlush run color interpolation > webgl2 vertical keeps adjacent centerline redness within 8/255 after a red band`

### `packages/engine/src/brush/bristle.test.ts`

- `bristle brush > size=0 uses calculateRadius for the rendered sweep width`
- `bristle brush > size=1 uses calculateRadius for the rendered sweep width`
- `bristle brush > 連続sweepで長いストロークを列方向に分断しない`
- `bristle brush > 筆圧は外形幅をほぼ維持したまま着彩面積を増やす`
- `bristle brush > 同じ入力とseedから同じ描画結果を得る`
- `bristle brush > incremental chunkとfull replayのcoverageを近似一致させる`
- `bristle brush > 反復接触で同じgrainの低着彩部が段階的に埋まる`
- `bristle brush > mixing有効時は描画先と異なるstroke開始snapshotを要求する`
- `bristle brush > mixing状態を更新し同一strokeの次区間へ引き継ぐ`
- `bristle brush > 複数checkpointのreadbackをflushあたり2回に束ねる`

### `packages/engine/src/brush/gpu/accelerator.browser.test.ts`

- `BrushAccelerator browser lifecycle > Chromium の auto backend は null`
- `BrushAccelerator browser lifecycle > dispose 後の beginStroke は false`
- `BrushAccelerator browser lifecycle > maxBranches を stroke 適格判定に使う`
- `BrushAccelerator browser lifecycle > warmUp で residency hit、invalidate で miss になる`
- `BrushAccelerator browser lifecycle > context lost 後の beginStroke は false`

### `packages/engine/src/brush/gpu/bristle-pass.test.ts`

- `GPU bristle mask parity > 'left-to-right' mixing keeps picked-up band color on the touched side within Tier B`
- `GPU bristle mask parity > 'right-to-left' mixing keeps picked-up band color on the touched side within Tier B`
- `GPU bristle mask parity > matches CPU mask with dropout=+0 size=+0`
- `GPU bristle mask parity > matches CPU mask with dropout=+0 size=1`
- `GPU bristle mask parity > matches CPU mask with dropout=1 size=+0`
- `GPU bristle mask parity > matches CPU mask with dropout=1 size=1`
- `GPU bristle mask parity > matches CPU external 64x32 tooth maps at scale=1, including negative coordinates`
- `GPU bristle mask parity > matches CPU external 64x32 tooth maps at scale=2, including negative coordinates`
- `GPU bristle mask parity > reports procedural simple mask parity and stays deterministic`
- `GPU bristle mask parity > keeps incremental chunks within Tier B: dropout=+0 size=+0`
- `GPU bristle mask parity > keeps incremental chunks within Tier B: dropout=+0 size=1`
- `GPU bristle mask parity > keeps incremental chunks within Tier B: dropout=1 size=+0`
- `GPU bristle mask parity > keeps incremental chunks within Tier B: dropout=1 size=1`
- `GPU bristle mask parity > does not generate or upload a CPU mask field in the GPU path`

### `packages/engine/src/brush/gpu/deferred-commit.browser.test.ts`

- `deferred bitmap commit pixel contract > pending → endStroke is byte-identical to synchronous bitmap commit`
- `deferred bitmap commit pixel contract > pending → drainPendingCommit is byte-identical to synchronous bitmap commit`
- `deferred bitmap commit pixel contract > pending → dispose is byte-identical to synchronous bitmap commit`
- `deferred bitmap commit pixel contract > poll completion (or bounded drain) is byte-identical to synchronous commit`
- `deferred bitmap commit pixel contract > next flush drains the old canvas and preserves both commits byte-for-byte`
- `deferred bitmap commit pixel contract > cancel clears pending and restores the pre-stroke bytes including uncommitted dabs`
- `deferred bitmap commit pixel contract > retained undo after draining pending restores the pre-stroke bytes synchronously`

### `packages/engine/src/brush/gpu/gpu-stroke-surface.test.ts`

- `GpuStrokeSurface > bristle chunk の重複 mask を MAX 蓄積して layer に commit する`
- `GpuStrokeSurface > perFlush は複数 bristle run を一つの atlas/composite にまとめる`
- `GpuStrokeSurface > perFlush composite は flush 前後の field を距離進行度で補間する`
- `GpuStrokeSurface > perFlush の flush-start sample は texture swap 後も現在の accum を参照する`
- `GpuStrokeSurface > perFlush field は各 bristle run の checkpoint geometry を積分する`
- `GpuStrokeSurface > 単色 field と円 tip の dab を layer に commit する`
- `GpuStrokeSurface > branch ごとの field を独立保持し branch 順に重ねる`
- `GpuStrokeSurface > 全 branch の snapshot を参照して 2D strip を 1 pass で更新する`
- `GpuStrokeSurface > field strip は小さい stroke に切り替えても縮小再確保しない`
- `GpuStrokeSurface > field update は live accum ではなく直近の checkpoint snapshot を読む`
- `GpuStrokeSurface > field update pass が CPU sampling/mix/restore/diffusion と一致する`
- `GpuStrokeSurface > branch 1 の 10 回連続 field update が CPU と一致する`
- `GpuStrokeSurface > strip field の dab 補間が Canvas2D の field 拡大と一致する`
- `GpuStrokeSurface > 2 batch 連続 commit で最初の deposit と layer の他領域を維持する`
- `GpuStrokeSurface > 複数 batch の commit と未 commit dab を base から byte 一致復元する`
- `GpuStrokeSurface > commit 前に accum へ flush 済みの dab も cancel で消す`
- `GpuStrokeSurface > 512px を超える dirty rect を分割 commit して layer 全域を保つ`
- `GpuStrokeSurface > transferToImageBitmapが0寸法を返したらWebGL canvas直接描画へfallbackする`
- `GpuStrokeSurface > direct commit は transferToImageBitmap を使わずWebGL canvasを描画する`
- `GpuStrokeSurface > ImageBitmapのdrawImageが例外ならWebGL canvas直接描画へfallbackする`
- `GpuStrokeSurface > radial 4 Expand の branch 別 commit が従来の union commit と byte-identical`

### `packages/engine/src/brush/gpu/per-flush-checkpoint-verification.test.ts`

- `checkpoint alpha-weighted interpolation > stamp sampler preserves yellow RGB and half alpha at a transparent boundary`
- `checkpoint alpha-weighted interpolation > carried sampler preserves yellow RGB and half alpha at a transparent boundary`
- `checkpoint alpha-weighted interpolation > flush-start sampler preserves yellow RGB and half alpha at a transparent boundary`
- `checkpoint alpha-weighted interpolation > stamp checkpoint pickup matches CPU at a transparent yellow boundary`
- `checkpoint alpha-weighted interpolation > carried checkpoint pickup matches CPU at a transparent yellow boundary`
- `checkpoint alpha-weighted interpolation > flush-start checkpoint pickup matches CPU at a transparent yellow boundary`
- `perFlush carried checkpoint parity contract > 'unchanged substrate'`
- `perFlush carried checkpoint parity contract > 'no in-flush checkpoint'`
- `perFlush carried checkpoint parity contract > 'carried white vs flush-start black'`
- `perFlush carried checkpoint parity contract > matches with saturated early pickup and a short tail`
- `perFlush checkpoint copy elision > copies only the last checkpoint per branch (1 branches), at its composite`
- `perFlush checkpoint copy elision > copies only the last checkpoint per branch (2 branches), at its composite`

### `packages/engine/src/brush/mixing.test.ts`

- `prepareBristleMixingInterpolationProfiles > matches an independently uploaded material profile`
- `prepareBristleMixingInterpolationProfiles > shares run endpoints and uses one end profile below one byte of weight`

### `packages/engine/src/brush/spray.test.ts`

- `spray brush > 決定論性: チャンク分割描画と一括描画のピクセルが一致する`
- `spray brush > 粒子数が散布半径の面積におおむね比例する`
- `spray brush > pressureDynamics.density = 1 では低筆圧の粒子数が減る`
- `spray brush > radialDistribution の恒等カーブは面積あたり密度をほぼ一様にする`
- `spray brush > radialDistribution の中央寄せ密度プロファイルは中心密度を上げる`
- `spray brush > radialDistribution のリング状密度プロファイルは中間リングを最密にする`
- `spray brush > radialDistribution の全ゼロ密度は一様円盤へフォールバックする`
- `spray brush > sizeJitterMode=lognormal は同seedで決定論性を保つ`
- `spray brush > sizeJitterMode=bimodal は同seedで決定論性を保つ`
- `spray brush > 極端なパラメータでは粒子数を SPRAY_MAX_PARTICLES_PER_EMISSION にクランプする`
- `spray brush > 同じ state から pending を2回再描画しても結果が二重化しない`
- `spray brush > radial Expand の branch ごとに同数の粒子を描画する`
- `spray brush > round-pen では spray state を要求しない`

### `packages/engine/src/brush/stamp.test.ts`

- `renderBrushStroke > round-pen > round-pen で描画すると BrushRenderState を返す`
- `renderBrushStroke > round-pen > round-pen で渡した state がそのまま返される`
- `renderBrushStroke > stamp brush > スタンプブラシで描画すると accumulatedDistance が更新される`
- `renderBrushStroke > stamp brush > 低筆圧では実効tip径へのspacing追従により点線化を抑える`
- `renderBrushStroke > stamp brush > tipCanvas が null の場合は描画をスキップする`
- `renderBrushStroke > stamp brush > 連続呼び出しで accumulatedDistance が累積する`
- `renderBrushStroke > stamp brush > 決定論性: 同じ入力から同じ描画結果が得られる`
- `renderBrushStroke > stamp brush > 吹きつけ有効時は同一座標でも時間経過で描画が濃くなる`
- `renderBrushStroke > stamp brush > スタンプがキャンバスに実際に描画されている`
- `renderBrushStroke > stamp brush > 1点だけのスタンプストロークでも開始点に描画する`
- `renderBrushStroke > stamp brush > overlap 文脈だけの単一点では重複スタンプを打たない`
- `renderBrushStroke > stamp brush > jitter パラメータが描画結果に影響する`
- `renderBrushStroke > stamp brush > pressureDynamics.flow でスタンプの不透明度が変わる`
- `renderBrushStroke > stamp brush > incremental（overlap 付き）と replay で emissionCount が一致する`
- `renderBrushStroke > stamp brush > 筆圧平滑化状態はincrementalとreplayで一致する`
- `renderBrushStroke > stamp brush > 混色は現在dabを元色でdepositし、次位置用fieldへ局所色差を保持する`
- `renderBrushStroke > stamp brush > 混色には描画先と独立したstroke-start sourceLayerを要求する`
- `renderBrushStroke > stamp brush > 局所色を接触前方へ漏らさず進行方向の後方へ引く`
- `renderBrushStroke > stamp brush > 描画済み色の再取得checkpointはlayer全体ではなく有限tileを保持する`
- `renderBrushStroke > stamp brush > 混色更新はupdateDistanceごとに次のdabへ反映される`

### `packages/engine/src/brush/state.test.ts`

- `brush render state > mixing state clone はnumeric fieldとcanvas ownershipを分離する`

### `packages/engine/src/brush/tip.test.ts`

- `generateBrushTip > circle tip > hard circle (hardness=1.0) は指定サイズの OffscreenCanvas を返す`
- `generateBrushTip > circle tip > hard circle は中心にピクセルが描画されている`
- `generateBrushTip > circle tip > soft circle (hardness=0.0) は中心が不透明で端が透明`
- `generateBrushTip > circle tip > 中間 hardness (0.5) は gradient stop が設定される`
- `generateBrushTip > circle tip > 色が正しく焼き込まれる`
- `generateBrushTip > image tip > registry が未指定の場合は例外を投げる`
- `generateBrushTip > image tip > imageId が見つからない場合は例外を投げる`
- `createBrushTipRegistry > set/get で画像を保存・取得できる`
- `createBrushTipRegistry > 未登録の imageId は undefined を返す`

### `packages/engine/src/content-bounds.test.ts`

- `getContentBounds > should return null for an empty layer`
- `getContentBounds > should return bounds for a single pixel`
- `getContentBounds > should return bounds for pixel at top-left corner`
- `getContentBounds > should return bounds for pixel at bottom-right corner`
- `getContentBounds > should return full bounds for fully filled layer`
- `getContentBounds > should return tight bounds for multiple pixels`
- `getContentBounds > should detect pixels with any non-zero RGBA component`
- `getContentBounds > should handle a horizontal line of pixels`
- `getContentBounds > should handle a vertical line of pixels`

### `packages/engine/src/draw.test.ts`

- `drawLine > should draw something on the layer`
- `drawLine > should draw a horizontal line`
- `drawLine > should draw a vertical line`
- `drawLine > should respect lineWidth parameter`
- `drawCircle > should draw a filled circle`
- `drawCircle > should draw at center`
- `drawCircle > larger radius should fill more pixels`
- `drawPath > should draw nothing for empty points`
- `drawPath > should draw a path through points`
- `evaluateParametricCurve > should be linear with default curve (y1=1/3, y2=2/3)`
- `evaluateParametricCurve > should produce soft curve with y1=1, y2=1`
- `evaluateParametricCurve > should produce hard curve with y1=0, y2=1/3`
- `evaluateParametricCurve > should always return 0 for input 0`
- `evaluateParametricCurve > should always return 1 for input 1`
- `interpolateStrokePoints with overlapCount > overlapCount=0 should produce same output as no overlapCount`
- `interpolateStrokePoints with overlapCount > overlapCount=3 with 4 points should skip first 2 segments and output from bridge`
- `interpolateStrokePoints with overlapCount > overlapCount >= points.length should output only last point`
- `interpolateStrokePoints with overlapCount > 1-point input should be unchanged regardless of overlapCount`
- `calculateRadius with pressureCurve > should apply pressure curve before calculating radius`
- `calculateRadius with pressureCurve > should not change radius when using default curve`

### `packages/engine/src/incremental-render.test.ts`

- `appendToCommittedLayer > should not modify layer when points are empty`
- `appendToCommittedLayer > should draw path on layer`
- `appendToCommittedLayer > should preserve existing drawing (append mode)`
- `appendToCommittedLayer > should draw with overlapCount > 0 (bridge segment)`
- `appendToCommittedLayer > overlapCount=0 should behave identically to no overlapCount`
- `appendToCommittedLayer > should constrain normal drawing to existing alpha when alpha locked`
- `appendToCommittedLayer > should erase normally when alpha locked`
- `renderPendingLayer > should clear and redraw`
- `renderPendingLayer > should clear layer when points are empty`
- `renderPendingLayer > mixing有効時はpendingを描かず既存previewもclearする`
- `renderPendingLayer > bristleはmixing設定に関係なくpendingを描かない`
- `composeLayers > should compose visible layers`
- `composeLayers > should skip invisible layers`
- `composeLayers > should apply view transform`
- `composeLayers > should apply pendingOverlay with pre-composite for opacity < 1`
- `composeLayers > should apply pendingOverlay with eraser (destination-out)`
- `composeLayers > should mask pendingOverlay with committed alpha when alpha locked`
- `composeLayers > should skip pre-composite when all settings are normal`
- `composeLayers > should apply blend mode with pre-composite`
- `composeLayers > renderLayers should mask pendingOverlay with committed alpha when alpha locked`

### `packages/engine/src/layer-collection.test.ts`

- `addLayer > should add layer at the end by default`
- `addLayer > should insert at specified index`
- `addLayer > should return new array without mutating original`
- `removeLayer > should remove layer by ID`
- `removeLayer > should return original array if ID not found`
- `findLayerById > should find layer by ID`
- `findLayerById > should return undefined for nonexistent ID`
- `getLayerIndex > should return correct index`
- `getLayerIndex > should return -1 for nonexistent ID`
- `moveLayer > should move layer from one position to another`
- `moveLayer > should return same array if fromIndex equals toIndex`
- `moveLayer > should return same array for out-of-bounds indices`
- `moveLayer > should preserve relative order of other elements`
- `updateLayerMeta > should update specified fields only`
- `updateLayerMeta > should return new array (immutable)`

### `packages/engine/src/layer-merge.test.ts`

- `mergeLayerDown > should burn source into target and normalize target meta`
- `mergeLayerDown > should apply opacity while burning hidden source pixels`

### `packages/engine/src/layer.test.ts`

- `createLayer > should create a layer with correct dimensions`
- `createLayer > should have default meta values`
- `createLayer > should accept custom meta values`
- `createLayer > should have canvas and ctx`
- `getPixel / setPixel > should initialize pixels to transparent`
- `getPixel / setPixel > should set and get pixel correctly`
- `getPixel / setPixel > should return transparent black for out-of-bounds getPixel`
- `getPixel / setPixel > should ignore out-of-bounds setPixel`
- `getImageData > should return correct ImageData`
- `clearLayer > should clear all pixels`
- `cloneLayer / copyLayerPixels > should copy pixels and meta with overrides`
- `cloneLayer / copyLayerPixels > should clear target before copying pixels`

### `packages/engine/src/pattern-preview.test.ts`

- `createPatternTile > should return null when mode is none`
- `createPatternTile > should return null when no visible layers`
- `createPatternTile > should include background color when background is provided`
- `createPatternTile > should not include background when background.visible is false`
- `createPatternTile > should apply compositeOperation when compositing layers`
- `createPatternTile > should produce different results with vs without background for blend modes`
- `createPatternTile > should apply layer opacity in tile`
- `renderPatternPreview > should render repeated tiles only outside the original layer area`
- `renderPatternPreview > should keep offset grid rows visible outside the clipped layer area`

### `packages/engine/src/transform-layer.test.ts`

- `transformLayer > should be no-op with identity matrix`
- `transformLayer > should translate pixel by (dx, dy)`
- `transformLayer > should clip content that moves outside layer bounds`
- `transformLayer > should scale layer content`
- `transformLayer > should reuse provided temp canvas`
- `transformLayer > should resize temp canvas if size does not match`
- `transformLayer > should handle multiple pixels translation`

### `packages/engine/src/wrap-shift.test.ts`

- `wrapShiftLayer > should be no-op when dx and dy are zero`
- `wrapShiftLayer > should be no-op when shift is a multiple of layer size`
- `wrapShiftLayer > should shift pixel right by dx`
- `wrapShiftLayer > should shift pixel down by dy`
- `wrapShiftLayer > should wrap pixel around horizontally`
- `wrapShiftLayer > should wrap pixel around vertically`
- `wrapShiftLayer > should handle negative shifts`
- `wrapShiftLayer > should be reversible: shift(+dx) then shift(-dx) = identity`
- `wrapShiftLayer > should support cumulative shifts`
- `wrapShiftLayer > should reuse provided temp canvas`
- `wrapShiftLayer > should resize temp canvas if size does not match`

### `packages/perf-debug.test.ts`

- `brush perf batch stalls > 閾値超過と stroke 開始時の再確保だけを記録する`
- `brush perf batch stalls > リングバッファを最新 32 batch に制限する`
- `brush perf null stages > Rough の field / contact / raster / drawSweep を独立に置換する`
- `brush perf null stages > Acrylic の checkpoint / field advance / upload を置換する`
- `brush perf null stages > nullFullCopy は sampling copy を 0 pixel にして same-canvas を局所 bypass する`

### `packages/react/src/persistence.test.ts`

- `persistence > exports and imports document snapshot`

### `packages/react/src/usePaintEngine.test.ts`

- `usePaintEngine GPU undo-1 integration > bitmap: preserves runtime command identity and hits undo through the React hook`
- `usePaintEngine GPU undo-1 integration > direct: preserves runtime command identity and hits undo through the React hook`

### `packages/stroke/src/command-executor.test.ts`

- `command executor > undoes wrap-shift by shifting every layer in the opposite direction`
- `command executor > redoes wrap-shift by shifting every layer in the recorded direction`
- `command executor > rebuilds affected layers for a normal draw undo and returns visibility fixes`
- `command executor > interrupts a normal draw redo when rebuild fails`
- `command executor > undoes add-layer with a remove list op and nearest active hint`
- `command executor > redoes add-layer by recreating the recorded layer id and inserting it`
- `command executor > undoes remove-layer by recreating, rebuilding, inserting, and activating the removed layer`
- `command executor > interrupts remove-layer undo when the removed layer lacks a checkpoint`
- `command executor > redoes remove-layer with a remove list op and nearest active hint`
- `command executor > undoes reorder-layer by moving from the recorded target index back to the source index`
- `command executor > redoes reorder-layer by moving from the recorded source index to the target index`
- `command executor > undoes duplicate-layer by removing the duplicate and activating the source`
- `command executor > redoes duplicate-layer by applying the command and returning a replace list op`
- `command executor > interrupts duplicate-layer redo when the recorded command cannot be applied`
- `command executor > undoes merge-layer-down by recreating the source, restoring target meta, rebuilding both, and inserting source`
- `command executor > redoes merge-layer-down by applying the command and returning a replace list op`
- `command executor > interrupts merge-layer-down redo when the recorded topology does not match`
- `command executor > maps custom command undo and redo outcomes into executor results`
- `command executor > interrupts custom commands when no custom executor is injected`
- `command executor > interrupts custom commands when the injected executor fails`
- `command executor > resolves push persistence events for draw, structural, and custom commands`

### `packages/stroke/src/gpu-residency.test.ts`

- `GPU layer residency > 筆圧で stampSize が変化しても snapshot array を stroke 中に再確保しない`
- `GPU layer residency > 連続する2本目のGPU strokeでuploadを省略し、毎回uploadとpixel一致する`
- `GPU layer residency > residency hit の通常 stroke は layer pixel を読み出さない`
- `GPU layer residency > radial 4 Expand と併用して連続する2本目が residency hit する`
- `GPU layer residency > 間のCPU strokeで無効化し、次のGPU strokeを再uploadしてpixel一致する`
- `GPU layer residency > GPU stroke x3 のUndo rebuild後は次のGPU strokeがhitし、常駐無効時とbyte一致する`
- `GPU layer residency > 通常 GPU stroke の cancel は history 復元せず byte 一致し次 stroke も residency hit する`
- `GPU layer residency > radial 4 Expand GPU stroke の cancel は history 復元せず byte 一致し次 stroke も residency hit する`
- `GPU layer residency > React Undoボタン順序のcancel→restore→undo→遅延end後もownerを残さず次がhitする`
- `GPU layer residency > strokeStart stallに直前のresidency invalidation reasonを含める`
- `GPU layer residency > stale owner回復eventに開始経路・開始時刻・回復経路を含める`
- `GPU layer residency > GPU→CPU strokeのUndoでcheckpoint復元後のGPU replayを常駐維持する`
- `GPU layer residency > CPU→GPU strokeのUndoでCPU replayが最後なら次のGPU strokeはmissする`
- `GPU layer residency > 4本のAcrylic hatchをUndo→RedoしてもUndoなしのlayerとbyte一致する`
- `GPU layer residency > dirty rectが1024²を超える単一Acrylic strokeのRedoを複数passでbyte一致commitする`

### `packages/stroke/src/parity.test.ts`

- `live-vs-replay parity > round-pen basic: live vs replay`
- `live-vs-replay parity > round-pen basic: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity > round-pen basic: redo rebuild matches replay`
- `live-vs-replay parity > round-pen eraser: live vs replay`
- `live-vs-replay parity > round-pen eraser: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity > round-pen eraser: redo rebuild matches replay`
- `live-vs-replay parity > round-pen alpha lock: live vs replay`
- `live-vs-replay parity > round-pen alpha lock: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity > round-pen alpha lock: redo rebuild matches replay`
- `live-vs-replay parity > stamp jitter: live vs replay`
- `live-vs-replay parity > stamp jitter: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity > stamp jitter: redo rebuild matches replay`
- `live-vs-replay parity > stamp mixing: live vs replay`
- `live-vs-replay parity > stamp mixing: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity > stamp mixing: redo rebuild matches replay`
- `live-vs-replay parity > rough bristle mixing: live vs replay`
- `live-vs-replay parity > rough bristle mixing: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity > rough bristle mixing: redo rebuild matches replay`
- `live-vs-replay parity > spray lognormal: live vs replay`
- `live-vs-replay parity > spray lognormal: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity > spray lognormal: redo rebuild matches replay`
- `live-vs-replay parity > spray bimodal: live vs replay`
- `live-vs-replay parity > spray bimodal: undo rebuild matches pre-stroke pixels`
- `live-vs-replay parity > spray bimodal: redo rebuild matches replay`
- `GPU mixing feedMany parity > 複数 batch と replay 相当の単一 batch が byte-identical`
- `GPU undo-1 cache byte parity > stamp replay: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > stamp replay: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > stamp replay: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > stamp radial checkpoint: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > stamp radial checkpoint: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > stamp radial checkpoint: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > rough replay: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > rough replay: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > rough replay: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > rough checkpoint: transparent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > rough checkpoint: opaque hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU undo-1 cache byte parity > rough checkpoint: translucent hit, next stroke, branch and deep undo match rebuild byte-for-byte`
- `GPU rough bristle parity > Rough mixing ON の CPU/GPU が Tier B parity を満たす`
- `GPU rough bristle parity > CPU perFlush mixing の live/replay/undo/redo が byte-identical`
- `GPU rough bristle parity > GPU perFlush mixing の live/replay/undo/redo が byte-identical`
- `GPU rough bristle parity > mixing OFF の live/replay/undo/redo が同一 backend 内で byte-identical`
- `GPU mixing lifecycle fallback > runtimeはWEBGL_lose_context後にhistory復元してCPUで全入力を再実行する`
- `GPU mixing lifecycle fallback > GPU stroke の cancel 中に context lost なら従来の layer 復元へ fallback する`
- `GPU mixing lifecycle fallback > runtimeはstroke途中のaccelerator dispose後にhistory復元してCPUで全入力を再実行する`
- `GPU mixing lifecycle fallback > incremental renderer直接利用は復元せず現在layer上でCPU全入力を再描画する`
- `GPU mixing lifecycle fallback > dispose済みacceleratorはstroke全体をCPU経路で描く`
- `GPU mixing Expand parity > radial 2 の branch field が 5 update ごとに CPU と一致する`
- `GPU mixing Expand parity > radial 4 の中心重なり fixture が CPU と Tier B alpha parity を満たす`
- `GPU mixing Expand parity > radial 4 の live 分割 batch と replay 相当単一 batch が byte-identical`
- `GPU mixing Expand parity > radial 4 の live stroke と command replay が byte-identical`
- `GPU mixing Expand parity > radial 64 が GPU を使い live/replay byte 一致と CPU Tier B parity を満たす`
- `GPU mixing Expand parity > radial 65 は supportsBranchCount=false となり CPU fallback する`

### `packages/stroke/src/stroke-runtime-gpu-commit.test.ts`

- `stroke runtime deferred GPU commit polling (no browser) > reschedules TIMEOUT then requests a render when transfer completes`
- `stroke runtime deferred GPU commit polling (no browser) > drains after eight unsuccessful polls and stops scheduling`
- `stroke runtime deferred GPU commit polling (no browser) > end invalidates captured timer callbacks`
- `stroke runtime deferred GPU commit polling (no browser) > cancel invalidates captured timer callbacks`
- `stroke runtime deferred GPU commit polling (no browser) > dispose invalidates captured timer callbacks`
- `stroke runtime deferred GPU commit polling (no browser) > a replacement flush cancels the old timer and resets its poll budget`
- `stroke runtime deferred GPU commit polling (no browser) > zero-returning inert timers still allow synchronous finalization`
- `stroke runtime deferred GPU commit polling (no browser) > final cadence does not defer or schedule polling even with the callback installed`

### `packages/stroke/src/stroke-runtime.test.ts`

- `stroke-runtime > coalesced input batches > keeps every point and matches sequential rendering`
- `stroke-runtime > coalesced input batches > keeps rough bristle pixels independent of caller batch boundaries`
- `stroke-runtime > emission > does not fire while input arrives faster than the interval`
- `stroke-runtime > emission > keeps firing while the pointer is stationary and records synthetic points`
- `stroke-runtime > emission > does not fire after end, cancel, or dispose`
- `stroke-runtime > lifecycle > does not fire timers after dispose`
- `stroke-runtime > lifecycle > keeps two runtime instances isolated`
- `stroke-runtime > lifecycle > restores the previous snapshot when start is called while active`
- `stroke-runtime > commit > passes inputPoints, brushSeed, and alphaLocked to onCommit`

