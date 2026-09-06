# Rough bristle GPU 加速の正式化（experiment → feature）

## Context

`experiment/bristle-gpu`（25 commits）+ 子ブランチ `experiment/bristle-mask-simplify`（20 commits）で、Rough bristle の WebGL2 加速を spike から詰めてきた。確定済み: simple dropout mask（係数 0.9）既定、perFlush 混色意味論の CPU/GPU 統一、undo-1 GPU キャッシュ、WebKit bitmap commit の `gl.finish` 同期、composite の field 座標修正。iPad 実機と 617 tests で green。

残っているのは「spike の痕跡」の整理と正本ドキュメント化。具体的には URL クエリ → `globalThis.__headlessPaint*` で切り替える比較用経路（旧 field mask / perRun cadence / 低筆圧係数）が production コードに残り、`gpu-acceleration.md` はいまだに「Rough bristle は対象外」と書いてある。これを planning-flow の Doc-First で正式化し、`experiment/bristle-gpu` へ ff して `feature/acrylic-v2-production` へ PR を出す。

ユーザー決定（2026-09-06）: 旧 field 経路は削除 / perRun は削除 / 係数 0.9 は内部定数 / 統合は bristle-gpu へ ff → PR 1 本。

計画ファイルは `plans/2026-09-06-15-17_bristle-gpu-formalize.md` に保存する（この内容を転記）。

## 外部 IF への影響（Phase 1 で確定するもの）

公開 API は **増やさない**。変更は「削るもの」と「ドキュメント化するもの」。

- 削る（engine 内部 / apps/web）: `__headlessPaintBristleMask` / `__headlessPaintBristleLowPressureGain` / `__headlessPaintGpuBristleField` の 3 global と `?bristleMask=` / `?bristleLowP=` / `?gpuBristleField=` の URL フラグ。`createBristleMaskField`（detail/micro 経路）と GPU の mask field texture upload（`maskField` / `maskFieldColumns` / `maskFieldRows` / `uMaskField` / `uploadMaskFields` / shader の `sampleField` 分岐）。`BristleFieldCadence` 型と `perRun` 分岐（`gpu-stroke-surface.ts` の `bristleFieldCadence` 比較 ≈10 箇所、`accelerator.ts` の `readBristleFieldCadenceDebugFlag`）
- 残す: `BrushAcceleratorOptions.commitMode`（既存デバッグ option、文書化済み）と `?gpuCommit=`、`?gpuBackend=`、`?perfDebug=`
- ドキュメント化する既存 IF: `BrushAccelerator` 内部 runtime の undo-1（`retainUndoSnapshot` / `bindUndoSnapshot` / `discardUndoSnapshot` / `restoreUndoSnapshot`、stroke 側 `gpu-undo-cache.ts` の `retainGpuUndo` / `bindGpuUndoHistory` / `getGpuUndoRuntime`）。公開 API ではない structural bridge だが、history との契約（command 同一性）は利用側に影響するので docs に載せる

## Phase 1: API 設計・ドキュメント（Claude が正本を書く）

1. `packages/engine/docs/gpu-acceleration.md`
   - 「GPU 経路の適格条件」: Rough bristle を追加（`brush.type === "bristle"`、mixing の有無を問わない、`source-over`、非 alphaLocked、branch 上限）。spray / 非混色 stamp は引き続き対象外
   - 「描画モデル」に bristle 節を追加: 3 pass（mask: simple dropout を shader 内で画素評価 + 紙目 / ink: profile atlas / composite: mask × ink × material）、chunk-local atlas、bbox、perFlush 意味論（flush = 32ms または 1.5×lineWidth。field を flush 単位で更新し composite が F0/F1 を run ごとの距離重みで mix。run 内は定数 = 既知の階段）、composite の field 参照 = run geometry の逆変換（既に 1 行あるものを節へ移動）、mixing OFF は field pass なし
   - 「常駐と無効化」または新節「undo-1 スナップショット」: stroke 開始時の accum を base texture として保持し、直前 1 手の undo は再生なしで復元。history が push した command オブジェクトの同一性が key（クローン・再生成すると静かに無効化）。2 手目以降は rebuild。全画面 texture は accum + base の 2 枚（4K で 128MB）
   - 「決定性と parity」: bristle は simple mask を CPU/GPU で同一式・画素評価にしたので Tier B 内（数値は §11 の実測）。WebKit の bitmap commit は `gl.finish` 同期が決定性の前提（既に option 説明にある文を節へ）
   - 「制限」: mixing の run 単位の色段差、透明下地の黒混入（CPU/GPU 共通、既知）を既知事項として明記
   - 「デバッグ」: 残す URL フラグのみ列挙し、削除したフラグには触れない
2. `packages/engine/docs/brush-api.md` L114-123 と `types.md` の `BristleDynamics` 説明: 「内部 debug 切替の field 経路」の記述を削除し、simple mask（broad noise 1 octave + 筆圧閾値、低筆圧係数 0.9 内部定数）に一本化。`transverseMaskCellPx` が CPU raster の band 解像度として残るかは Phase 3 で確認（simple 画素評価では rows にしか使っていない → 意味を正確に書く）
3. `packages/stroke/docs/history-api.md` に「GPU undo-1 と command 同一性」節、`stroke-machine.md` / `command-executor.md` の accelerator 説明に「undo-1 の restore / discard の発火点」を 1-2 行。`packages/react/docs/INTERNALS.md` は既に記載あり（整合確認のみ）
4. `packages/engine/docs/README.md` の `createBrushAccelerator` 行を「混色 stamp と Rough bristle」に更新

## Phase 2: 利用イメージレビュー

- apps/web: フラグ削除後の `App.tsx` 先頭（`gpuBackend` / `gpuCommit` / `perfDebug` のみ）と Debug Info 表示の利用例
- stroke → engine: `retainGpuUndo` → `bindGpuUndoHistory` → `restoreUndoSnapshot` の流れを history-api.md の例で提示し、「command はそのまま push」の契約が読めるか確認
- ユーザー承認後に Phase 3

## Phase 3: 実装（codex へ委譲、2 タスク直列）

**タスク A: 比較用経路の削除（engine + apps/web）**
- `bristle-mask.ts`: `createBristleMaskField` / `createBristleMaskFieldUnmeasured` / `readBristleMaskModeDebugFlag` / `readBristleLowPressureGainDebugFlag` を削除。simple 評価関数を唯一の経路にし、係数 0.9 を名前付き定数（例 `SIMPLE_MASK_LOW_PRESSURE_GAIN`）に
- `bristle.ts` L510 付近: simpleMask を常時生成、`field` 生成を削除
- `gpu-stroke-surface.ts` / `bristle-pass.ts` / `shader-sources.ts`: `maskField*` / `uMaskField` / `uploadMaskFields` / `sampleField` / `uSimpleMask` / `uLowPressureGain`（定数化）を削除。`GpuBristleChunk.simpleMask` は必須化するか chunk に直接持たせる
- `BristleFieldCadence` と `perRun` 分岐を削除（perFlush の挙動だけ残す）。`createGpuStrokeSurface` / `createBrushAccelerator` の引数から cadence を外す
- `apps/web/src/App.tsx` L40-67 のフラグ処理を削除
- テスト更新: `accelerator.test.ts` / `bristle-pass.test.ts` / `gpu-stroke-surface.test.ts` / `stroke/parity.test.ts` の perRun・field 参照を削除。**Tier B 閾値・比較ロジックは変更禁止**。`bristle-mask.test.ts` の field 経路テストは削除可
- 合格: build / lint / ノンブラウザ範囲。ブラウザ検収は Claude

**タスク B: ドキュメント→コードの整合**（Phase 1 のドキュメントに合わせた命名・コメント・`packages/engine/docs/types.md` の型記述）。小さければ A に含める

検収（Claude）: `pnpm -r build && pnpm test && pnpm lint`、`tools/bench/results` のランナーで (a) S 字 CPU vs GPU（`eval-shot.mjs`）が引き続き 0.01% 級、(b) アーチ両方向（scratchpad `arch.mjs`）で拾い色が触れた側、(c) 3 run byte 一致（WebKit bitmap）。probe6 で mixing OFF/ON の stroke 時間が削除前と同等（simple OFF ≈49ms / ON ≈109ms 級）

## Phase 4: アーキテクトレビュー

- 双方向整合: `gpu-acceleration.md` の適格条件・pass 構成・texture 枚数・undo-1 契約が `accelerator.ts` / `incremental-stroke.ts` / `gpu-undo-cache.ts` と一致。`brush-api.md` / `types.md` に field 経路の残骸がない
- `review-library-usage` skill でセルフレビュー
- `plans/2026-08-31-01-02_bristle-gpu-phase2.md` の引き継ぎ節を「正式化完了」に更新し、spike 中の経過（perRun / field / 係数振り）は「実装時の調整内容（補足）」に束ねる

## 統合

1. `experiment/bristle-mask-simplify` を `experiment/bristle-gpu` に fast-forward（`git merge --ff-only`）
2. `experiment/bristle-gpu` → `feature/acrylic-v2-production` の PR を `gh pr create`。本文: 効果（WebKit stroke 411 → 109ms mixing ON / 122 → 49ms OFF、undo-1 355 → 28ms、iPad tail latency）、契約変更（perFlush 意味論で replay 結果が微変 = リリースノート事項、simple mask 既定）、既知事項（色段差・黒混入）
3. コミット前にルートの `*.png` / `*.txt` が無いことを確認

## 検証方法（end-to-end）

- 自動: `pnpm -r build && pnpm test && pnpm lint`（chromium browser mode 込み）
- ランナー（dev server `pnpm dev` port 5174）: `STROKE=scurve GPU_BACKEND=webgl2 node tools/bench/results/eval-shot.mjs out.png` ×3 → `imgdiff.mjs` で run 間 0 / CPU 比 ≤0.1%。アーチ再現は scratchpad の `arch.mjs`（赤線 + 上半分だけ重なるアーチ、両方向）
- iPad: ユーザーが右→左 / 下→上の混色ストロークと undo 1 回目の体感を確認

## ペンディング（正式化の後ろに積む）

- 混色: 透明下地からの黒混入 / run 単位の色段差（agents-note 記載）
- `gl.finish` コストの削減（commit 頻度）
- vitest browser の webkit instance 追加検討（WebKit 固有バグの自動検出）
- CLAUDE.md / delegation skill の `--full-auto` → `-s workspace-write` 更新
