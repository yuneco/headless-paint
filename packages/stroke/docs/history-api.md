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
  layer: Layer | null,
  config?: HistoryConfig
): HistoryState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState` | ○ | 現在の履歴状態 |
| `command` | `Command` | ○ | 追加するコマンド |
| `layer` | `Layer \| null` | ○ | 現在のレイヤー（チェックポイント作成用）。wrap-shift や構造コマンドでは `null` を渡す |
| `config` | `HistoryConfig` | - | 履歴設定（省略時は `DEFAULT_HISTORY_CONFIG`） |

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

**注意**: この関数は currentIndex を更新するだけ。レイヤーの再構築は `rebuildLayerFromHistory` で行う。

**使用例**:
```typescript
if (canUndo(historyState)) {
  historyState = undo(historyState);
  clearLayer(layer);
  rebuildLayerFromHistory(layer, historyState);
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
  rebuildLayerFromHistory(layer, historyState);
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

## rebuildLayerFromHistory

履歴状態から指定レイヤーを再構築する。レイヤー ID に基づいてチェックポイントとコマンドをフィルタリングし、該当レイヤーの描画のみをリプレイする。

```typescript
function rebuildLayerFromHistory(layer: Layer, state: HistoryState): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 再構築するレイヤー |
| `state` | `HistoryState` | ○ | 履歴状態 |

**動作**:
1. `layer.id` に対応する最適なチェックポイントを探す
2. チェックポイントがあれば imageData をレイヤーに復元、なければクリア
3. チェックポイント以降の該当レイヤーのコマンドをリプレイ

**使用例**:
```typescript
rebuildLayerFromHistory(layer, historyState);
```

---

## replayCommands

コマンド列をレイヤーに順次適用する。

```typescript
function replayCommands(layer: Layer, commands: readonly Command[]): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 描画先レイヤー |
| `commands` | `readonly Command[]` | ○ | 適用するコマンドの配列 |

---

## createCheckpoint

レイヤーの現在の ImageData をスナップショットとして保存する。

```typescript
function createCheckpoint(layer: Layer, commandIndex: number): Checkpoint
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | スナップショット元のレイヤー |
| `commandIndex` | `number` | ○ | このチェックポイントが対応するコマンドインデックス |

**戻り値**: `Checkpoint` — レイヤー ID、ImageData、コマンドインデックスを含む

---

## restoreFromCheckpoint

チェックポイントの ImageData をレイヤーに復元する。

```typescript
function restoreFromCheckpoint(layer: Layer, checkpoint: Checkpoint): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 復元先のレイヤー |
| `checkpoint` | `Checkpoint` | ○ | 復元するチェックポイント |

---

## rebuildLayerState

> **@deprecated** — `rebuildLayerFromHistory` を使用してください。

履歴状態からレイヤーを再構築する。内部で `rebuildLayerFromHistory` を呼び出す。

```typescript
function rebuildLayerState(layer: Layer, state: HistoryState): void
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
  layerId: string,
  inputPoints: readonly InputPoint[],
  filterPipeline: FilterPipelineConfig,
  expand: ExpandConfig,
  color: StrokeStyle["color"],
  lineWidth: number,
  pressureSensitivity?: number,
  pressureCurve?: PressureCurve,
  compositeOperation?: GlobalCompositeOperation,
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
function createClearCommand(layerId: string): ClearCommand
```

---

## createAddLayerCommand

レイヤー追加コマンドを作成する。

```typescript
function createAddLayerCommand(
  layerId: string,
  insertIndex: number,
  width: number,
  height: number,
  meta: LayerMeta,
): AddLayerCommand
```

---

## createRemoveLayerCommand

レイヤー削除コマンドを作成する。削除時のメタデータをスナップショットとして保存し、Undo時の復元に使用する。

```typescript
function createRemoveLayerCommand(
  layerId: string,
  removedIndex: number,
  meta: LayerMeta,
): RemoveLayerCommand
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layerId` | `string` | ○ | 削除するレイヤーのID |
| `removedIndex` | `number` | ○ | 削除前のスタック位置 |
| `meta` | `LayerMeta` | ○ | 削除時のメタデータ（name, visible, opacity等） |

---

## createReorderLayerCommand

レイヤー並べ替えコマンドを作成する。

```typescript
function createReorderLayerCommand(
  layerId: string,
  fromIndex: number,
  toIndex: number,
): ReorderLayerCommand
```

---

## computeCumulativeOffset

wrap-shift の累積オフセットを算出する（グローバル、全レイヤー共通）。

```typescript
function computeCumulativeOffset(state: HistoryState): { readonly x: number; readonly y: number }
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState` | ○ | 現在の履歴状態 |

**戻り値**: `{ x, y }` - 正規化された累積オフセット（`[0, width)`, `[0, height)` の範囲）

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
  rebuildLayerFromHistory,
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
  rebuildLayerFromHistory(layer, historyState);
  redraw(); // 画面を再描画
}

// Redo
function handleRedo() {
  if (!canRedo(historyState)) return;

  historyState = redo(historyState);
  clearLayer(layer);
  rebuildLayerFromHistory(layer, historyState);
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
