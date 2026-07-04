# WS5 react history executor refactor

## 目的

`packages/react/src/usePaintEngine.ts` の `handleUndo` / `handleRedo` に残る command 種別分岐を、`packages/stroke/src/command-executor.ts` の `executeHistoryOp` 呼び出しへ集約する。

## 方針

1. `packages/stroke/docs/command-executor.md` の `ExecutorResult` 契約と active hint 適用規則を確認する。
2. React 側には以下だけを残す。
   - `CustomCommandHandler` を `CustomCommandExecutor` 形式へ変換する adapter
   - `LayerListOp` を `useLayers` の既存 helper で entries に反映する helper
   - `activeLayerIdHint` と `visibilityFixLayerIds` の React 状態への反映
3. `executeHistoryOp` が `ok:false` を返した場合は `console.warn` して履歴状態を進めない。
4. 公開 IF は変更しない。

## 確認事項

- remove-layer undo の checkpoint 欠落時は executor の中断挙動に従う。
- custom command に handler がない場合も executor の `ok:false` に従い、履歴を進めない。

## 検証

- `pnpm build` 成功
- `pnpm test` 成功（34 files / 430 tests）
- `pnpm lint` 成功

## 実装結果

- `handleUndo` / `handleRedo` の command 種別分岐を削除し、`executeHistoryOp` を呼ぶ共通ラッパーへ置換した。
- `LayerListOp` は React 側で entries へ反映し、`activeLayerIdHint` は `command-executor.md` の規則に従って適用する。
- 既存 `CustomCommandHandler` は `CustomCommandExecutor` 形式へ adapter 変換する。
