# History API

履歴管理（Undo/Redo）を行う関数群。チェックポイント + コマンド ハイブリッド方式。

## 概要

### アーキテクチャ

```
[Command 1] ─ [Command 2] ─ ... ─ [Command N] ─ [Checkpoint] ─ [Command N+1] ...
                                                     │
                                              ImageData保存
```

- **Command**: 操作を記録（inputPoints, filterPipeline, expand, color, lineWidth）
- **Checkpoint**: N操作ごとにImageDataスナップショット保存
- **Undo**: 直近のCheckpointまで戻り → Commandsをリプレイ

### リプレイの流れ

```
Checkpoint (imageData)
    ↓ レイヤーに復元
Commands[checkpoint.index + 1 ... current]
    ↓ 各コマンドをリプレイ
      - inputPoints を filterPipeline で処理
      - 結果を expand で展開
      - 描画
```

---

## createHistoryState

空の履歴状態を作成する。

```typescript
function createHistoryState(width: number, height: number): HistoryState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `width` | `number` | ○ | レイヤーの幅 |
| `height` | `number` | ○ | レイヤーの高さ |

**戻り値**: `HistoryState` - 初期状態

**使用例**:
```typescript
const historyState = createHistoryState(1920, 1080);
```

---

## pushCommand

コマンドを履歴に追加する。

```typescript
function pushCommand(
  state: HistoryState,
  command: Command,
  layer: Layer,
  config: HistoryConfig
): HistoryState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState` | ○ | 現在の履歴状態 |
| `command` | `Command` | ○ | 追加するコマンド |
| `layer` | `Layer` | ○ | 現在のレイヤー（チェックポイント作成用） |
| `config` | `HistoryConfig` | ○ | 履歴設定 |

**戻り値**: `HistoryState` - 更新された履歴状態

**動作**:
1. currentIndex より後のコマンドを削除（Redo履歴のクリア）
2. コマンドを追加
3. checkpointInterval に達したらチェックポイント作成
4. maxHistorySize を超えたら古いコマンドを削除
5. maxCheckpoints を超えたら古いチェックポイントを削除

**使用例**:
```typescript
historyState = pushCommand(historyState, command, layer, {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
});
```

---

## undo

1つ前の状態に戻る。

```typescript
function undo(state: HistoryState): HistoryState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState` | ○ | 現在の履歴状態 |

**戻り値**: `HistoryState` - currentIndex が1減った状態

**注意**: この関数は currentIndex を更新するだけ。レイヤーの再構築は `rebuildLayerState` で行う。

**使用例**:
```typescript
if (canUndo(historyState)) {
  historyState = undo(historyState);
  clearLayer(layer);
  rebuildLayerState(layer, historyState);
}
```

---

## redo

1つ先の状態に進む。

```typescript
function redo(state: HistoryState): HistoryState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState` | ○ | 現在の履歴状態 |

**戻り値**: `HistoryState` - currentIndex が1増えた状態

**使用例**:
```typescript
if (canRedo(historyState)) {
  historyState = redo(historyState);
  clearLayer(layer);
  rebuildLayerState(layer, historyState);
}
```

---

## canUndo

Undoが可能かどうかを判定する。

```typescript
function canUndo(state: HistoryState): boolean
```

**戻り値**: `boolean` - currentIndex >= 0 の場合 true

---

## canRedo

Redoが可能かどうかを判定する。

```typescript
function canRedo(state: HistoryState): boolean
```

**戻り値**: `boolean` - currentIndex < commands.length - 1 の場合 true

---

## rebuildLayerState

履歴状態からレイヤーを再構築する。

```typescript
function rebuildLayerState(layer: Layer, state: HistoryState): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 再構築するレイヤー |
| `state` | `HistoryState` | ○ | 履歴状態 |

**動作**:
1. currentIndex 以下の最新チェックポイントを探す
2. チェックポイントがあれば imageData をレイヤーに復元
3. チェックポイント以降のコマンドをリプレイ

**使用例**:
```typescript
clearLayer(layer);
rebuildLayerState(layer, historyState);
```

---

## replayCommand

単一のコマンドをレイヤーに適用する。

```typescript
function replayCommand(layer: Layer, command: Command): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 描画先レイヤー |
| `command` | `Command` | ○ | 適用するコマンド |

**StrokeCommandの処理**:
1. inputPoints を filterPipeline で処理（processAllPoints）
2. 結果を expand で展開（expandStroke）
3. 各ストロークを描画（drawPath）

---

## createStrokeCommand

ストロークコマンドを作成する（ヘルパー関数）。

```typescript
function createStrokeCommand(
  inputPoints: readonly InputPoint[],
  filterPipeline: FilterPipelineConfig,
  expand: ExpandConfig,
  color: Color,
  lineWidth: number
): StrokeCommand
```

**使用例**:
```typescript
const command = createStrokeCommand(
  inputPoints,
  { filters: [{ type: "smoothing", config: { windowSize: 5 } }] },
  { mode: "radial", origin: { x: 500, y: 500 }, angle: 0, divisions: 6 },
  { r: 0, g: 0, b: 0, a: 255 },
  3
);
```

---

## createClearCommand

クリアコマンドを作成する（ヘルパー関数）。

```typescript
function createClearCommand(): ClearCommand
```

---

## 典型的な使用パターン

```typescript
import {
  createHistoryState,
  pushCommand,
  undo,
  redo,
  canUndo,
  canRedo,
  rebuildLayerState,
} from "@headless-paint/stroke";
import { createLayer, clearLayer } from "@headless-paint/engine";

// 初期化
const layer = createLayer(1920, 1080);
let historyState = createHistoryState(1920, 1080);

const historyConfig: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
};

// ストローク完了時
function onStrokeComplete(command: StrokeCommand) {
  historyState = pushCommand(historyState, command, layer, historyConfig);
}

// Undo
function handleUndo() {
  if (!canUndo(historyState)) return;

  historyState = undo(historyState);
  clearLayer(layer);
  rebuildLayerState(layer, historyState);
  redraw(); // 画面を再描画
}

// Redo
function handleRedo() {
  if (!canRedo(historyState)) return;

  historyState = redo(historyState);
  clearLayer(layer);
  rebuildLayerState(layer, historyState);
  redraw();
}

// キーボードショートカット
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
    } else if (e.key === "z" && e.shiftKey) {
      e.preventDefault();
      handleRedo();
    } else if (e.key === "y") {
      e.preventDefault();
      handleRedo();
    }
  }
});
```
