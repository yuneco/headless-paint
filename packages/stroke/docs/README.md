# @headless-paint/stroke

ストロークセッション管理と履歴管理（Undo/Redo）を行うパッケージ。

このドキュメントは workspace 内部パッケージ `@headless-paint/stroke` に対応する。
外部アプリケーションから利用する場合は `@yuneco/headless-paint` をインストールし、`@yuneco/headless-paint/core` から同等の API を import する。

## インストール

```bash
pnpm add @yuneco/headless-paint
```

## 概要

### 責務

このパッケージは以下の責務を持つ：

1. **セッション管理**: 1本のストロークの進捗を管理
2. **差分計算**: 前回からの変更点（newlyCommitted）を計算
3. **履歴管理**: マルチレイヤー対応のUndo/Redo機能の提供
4. **コマンド生成**: 描画コマンドおよび構造コマンド（レイヤー追加/削除/並び替え/複製/下統合）の生成

### やってはいけないこと

- 直接の描画処理（→ engineに委譲）
- 入力デバイス処理（→ input担当）
- 複数ストロークの同時管理（1ストローク原則）

### 実装上のパッケージ依存関係

```
stroke
  ├── @headless-paint/input   (FilterPipelineConfig, InputPoint)
  └── @headless-paint/engine  (ExpandConfig, Layer, Color)
```

## 基本使用例

```typescript
import {
  startStrokeSession,
  addPointToSession,
  createStrokeCommand,
  createHistoryState,
  beginHistoryMutation,
  pushCommand,
  undo,
  canUndo,
  rebuildLayerFromHistory,
  getCommandAt,
  createAddLayerCommand,
  isStructuralCommand,
} from "@yuneco/headless-paint/core";
import { createLayer } from "@yuneco/headless-paint/core";

// 初期化（全コマンドに layerId が付く）
const layer = createLayer(1920, 1080);
let historyState = createHistoryState(1920, 1080, { layerCount: 1 });

// ストロークセッション → コマンド生成
const command = createStrokeCommand(
  layer.id,
  inputPoints,
  filterConfig,
  expandConfig,
  strokeStyle,
  0,
  layer.meta.alphaLocked,
);
historyState = beginHistoryMutation(
  historyState,
  { affectedLayers: [layer], layerCount: 1 },
  config,
);
// ここで layer に実描画する
historyState = pushCommand(
  historyState,
  command,
  { afterLayer: layer, layerCount: 1 },
  config,
);

// レイヤー追加（構造コマンド）
const addCmd = createAddLayerCommand(layer.id, 0, 1920, 1080, layer.meta);
historyState = pushCommand(historyState, addCmd, { layerCount: 1 }, config);

// Undo → レイヤー単位でリビルド
if (canUndo(historyState)) {
  historyState = undo(historyState);
  const result = rebuildLayerFromHistory(layer, historyState, registry);
  if (!result.ok) {
    // 通常フローではここに来ない。state を進めず診断する。
  }
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
| `TransformLayerCommand` | レイヤー変換コマンド（`layerId` 付き、mat3 フラット配列） |
| `LayerDrawCommand` | レイヤー固有の描画コマンド（`layerId` 付き） |
| `DrawCommand` | `StrokeCommand \| ClearCommand \| WrapShiftCommand \| TransformLayerCommand` |
| `AddLayerCommand` | レイヤー追加コマンド |
| `RemoveLayerCommand` | レイヤー削除コマンド |
| `ReorderLayerCommand` | レイヤー並び替えコマンド |
| `DuplicateLayerCommand` | レイヤー複製コマンド |
| `MergeLayerDownCommand` | レイヤー下統合コマンド |
| `StructuralCommand` | `AddLayerCommand \| RemoveLayerCommand \| ReorderLayerCommand \| DuplicateLayerCommand \| MergeLayerDownCommand` |
| `Command<TCustom>` | `DrawCommand \| StructuralCommand \| TCustom`（デフォルト `never`） |
| `PixelScope<TCustom>` | 単一コマンドのピクセル影響スコープ（`"layer"` / `"all"` / `"structural"` / `"custom"`） |
| `AffectedLayers` | コマンド範囲のピクセル影響集約（`"partial"` / `"all"`） |
| `HistoryState<TCustom>` | 履歴状態（デフォルト `never`） |
| `HistoryConfig` | 履歴設定 |
| `PushCommandOptions` | command 確定時の影響レイヤー情報 |
| `HistoryMetrics` | checkpoint / command の観測情報 |
| `RebuildLayerResult` | レイヤー再構築結果 |
| `Checkpoint` | 内部 checkpoint（通常利用では直接操作しない） |

### セッション管理

詳細は [session-api.md](./session-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `startStrokeSession(filterOutput, style, expand)` | セッション開始 |
| `addPointToSession(state, filterOutput)` | 点を追加 |
| `endStrokeSession(state, layerId, inputPoints, filterPipeline, alphaLocked?)` | セッション終了（`layerId` 必須）。`alphaLocked` は command に保存され replay に使われる |
| `createStrokeCommand(layerId, inputPoints, filterPipeline, expand, style, brushSeed?, alphaLocked?)` | ストロークコマンドを直接作成。`alphaLocked` 省略時は `false` |
| `createClearCommand(layerId)` | クリアコマンドを作成 |
| `createWrapShiftCommand(dx, dy)` | ラップシフトコマンドを作成（グローバル） |
| `createTransformLayerCommand(layerId, matrix)` | レイヤー変換コマンドを作成 |
| `createAddLayerCommand(layerId, insertIndex, width, height, meta)` | レイヤー追加コマンドを作成 |
| `createRemoveLayerCommand(layerId, removedIndex, meta)` | レイヤー削除コマンドを作成 |
| `createReorderLayerCommand(layerId, fromIndex, toIndex)` | レイヤー並び替えコマンドを作成 |
| `createDuplicateLayerCommand(sourceLayerId, layerId, insertIndex, width, height, meta)` | レイヤー複製コマンドを作成 |
| `createMergeLayerDownCommand(sourceLayerId, targetLayerId, sourceIndex, targetIndex, sourceMeta, targetMetaBefore, targetMetaAfter)` | レイヤー下統合コマンドを作成 |

### Atomic Layer Operations

低レベル API 利用者向けに、レイヤー配列更新と履歴 command 作成を1つの結果として返す atomic operation を提供する。React 利用者は `@yuneco/headless-paint/react` の `usePaintEngine().duplicateLayer` / `mergeLayerDown` を使うと同等機能を利用できる。

| 関数 | 説明 |
|---|---|
| `duplicateLayerAtomic(layers, options)` | source layer を複製し、更新後 layers と `DuplicateLayerCommand` を返す |
| `mergeLayerDownAtomic(layers, options)` | source layer を直下 target に焼き込み、source を削除した layers と `MergeLayerDownCommand` を返す |
| `applyDuplicateLayerCommand(layers, command)` | recorded topology に従って duplicate command を redo/replay 適用 |
| `applyMergeLayerDownCommand(layers, command)` | recorded topology に従って merge-down command を redo/replay 適用 |

### 履歴管理

詳細は [history-api.md](./history-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createHistoryState(width, height, options?)` | 履歴状態を作成 |
| `beginHistoryMutation(state, options, config?)` | ピクセル変更直前に pre-write checkpoint を確保 |
| `pushCommand(state, command, options, config?)` | checkpoint coverage を検証してコマンドを追加 |
| `undo(state)` | 1つ前に戻る |
| `redo(state)` | 1つ先に進む |
| `canUndo(state)` | Undo可能か |
| `canRedo(state)` | Redo可能か |
| `rebuildLayerFromHistory(layer, state, registry?)` | `layer.id` に基づきレイヤーを再構築し、結果を返す |
| `replayCommands(layer, commands, registry?)` | コマンドのリストを順番にリプレイ |
| `replayCommand(layer, command, registry?)` | 単一コマンドをレイヤーに適用 |
| `computeCumulativeOffset(state)` | グローバルな累積オフセットを返す |
| `getCommandOffset(state, absoluteIndex)` | 絶対 index を `commands` 配列 offset に変換 |
| `getCommandAt(state, absoluteIndex)` | 絶対 index からコマンドを取得 |
| `getLastCommandIndex(state)` | 保持中の最後の絶対 command index を取得 |
| `getCommandsInRange(state, from, to)` | 絶対 index 範囲からコマンド列を取得 |
| `getHistoryMetrics(state)` | 履歴と checkpoint の観測情報を取得 |
| `findBestCheckpointForLayer(state, layerId)` | 指定レイヤーの最適なチェックポイントを検索 |
| `getCommandsToReplayForLayer(state, layerId)` | 指定レイヤーのリプレイ対象コマンドを取得 |
| `getCommandPixelScope(command)` | 単一コマンドのピクセル影響スコープを返す |
| `getAffectedLayerIds(state, fromIndex, toIndex)` | 指定範囲のピクセル影響を集約して返す（`AffectedLayers`） |
| `isDrawCommand(command)` | 描画コマンドの型ガード |
| `isLayerDrawCommand(command)` | レイヤー固有の描画コマンドの型ガード |
| `isStructuralCommand(command)` | 構造コマンドの型ガード |
| `isCustomCommand(command)` | カスタムコマンドの型ガード |

### カスタムコマンド

`Command<TCustom>` と `HistoryState<TCustom>` はジェネリクスを受け取り、アプリ定義のコマンド型を同じ undo/redo タイムラインに統合できる。カスタムコマンドはチェックポイントやピクセルリプレイの対象外で、apply/undo はアプリ側が実装する。

```typescript
type MyCmd = { readonly type: "rename"; readonly layerId: string; readonly oldName: string; readonly newName: string };

let history = createHistoryState<MyCmd>(1024, 1024);
history = pushCommand(
  history,
  { type: "rename", layerId: "a", oldName: "Layer 1", newName: "BG" },
  { layerCount: 1 },
);

// 型ガードで分岐
const cmd = getCommandAt(history, history.currentIndex);
if (isCustomCommand(cmd)) {
  // cmd は MyCmd 型
}
```

React での統合例（`usePaintEngine` + `CustomCommandHandler`）は [react/docs/README.md](../../react/docs/README.md#カスタムコマンドの使い方) を参照。

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
