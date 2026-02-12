# ストローク品質改善: committed overlap 3点化（C軸のみ）

## Context

高速ポインター操作時、committed layer のインクリメンタル描画でオーバーラップが1点しかなく、Catmull-Rom の曲率計算に十分な文脈が渡らない。特に新規 committed が3点以下の場合、4点制御の Catmull-Rom が活きずブリッジ部分が直線的になる。

オーバーラップを1→3点に増やし、先頭の文脈点は曲率計算のみに使い描画しない（skipSegments）。

**スコープ外**: A (Centripetal Catmull-Rom), B (getCoalescedEvents) は効果検証後に別途判断。

## 変更概要

```
現状:  [...描画済み..., P_last] [P_last, P_new1, P_new2, ...]   ← 1点オーバーラップ
変更後: [...描画済み..., Pa, Pb, Pc] [Pa, Pb, Pc, P_new1, P_new2, ...]  ← 3点オーバーラップ
                                      ^^^^^^^^^^^ context (描画しない、曲率計算のみ)
```

## API設計

### 命名方針

全レイヤーで `overlapCount` に統一。内部変換 `skipSegments = max(0, overlapCount - 1)` は `interpolateStrokePoints` 内部に隠蔽。

### engine パッケージ

- `interpolateStrokePoints(points, overlapCount = 0)`: skipSegments でオーバーラップ内部セグメントを除外、ブリッジセグメントは出力
- `drawVariableWidthPath(…, overlapCount = 0)`: パススルー
- `appendToCommittedLayer(…, overlapCount = 0)`: パススルー

### stroke パッケージ

- `RenderUpdate.committedOverlapCount`: 新規フィールド
- `COMMITTED_OVERLAP_COUNT = 3`: session 内部定数
- `addPointToSession`: `startIndex = max(0, lastRenderedCommitIndex - (COMMITTED_OVERLAP_COUNT - 1))` で3点オーバーラップ
- `startStrokeSession`: `committedOverlapCount: 0`（初回）

### 利用パターン（App.tsx）

ゼロ新規点ガード `newlyCommitted.length > committedOverlapCount` + パススルー。詳細は `packages/engine/docs/incremental-render-api.md` 参照。

## 実装結果

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `packages/stroke/src/types.ts` | `RenderUpdate` に `committedOverlapCount` 追加 |
| `packages/engine/src/draw.ts` | `interpolateStrokePoints`, `drawVariableWidthPath` に `overlapCount` 追加 |
| `packages/engine/src/incremental-render.ts` | `appendToCommittedLayer` に `overlapCount` 追加 |
| `packages/stroke/src/session.ts` | `COMMITTED_OVERLAP_COUNT=3`, overlap 計算ロジック |
| `apps/web/src/App.tsx` | ゼロ新規点ガード + パススルー（onStrokeMove, onStrokeEnd） |

### テスト

| テストファイル | 追加テスト |
|---|---|
| `packages/engine/src/draw.test.ts` | overlapCount=0 回帰, overlapCount=3 ブリッジ, overlapCount>=length, 1点入力 |
| `packages/engine/src/incremental-render.test.ts` | overlapCount>0 ブリッジ描画, overlapCount=0 同一性 |
| `packages/stroke/src/session.test.ts` | committedOverlapCount=0 初回, =1 最初の追加, =3 上限到達 |

### ドキュメント更新

| ファイル | 更新内容 |
|---|---|
| `packages/engine/docs/draw-api.md` | interpolateStrokePoints, drawVariableWidthPath に overlapCount |
| `packages/engine/docs/incremental-render-api.md` | appendToCommittedLayer に overlapCount, RenderUpdate, 使用例 |
| `packages/engine/docs/README.md` | 関数テーブル更新 |
| `packages/stroke/docs/types.md` | RenderUpdate に committedOverlapCount |
| `packages/stroke/docs/session-api.md` | overlap 変更、使用例 |
| `packages/stroke/docs/README.md` | overlap 戦略の説明更新 |

### 検証結果

- 全224テスト通過、ビルド成功、lint 通過
- 視覚評価: 診断ログで `overlap=3, new=1` パターンを確認、ブリッジ部分の描画が正常動作
- `replay.ts` は変更不要（デフォルト overlapCount=0 で従来動作）

## ペンディング

- A軸 (Centripetal Catmull-Rom) と B軸 (getCoalescedEvents) は今後の効果検証後に別途判断
