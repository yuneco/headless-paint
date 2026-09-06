# bristle 混色の run 内色補間（色の階段の解消）

## Context

perFlush 意味論では composite が F0（flush 開始時の field）と F1（更新後）を run ごとの距離重み `runEndDistance / totalDistance` で mix する。重みが run 内で定数のため、run 境界（≈ checkpoint 距離 36px ごと）で色が階段状に変わる（ユーザー報告 2026-09-06、CPU / GPU 共通）。stamp（Acrylic）は dab ごとに field を更新するため滑らか。

決定（ユーザー 2026-09-06）: GPU は composite で画素ごとに補間、CPU は run を開始重み / 終了重みの 2 profile で描いて run 始点→終点の線形グラデーションで blend する（案 1）。CPU 混色 ON の stroke は +10% 程度（Chromium 100 → 110ms 見込み）を許容。

## 外部 IF

公開 API・型・persisted 形式の変更なし。描画結果は混色 ON の bristle で変わる（リリースノート事項。perFlush 統一時と同じ扱い）。

## Phase 1: ドキュメント

- `packages/engine/docs/gpu-acceleration.md` perFlush 節: 「重みは run 内で定数」→「重みは run の開始値 w0 と終了値 w1 を run 内の進行率で線形補間する（GPU は run geometry の local.x から、CPU は run 始点→終点の直線グラデーション近似）」。制限節の「run 単位の色段差」を削除
- `packages/engine/docs/brush-api.md` 混色節: bristle の run 内補間を 1 行

## Phase 2: レビュー

codex read-only レビューで代替（ユーザー合意）。

## Phase 3: 実装（codex）

- GPU: composite に重み 2 値（`uFieldMixWeight` → `uFieldMixWeights = (w0, w1)` 等）と run の along 範囲（run 開始 / 終了の local.x）を渡し、`t = clamp((local.x − x0) / (x1 − x0))` で `mix(w0, w1, t)`。surface の composite target 構築（`compositedDistances` / `fieldMixWeight` の算出箇所）で w0 = 直前 run の終了重み、w1 = 現在の終了重み
- CPU: `prepareBristleMixingInterpolationProfiles` に run ごとの (w0, w1) を渡して開始 / 終了 profile を作り、`renderSweepRun` は ink を 2 回描いて（開始 profile / 終了 profile）run 始点→終点の `createLinearGradient` を alpha mask に blend する。|w1 − w0| < 1/255 の run は従来どおり 1 回描き
- テスト: 直線ストロークで赤帯を横切った後、ストローク沿いの色の変化が run 境界で不連続にならない（隣接画素列の色差の最大値が閾値以下）ことを CPU / GPU で検証。既存 Tier B / cross-backend parity と両方向の「触れた側」テストは閾値・ロジック変更禁止

## Phase 4: レビュー

ドキュメント↔コードの双方向確認、`review-library-usage`、probe6 で CPU 混色 ON の増分が +15% 以内であること。

## 実装結果（2026-09-06）

- GPU: composite に `uFieldMixWeights = (w0, w1)` と `uFieldMixSpan = (x0, x1)`（run の最初 / 最後の sweep segment を field geometry の逆変換にかけた local.x）を渡し、画素ごとに `mix(w0, w1, progress)`。追加 uniform 2 つ、pass 数不変
- CPU: run ごとに開始 / 終了 profile の 2 枚を用意し、ink を 2 回掃引して run 始点→終点の線形グラデーションで `(1 − t)·I0 + t·I1`（destination-out / destination-in + lighter）。endInk canvas は WeakMap で再利用
- 省略判定（差し戻し 2）: CPU は flush ごとに `max|F1 − F0|` を 1 回走査し `× |w1 − w0| < 1/255` なら 1 枚描き。GPU は重み差のみ（更新後 field を CPU 側が持たないため。出力差はどちらも ≤ 1/255）
- 性能（Chromium CPU、混色 ON、150 点、白地 = pickup なし）: 修正前 100ms → 補間実装 124〜129ms（+25%）→ canvas 再利用 121〜127ms → **色差ゲート 92〜98ms（修正前と同等）**。pickup が起きた flush だけ blend が走るので、実描画では色帯を横切った直後のみ +コスト（最悪ケースは全 run blend で +25%）。GPU（WebKit）は変化なし
- 見た目: 赤帯を横切った直線ストロークで run 境界の段が消え、CPU / GPU とも連続（画像を共有済み）
- テスト: 641 green。追加 `bristle-mixing-interpolation.test.ts`（CPU / GPU × 3 方向の赤み連続性）、`bristle-mixing-profile-selection.test.ts`（省略判定）

## 実装時の調整内容（補足）

- 差し戻し 1（canvas 再利用・fill 範囲縮小）は software raster では効かなかった（gradient fill と lighter 合成の画素コストが本体）。差し戻し 2 の色差ゲートで解決
- codex の報告: `plans/notes/2026-09-06-bristle-mixing-run-interpolation-report.md`
