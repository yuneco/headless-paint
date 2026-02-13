# @headless-paint/stroke

ストロークセッション管理と履歴管理（Undo/Redo）を行うパッケージ。

## インストール

```bash
pnpm add @headless-paint/stroke
```

## 概要

### 責務

このパッケージは以下の責務を持つ：

1. **セッション管理**: 1本のストロークの進捗を管理
2. **差分計算**: 前回からの変更点（newlyCommitted）を計算
3. **履歴管理**: マルチレイヤー対応のUndo/Redo機能の提供
4. **コマンド生成**: 描画コマンドおよび構造コマンド（レイヤー追加/削除/並び替え）の生成

### やってはいけないこと

- 直接の描画処理（→ engineに委譲）
- 入力デバイス処理（→ input担当）
- 複数ストロークの同時管理（1ストローク原則）

### パッケージ依存関係

```
stroke
  ├── @headless-paint/input  (FilterPipelineConfig, InputPoint)
  └── @headless-paint/engine (ExpandConfig, Layer, Color)
```

## 基本使用例

```typescript
import {
  startStrokeSession,
  addPointToSession,
  createStrokeCommand,
  createHistoryState,
  pushCommand,
  undo,
  canUndo,
  rebuildLayerFromHistory,
  createAddLayerCommand,
  isStructuralCommand,
} from "@headless-paint/stroke";
import { createLayer } from "@headless-paint/engine";

// 初期化（全コマンドに layerId が付く）
const layer = createLayer(1920, 1080);
let historyState = createHistoryState(1920, 1080);

// ストロークセッション → コマンド生成
const command = createStrokeCommand(
  layer.id, inputPoints, filterConfig, expandConfig, strokeStyle
);
historyState = pushCommand(historyState, command, layer, config);

// レイヤー追加（構造コマンド）
const addCmd = createAddLayerCommand(layer.id, 0, 1920, 1080, layer.meta);
historyState = pushCommand(historyState, addCmd, null, config);

// Undo → レイヤー単位でリビルド
if (canUndo(historyState)) {
  historyState = undo(historyState);
  rebuildLayerFromHistory(layer, historyState, registry); // layer.id でフィルタ, registry は image tip 用
}
```

## API リファレンス

### 型定義

詳細は [types.md](./types.md) を参照。

| 型 | 説明 |
|---|---|
| `StrokeSessionState` | セッション状態 |
| `StrokeSessionResult` | セッション操作の結果（state + renderUpdate） |
| `RenderUpdate` | 描画更新データ |
| `StrokeCommand` | ストロークコマンド（`layerId` 付き） |
| `ClearCommand` | クリアコマンド（`layerId` 付き） |
| `WrapShiftCommand` | ラップシフトコマンド（グローバル） |
| `LayerDrawCommand` | レイヤー固有の描画コマンド（`layerId` 付き） |
| `DrawCommand` | `StrokeCommand \| ClearCommand \| WrapShiftCommand` |
| `AddLayerCommand` | レイヤー追加コマンド |
| `RemoveLayerCommand` | レイヤー削除コマンド |
| `ReorderLayerCommand` | レイヤー並び替えコマンド |
| `StructuralCommand` | `AddLayerCommand \| RemoveLayerCommand \| ReorderLayerCommand` |
| `Command` | `DrawCommand \| StructuralCommand` |
| `HistoryState` | 履歴状態 |
| `HistoryConfig` | 履歴設定 |
| `Checkpoint` | チェックポイント（`layerId` 付き） |

### セッション管理

詳細は [session-api.md](./session-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `startStrokeSession(filterOutput, style, expand)` | セッション開始 |
| `addPointToSession(state, filterOutput)` | 点を追加 |
| `endStrokeSession(state, layerId, inputPoints, filterConfig)` | セッション終了（`layerId` 必須） |
| `createStrokeCommand(layerId, inputPoints, filterPipeline, expand, style, brushSeed?)` | ストロークコマンドを直接作成 |
| `createClearCommand(layerId)` | クリアコマンドを作成 |
| `createWrapShiftCommand(dx, dy)` | ラップシフトコマンドを作成（グローバル） |
| `createAddLayerCommand(layerId, insertIndex, width, height, meta)` | レイヤー追加コマンドを作成 |
| `createRemoveLayerCommand(layerId, removedIndex)` | レイヤー削除コマンドを作成 |
| `createReorderLayerCommand(layerId, fromIndex, toIndex)` | レイヤー並び替えコマンドを作成 |

### 履歴管理

詳細は [history-api.md](./history-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createHistoryState(width, height)` | 履歴状態を作成 |
| `pushCommand(state, command, layer, config)` | コマンドを追加（`layer` は構造コマンド時 `null` 可） |
| `undo(state)` | 1つ前に戻る |
| `redo(state)` | 1つ先に進む |
| `canUndo(state)` | Undo可能か |
| `canRedo(state)` | Redo可能か |
| `rebuildLayerFromHistory(layer, state, registry?)` | `layer.id` に基づきレイヤーを再構築。`registry` は image tip のリプレイ時に必要 |
| `replayCommands(layer, commands, registry?)` | コマンドのリストを順番にリプレイ |
| `replayCommand(layer, command, registry?)` | 単一コマンドをレイヤーに適用 |
| `computeCumulativeOffset(state)` | グローバルな累積オフセットを返す |
| `findBestCheckpointForLayer(state, layerId)` | 指定レイヤーの最適なチェックポイントを検索 |
| `getCommandsToReplayForLayer(state, layerId)` | 指定レイヤーのリプレイ対象コマンドを取得 |
| `getAffectedLayerIds(state, fromIndex, toIndex)` | 指定範囲で影響を受けるレイヤーIDの集合を取得 |
| `isDrawCommand(command)` | 描画コマンドの型ガード |
| `isLayerDrawCommand(command)` | レイヤー固有の描画コマンドの型ガード |
| `isStructuralCommand(command)` | 構造コマンドの型ガード |

## アーキテクチャ

### データフロー

```
input (FilterOutput)
    ↓
stroke: セッション管理
    - 前回からの差分計算
    → RenderUpdate { newlyCommitted, currentPending, style, expand, committedOverlapCount }
    ↓
engine: 描画
    - expand適用（確定/pending両方）
    - 確定レイヤー: newlyCommittedを追加描画
    - 作業レイヤー: currentPendingをクリア→再描画
```

### 1ストローク原則

このパッケージは常に1本のストロークのみを管理する。対称変換（expand）による複数ストロークへの展開は描画時にengineが行う。

```
【誤】input → expand → 複数ストローク → stroke管理
【正】input → stroke管理（1本）→ engine（描画時にexpand）
```

### committed/pending の管理

```
FilterOutput から受け取り:
  { committed: [...], pending: [...] }

StrokeSessionState で追跡:
  - allCommitted: これまでの全確定点
  - lastRenderedCommitIndex: 前回描画した確定点のインデックス

RenderUpdate として出力:
  - newlyCommitted: 今回新たに確定した点（差分）+ 先頭に最大3点のオーバーラップ
  - currentPending: 現在のpending全体
  - committedOverlapCount: newlyCommitted 先頭のオーバーラップ点数
```

### committed オーバーラップ戦略

インクリメンタル描画で `newlyCommitted` を描画する際、前回描画済みの末尾点をオーバーラップとして含める。これにより Catmull-Rom スプラインのブリッジ部分（描画済み→新規の接続点）で十分な制御点が確保され、曲率計算が改善される。

```
[...描画済み..., Pa, Pb, Pc] [Pa, Pb, Pc, P_new1, P_new2, ...]  ← 3点オーバーラップ
                              ^^^^^^^^^^^ context (曲率計算のみ、描画スキップ)
```
