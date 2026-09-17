# Phase 3 タスク A 実装報告（2026-09-06）

simple dropout mask + perFlush へ一本化した。コミットしていない。作業開始時から存在した `packages/*/docs` の変更、および `packages/engine/src/types.ts` は全て SHA-256 一致を確認（計29ファイル）。停止条件に該当する公開型への波及はない。

## 削除・変更したシンボル

- CPU: `createBristleMaskField`、`createBristleMaskFieldUnmeasured`、`BristleMaskField`、`sampleFieldDistance`、`BristleMaskMode`、`readBristleMaskModeDebugFlag`、`readBristleLowPressureGainDebugFlag`。detail / micro octave の旧評価を削除。
- CPU の唯一の評価器は `createSimpleBristleMaskEvaluator`。低筆圧係数は非公開の `SIMPLE_MASK_LOW_PRESSURE_GAIN = 0.9`。CPU / shader に相互参照コメントを付けた。
- テスト用 raster 関数を `rasterizeBristleMaskFieldForTest` → `rasterizeBristleMaskEvaluatorForTest`、内部関数を `rasterizeBristleMaskFieldIntoCanvas` → `rasterizeBristleMaskIntoCanvas` に変更。
- GPU chunk: `maskField`、`maskFieldColumns`、`maskFieldRows`、segment の `fromFieldColumn` / `toFieldColumn` を削除。`GpuBristleChunk.simpleMask` は必須。
- GPU pass: `maskFieldTexture` と寸法・origin 管理、`uploadMaskFields`、旧 texture 制限に基づく atlas 分割、mask 用 field uniform を削除。
- shader: `uMaskField`、`uMaskFieldTextureSize`、`uMaskFieldOrigin`、mask shader の `uFieldSize`、`sampleField`、`uSimpleMask`、`uLowPressureGain` を削除。`aFieldCoord` / `vFieldCoord` は `aStrokeCoord` / `vStrokeCoord` に改名し `(distance, crossPx)` 専用化。
- cadence: `BristleFieldCadence`、`bristleFieldCadence`、`readBristleFieldCadenceDebugFlag`、constructor / factory の cadence 引数、perRun 専用の即時更新・即時描画・checkpoint capture 分岐を削除。不要になった `singleFieldUpdateBatch` / `drawBristleChunks` も削除。
- `drawPerRunBranchSegments` は bristle のない場合の stamp fallback にも使われていたため、`drawStampBranchSegments` に改名して stamp の処理順を維持した。
- App の `gpuBristleField`、`bristleMask`、`bristleLowP` URL 処理と、対応する3 global 設定を削除。`gpuBackend` / `gpuCommit` / `perfDebug` は維持。

## 残した互換フィールド・処理

- `BristleDynamics.edgeTextureAmount` / `edgeTextureLengthPx`: 公開型と既定値を維持。mask 評価では使わない。
- `BristleDynamics.transverseMaskCellPx`: CPU evaluator の横断補間座標 `v` のスケール（`rows` / `height`）として維持。grid の値配列は不要。pixel 評価なので空間解像度を決めない。
- 公開 API・型定義、material field の列・行・texture、Fine tooth height tile、既存 perfDebug を維持。
- perfDebug の stage 名 `maskField` と sample 名 `fieldCells` は既存計測 schema として残した。GPU テストで count=0 / samples=[] を確認するためのもので、旧 mask field 実装や upload は残っていない。
- mask / ink / composite の描画構成、simple の atlas 分割、perFlush 内の pickup / composite / diffusion 順、checkpoint の位置・コピー規則、stroke の 32ms / 1.5×lineWidth flush 規則は変更していない。

## テスト変更と理由

| ファイル | 変更・理由 |
|---|---|
| `packages/engine/src/brush/bristle-mask.test.ts` | global stub を削除。可変 gain のテストを固定 0.9 と補間後 pressure clamp の検証へ変更。coverage=0 を中立比較に使い、期待差を ±0.45 とした。既存の simple 決定性・横断スケール不変性・紙目テストを維持。 |
| `packages/engine/src/brush/gpu/accelerator.test.ts` | perRun 強制テスト1件を削除。global 初期化と factory 引数の cadence 期待値を削除。bitmap / direct の検証は維持。 |
| `packages/engine/src/brush/gpu/bristle-pass.test.ts` | 旧 field parity ケースを simple evaluator / simple chunk へ変更。Tier B 閾値は維持。warmup は atlas 拡大を維持して field texture 拡大だけ削除。既存 simple ケース・CPU mask 生成無しの検証から旧 field/global を除去。 |
| `packages/engine/src/brush/gpu/gpu-stroke-surface.test.ts` | field chunk を simple に変更。MAX 蓄積テストはほぼ一定の broad noise と2筆圧で元の signed distance ±0.0031 を作り、既存 alpha 範囲の期待値を維持。perRun 比較は既存 CPU `sampleRotatedCheckpoint` / `advanceMaterialField` による期待値へ変更し、checkpoint geometry と pass 数の検証を維持。cadence 引数を削除。 |
| `packages/engine/src/brush/gpu/per-flush-checkpoint-verification.test.ts` | 追加の旧 field 利用箇所。必須 simpleMask 化と cadence 引数削除に追従。長い noise 相関長で従来の不透明 fixture を維持。checkpoint parity 閾値、期待値、copy 回数・順序の検証は変更していない。 |
| `packages/stroke/src/parity.test.ts` | perFlush global の設定・復元だけ削除。fixture、期待値、比較ロジックは変更していない。 |

`keeps incremental rough bristle chunks within Tier B` と `mixing keeps picked-up band color on the touched side within Tier B` の検証内容、alphaMae ≤ 0.015 等の Tier B 閾値・比較関数、cross-backend fixture を維持し、差分を確認した。削除したテストケースは accelerator の perRun 強制1件のみ。

## コマンドと結果

- `pnpm -r build`: exit 0。ログに型エラー・warning 表示なし。
- `pnpm lint`: exit 0。197 files checked、修正なし。
- `pnpm run typecheck`: exit 0。
- `git diff --check`: exit 0。
- `pnpm exec vitest run --browser.enabled=false packages/engine packages/stroke`: exit 1。40ファイル中16成功・24失敗、520テスト中243成功・277失敗。ブラウザ依存テストも Node で収集される設定のため、OffscreenCanvas / WebGL2 不在で失敗する。Canvas 不在に伴う例外期待の不一致や accelerator=null の失敗も含む。このコマンド全体を「通過」とは扱っていない。
- 下記ノンブラウザ16ファイルに限定したコマンド: exit 0、213/213成功。
- `pnpm exec vitest run --browser.enabled=false packages/engine/src/brush/bristle-mask.test.ts -t 'simple bristle mask evaluator'`: exit 0、4成功・紙目4件は選択対象外。

```sh
pnpm exec vitest run --browser.enabled=false \
  packages/engine/src/brush/gpu/accelerator.test.ts \
  packages/engine/src/brush/material-field.test.ts \
  packages/engine/src/brush/pressure-smoothing.test.ts \
  packages/engine/src/brush/prng.test.ts \
  packages/engine/src/brush/scheduler.test.ts \
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
  packages/stroke/src/types.test.ts
```

## ブラウザ依存部分を実行できなかったファイル

以下24ファイルには Node で検証できないケースがある（一部の純粋関数テストは成功）。browser mode と見た目の比較は今回実施しておらず、Claude の実ブラウザ検収に引き継ぐ。

```text
packages/engine/src/brush/bristle-mask.test.ts
packages/engine/src/brush/bristle.test.ts
packages/engine/src/brush/gpu/accelerator.browser.test.ts
packages/engine/src/brush/gpu/bristle-pass.test.ts
packages/engine/src/brush/gpu/gpu-stroke-surface.test.ts
packages/engine/src/brush/gpu/per-flush-checkpoint-verification.test.ts
packages/engine/src/brush/mixing.test.ts
packages/engine/src/brush/spray.test.ts
packages/engine/src/brush/stamp.test.ts
packages/engine/src/brush/state.test.ts
packages/engine/src/brush/tip.test.ts
packages/engine/src/content-bounds.test.ts
packages/engine/src/draw.test.ts
packages/engine/src/incremental-render.test.ts
packages/engine/src/layer-collection.test.ts
packages/engine/src/layer-merge.test.ts
packages/engine/src/layer.test.ts
packages/engine/src/pattern-preview.test.ts
packages/engine/src/transform-layer.test.ts
packages/engine/src/wrap-shift.test.ts
packages/stroke/src/command-executor.test.ts
packages/stroke/src/gpu-residency.test.ts
packages/stroke/src/parity.test.ts
packages/stroke/src/stroke-runtime.test.ts
```

## grep 結果

```sh
rg -n '__headlessPaintBristleMask|__headlessPaintBristleLowPressureGain|__headlessPaintGpuBristleField' packages/*/src apps
```

0件（exit 1）。削除した CPU field / mode / cadence 型・関数、GPU field 属性・uniform / upload 関数についても同範囲で0件。`perRun` も0件。

`rg -n '\bmaskField\b' packages/*/src apps` は2件のみ:

- `packages/engine/src/brush/perf-debug.ts`: stage 名。
- `packages/engine/src/brush/gpu/bristle-pass.test.ts`: stage count=0 の期待値。

## セルフレビュー・引き継ぎ

planning-flow / review-library-usage を適用。engine / input / stroke の docs README と engine の brush-api / types / gpu-acceleration を参照し、内部責務・公開型不変・simple 評価式・perFlush 処理の差分を確認した。

ドキュメント側への補足候補（docs は編集していない）: `gpu-acceleration.md` の「同一 flush 内の pickup が読む画素は flush 開始時点の accum」は、前 flush から持ち越した checkpoint を最初の run が読む例外を併記すると正確。既存の `per-flush-checkpoint-verification.test.ts` がこの契約を検証しており、今回その挙動は変更していない。

実装・静的検査・実行可能なノンブラウザ検証まで完了。実ブラウザでの Tier B / checkpoint / MAX 蓄積テスト、見た目・性能の最終検収は未完了。
