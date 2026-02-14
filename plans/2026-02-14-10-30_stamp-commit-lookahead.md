# スタンプブラシ: committed/replay 不一致修正（lookahead再設計）

## Context

スタンプブラシのインクリメンタル描画では、`newlyCommitted` をそのまま `appendToCommittedLayer` に渡している。先頭は `committedOverlapCount` で文脈を補えるが、各チャンクの末尾セグメントは `p_{i+2}` 不足でクランプ補間になるため、Undo/Redo replay（一括処理）と最終ピクセルがずれる。

## 前回案（React側 commitBuffer）が失敗した理由

問題認識（末尾の文脈不足）は正しいが、修正の責務を React 側だけに置くと解決できない。

1. `appendToCommittedLayer` には「末尾点を文脈として使うが描画しない」APIがない
2. 既存 `overlapCount` は「先頭文脈点数」と「先頭スキップセグメント数（overlap-1）」が結合されており、末尾遅延と両立しない
3. stamp は flow/jitter を伴う非冪等描画のため、後から重ね描きで補正する方式では replay と一致しない

## 修正方針（正）

`committed` 追加描画を「点列ベース」ではなく「どのセグメントを描くか」で制御する。  
具体的には **先頭スキップ** と **末尾スキップ** を独立パラメータ化し、`stroke` 側が描画対象セグメント範囲を明示して `engine` に渡す。

- 先頭スキップ: 既描画セグメントを再描画しないため
- 末尾スキップ: `p_{i+2}` 未確定の末尾セグメントを deferred するため
- finalize 時のみ末尾スキップを 0 にして残りを確定描画

## 設計変更

### 1. engine: overlap 単独指定を廃止し、先頭/末尾スキップを分離

- `interpolateStrokePoints` を以下の指定に変更
  - `skipLeadingSegments`（既描画分）
  - `skipTrailingSegments`（lookahead不足分）
- `drawVariableWidthPath` / stamp 描画にも同パラメータをパススルー
- `appendToCommittedLayer` は `overlapCount` ではなく `segmentWindow`（または同等の引数）を受け取る

これにより「先頭は文脈として保持しつつ、末尾だけ描画保留」が可能になる。

### 2. stroke: RenderUpdate を“点の差分”から“描画セグメント差分”へ拡張

`RenderUpdate` に以下を追加:

- `skipLeadingSegments: number`
- `skipTrailingSegments: number`

`committedOverlapCount` は段階的に置き換え（互換期間を設けるなら deprecated 扱い）。

`addPointToSession` は毎回:

1. 描画すべきグローバルセグメント範囲 `[startSegment, endSegment]` を計算  
   移動中は `endSegment = committedCount - 3`（末尾1セグメント保留）
2. その範囲を描くために必要な文脈点を含む `newlyCommitted` を切り出す
3. `skipLeadingSegments` / `skipTrailingSegments` を算出して返す

`finalizePipeline` 後の更新では `skipTrailingSegments = 0` として deferred 末尾を描き切る。

### 3. react: commitBuffer は持たず、RenderUpdate をそのまま適用

- `useStrokeSession.ts` は buffer ロジックを持たない
- `appendToCommittedLayer` 呼び出し時に `renderUpdate.skipLeadingSegments` / `skipTrailingSegments` を渡す
- pending layer は現状ロジック（`currentPending`）を維持

責務分離:
- 「何を描くか」= stroke
- 「どう描くか」= engine
- 「いつ呼ぶか」= react

### 4. replay: 既存方針維持（全点一括）

replay は最終確定ストロークを一括描画する現行方針のままでよい。  
インクリメンタル側が末尾保留を正しく処理すれば、最終 committed と replay が一致する。

## 影響範囲

| パッケージ | ファイル | 変更概要 |
|---|---|---|
| engine | `packages/engine/src/draw.ts` | 補間APIを `skipLeadingSegments` / `skipTrailingSegments` 対応へ |
| engine | `packages/engine/src/brush-render.ts` | round-pen / stamp で新パラメータ適用 |
| engine | `packages/engine/src/incremental-render.ts` | `appendToCommittedLayer` 引数更新 |
| stroke | `packages/stroke/src/types.ts` | `RenderUpdate` 拡張 |
| stroke | `packages/stroke/src/session.ts` | 描画対象セグメント範囲の算出ロジックへ変更 |
| react | `packages/react/src/useStrokeSession.ts` | 新 `RenderUpdate` のパススルー適用 |
| docs/tests | 各 docs/test | overlapCount 前提記述を更新、回帰テスト追加 |

## 実装手順

1. `engine` 側で補間APIを拡張（先頭/末尾スキップ分離）
2. `appendToCommittedLayer` の引数を更新し、既存呼び出しを移行
3. `stroke/session.ts` で `RenderUpdate` 生成ロジックをセグメント範囲ベースへ変更
4. `useStrokeSession.ts` の呼び出しを新APIへ差し替え（commitBufferは導入しない）
5. docs の `committedOverlapCount` 説明を新仕様へ更新

## 検証計画

- 単体テスト（engine）
  - `skipTrailingSegments=1` で末尾セグメントが描画されない
  - 次チャンクで deferred セグメントが一度だけ描画される
- 単体テスト（stroke）
  - 連続入力時に `skipLeading/skipTrailing` が期待値になる
  - finalize 後に `skipTrailing=0` で残りが出力される
- 統合テスト
  - 「incremental描画後の committed」と「同コマンド replay」のピクセル一致（stamp/round-pen 両方）
- 手動確認
  - スタンプで描画 → Undo → Redo で形状/jitter が一致

## リスク

- API変更範囲が `engine/stroke/react` に跨るため、段階移行中の型崩れに注意
- 既存 `committedOverlapCount` 前提テスト/ドキュメントが多く、更新漏れリスクあり
- セグメント境界の off-by-one は見た目差として出やすいので、ピクセル比較テストを必須化する

## 実施結果（2026-02-14）

当初計画の大規模API変更は実施せず、まず不一致を解消する最小修正を `engine` の stamp 補間に適用した。

- 変更: `packages/engine/src/brush-render.ts`
  - stamp 用に `interpolateStampStrokePoints` を追加
  - `p3` を末尾クランプではなく `p2 + (p2 - p1)` で外挿
  - chunk 境界で future 点の有無に依存しない補間に変更
- 変更: `packages/engine/src/brush-render.test.ts`
  - 回帰テスト `incremental（overlap 付き）と replay で最終ピクセルが一致する` を追加
  - 比較は画素差分カウントで評価（`differentPixelCount === 0`）

## 検証結果（2026-02-14）

- 追加テスト単体
  - 修正前: `red`（`differentPixelCount = 319`）
  - 修正後: `green`
- 関連テスト:
  - `pnpm vitest packages/engine/src/brush-render.test.ts packages/engine/src/draw.test.ts packages/engine/src/incremental-render.test.ts` → pass
- 全体テスト:
  - `pnpm vitest` → `16 files, 263 tests` すべて pass
