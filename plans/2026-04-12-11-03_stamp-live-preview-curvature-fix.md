# Stamp Live Preview Curvature Fix

## Summary

- `uniform Catmull-Rom` を `centripetal Catmull-Rom` に置き換える
- `stamp` ブラシの live 描画は `pending` 全再描画に寄せ、stroke end 時だけ `committed` に flush する
- `stamp` の補間は途中セグメントで実際の future 点を使い、tail のみ future-independent にする

## Doc-First Phases

### Phase 1: API設計・ドキュメント作成

- 公開 API / 型 / 保存形式は変更しない
- `packages/react/docs/README.md` に `stamp` ブラシの live preview 挙動を追記する

### Phase 2: 利用イメージレビュー

- `usePaintEngine` / `useStrokeSession` の外部呼び出しコードは変更不要
- 品質改善は内部実装のみで吸収する

### Phase 3: 実装

- `packages/engine/src/stroke-interpolation.ts` を追加し、`draw.ts` と `brush-render.ts` から共通利用する
- `brush-render.ts` の `stamp` 補間は tail のみ future-independent とし、途中セグメントでは実 future 点を使う
- `useStrokeSession.ts` で `stamp` の live 中 `appendToCommittedLayer()` を止め、`pendingLayer` に `allCommitted + currentPending` を再描画する
- stroke end 時に `stamp` のみ `allCommitted` を `committedLayer` へ 1 回だけ反映する

### Phase 4: アーキテクトレビュー

- `stamp` の品質改善が `useStrokeSession` 内で閉じていること
- replay / rebuild の determinism を壊さないこと
- `stamp` では「曲線の chunk 分割 incremental 描画と replay の最終ピクセル一致」を前提にしないこと
- docs と実装が一致していること

## 実装時の調整内容（補足）

- 原因切り分けのため `apps/web` に geometry overlay を一時追加し、raw / filtered / 実スタンプ中心を重ねて観察した
- overlay により、問題は tip 描画ではなく `stamp` 中心列の曲率分配にあることを確認した
- 検証完了後、overlay と debug instrumentation は削除した

## Verification

- `pnpm build`
- `pnpm lint`
- 手動確認: `Marker`, `1px`, 高速カーブで live preview の折れ感が改善すること
