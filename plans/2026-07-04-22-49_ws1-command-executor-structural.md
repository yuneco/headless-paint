# WS1 command-executor structural 実装計画

## 目的

`packages/stroke/src/command-executor.ts` の structural/custom コマンド未実装分を、`packages/stroke/docs/command-executor.md` と `packages/react/src/usePaintEngine.ts` の現行 undo/redo 挙動に合わせて実装する。

## Phase

1. 既存設計確認
   - `command-executor.md` と `usePaintEngine.ts` の undo/redo 実装を照合する。
   - 既存公開API・型定義は変更しない。
2. 利用イメージ確認
   - app/react 側は executor の `LayerListOp` と hint を受けて entries/active/dirty/persistence を反映する想定を維持する。
   - executor は `deps.layers` の並べ替えを直接行わず、rebuild/再生成/ピクセル書込のみ内部で行う。
3. 実装
   - add/remove/reorder/duplicate/merge/custom の undo/redo を追加する。
   - structural 5種の undo/redo、custom、remove undo missing-checkpoint 中断のテストを追加・更新する。
4. レビュー・検証
   - `review-library-usage` 観点で実装と既存API利用を確認する。
   - `pnpm build`、`pnpm test`、`pnpm lint` を実行する。

## 完了条件

- `pnpm build` 成功
- root `pnpm test` 全グリーン（既存 expected fail は維持）
- `pnpm lint` 成功
- コミットしない
