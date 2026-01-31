# History API

履歴状態の操作に関するAPI。すべて純粋関数として実装。

## createHistoryState

空の履歴状態を作成。

```typescript
function createHistoryState(
  width: number,
  height: number,
): HistoryState
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `width` | `number` | レイヤーの幅 |
| `height` | `number` | レイヤーの高さ |

### 戻り値

```typescript
{
  commands: [],
  checkpoints: [],
  currentIndex: -1,
  layerWidth: width,
  layerHeight: height,
}
```

## pushCommand

コマンドを履歴に追加。

```typescript
function pushCommand(
  state: HistoryState,
  command: Command,
  layer: Layer,
  config?: HistoryConfig,
): HistoryState
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `state` | `HistoryState` | 現在の履歴状態 |
| `command` | `Command` | 追加するコマンド |
| `layer` | `Layer` | チェックポイント作成用のレイヤー |
| `config` | `HistoryConfig` | 設定（省略時はデフォルト） |

### 動作

1. 現在位置より後のコマンドを削除（Undo後の新操作）
2. コマンドを追加
3. `checkpointInterval` ごとにチェックポイントを作成
4. 最大数を超えた場合は古いエントリを削除

### 使用例

```typescript
const newState = pushCommand(state, command, layer, {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
});
```

## canUndo / canRedo

Undo/Redo が可能かどうかを判定。

```typescript
function canUndo(state: HistoryState): boolean
function canRedo(state: HistoryState): boolean
```

## undo / redo

履歴を前後に移動。

```typescript
function undo(state: HistoryState): HistoryState
function redo(state: HistoryState): HistoryState
```

### 注意事項

- これらは `currentIndex` を変更するだけ
- 実際のレイヤー復元は `rebuildLayerState` を使用

### 使用例

```typescript
if (canUndo(state)) {
  state = undo(state);
  clearLayer(layer);
  rebuildLayerState(layer, state);
}
```

## rebuildLayerState

履歴状態に基づいてレイヤーを再構築。

```typescript
function rebuildLayerState(
  layer: Layer,
  state: HistoryState,
): void
```

### 動作

1. 最適なチェックポイントを探す
2. チェックポイントからレイヤーを復元
3. チェックポイント以降のコマンドをリプレイ

### パフォーマンス

- 最悪ケース: `checkpointInterval` 回のコマンドリプレイ
- 平均ケース: `checkpointInterval / 2` 回

## replayCommands

コマンドのリストを順番にリプレイ。

```typescript
function replayCommands(
  layer: Layer,
  commands: readonly Command[],
): void
```

### 使用例

```typescript
// 最初から全てリプレイ
clearLayer(layer);
replayCommands(layer, state.commands.slice(0, state.currentIndex + 1));
```
