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
