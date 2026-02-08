# レイヤー名の仕様設計と実装

## Context

レイヤー削除の Undo 時にメタデータ（名前・visible・opacity）が消失する問題を修正し、レイヤーのリネーム機能を追加した。

## 設計方針

- **メタデータ変更（リネーム含む）はコマンド化しない**: visibility/opacity と同じ扱い。Photoshop, Clip Studio Paint 等の標準的なペイントアプリと同様
- **`RemoveLayerCommand` に `meta: LayerMeta` を追加**: 削除時にメタデータをスナップショットし、Undo 復元時に利用

## 変更内容

### stroke パッケージ

- `RemoveLayerCommand` に `readonly meta: LayerMeta` フィールド追加
- `createRemoveLayerCommand(layerId, removedIndex, meta)` にシグネチャ変更

### Web アプリ

- `reinsertLayer(layerId, index, meta?)` に meta パラメータ追加。Undo/Redo 時に meta を渡して復元
- `renameLayer(layerId, name)` を `useLayers` hook に新設（direct mutation + direct set パターン）

### ドキュメント

- `packages/stroke/docs/types.md` に StructuralCommand セクション（AddLayer, RemoveLayer, ReorderLayer）を追加
- `packages/stroke/docs/history-api.md` にレイヤー構造コマンドのファクトリ関数を追加

## 変更ファイル

- `packages/stroke/src/types.ts`
- `packages/stroke/src/session.ts`
- `packages/stroke/src/session.test.ts`
- `packages/stroke/src/history.test.ts`
- `packages/stroke/docs/types.md`
- `packages/stroke/docs/history-api.md`
- `apps/web/src/hooks/useLayers.ts`
- `apps/web/src/App.tsx`

## 検証

- 全テスト通過（161/161）
- 全パッケージビルド成功
