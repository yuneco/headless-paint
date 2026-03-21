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
function createHistoryState<TCustom = never>(width: number, height: number): HistoryState<TCustom>
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `width` | `number` | ○ | レイヤーの幅 |
| `height` | `number` | ○ | レイヤーの高さ |

**戻り値**: `HistoryState<TCustom>` - 初期状態（`drawsSinceCheckpoint: 0`）

**使用例**:
```typescript
const historyState = createHistoryState(1920, 1080);
```

---

## pushCommand

コマンドを履歴に追加する。

```typescript
function pushCommand<TCustom = never>(
  state: HistoryState<TCustom>,
  command: Command<TCustom>,
  layer: Layer | null,
  config?: HistoryConfig
): HistoryState<TCustom>
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState<TCustom>` | ○ | 現在の履歴状態 |
| `command` | `Command<TCustom>` | ○ | 追加するコマンド |
| `layer` | `Layer \| null` | ○ | 現在のレイヤー（チェックポイント作成用）。wrap-shift や構造コマンド、カスタムコマンドでは `null` を渡す |
| `config` | `HistoryConfig` | - | 履歴設定（省略時は `DEFAULT_HISTORY_CONFIG`） |

**戻り値**: `HistoryState<TCustom>` - 更新された履歴状態

**動作**:
1. currentIndex より後のコマンドを削除（Redo履歴のクリア）
2. コマンドを追加
3. DrawCommand の場合: `drawsSinceCheckpoint` をインクリメントし、`checkpointInterval` に達したらチェックポイント作成 & カウンタリセット
4. `remove-layer` の場合: 強制チェックポイント作成 & カウンタリセット
5. DrawCommand の総数が `maxHistorySize` を超えたら、最も古い DrawCommand とそれ以前のコマンドをまとめて切り捨て
6. maxCheckpoints を超えたら古いチェックポイントを削除

**チェックポイント間隔**: `drawsSinceCheckpoint` カウンタに基づく。StructuralCommand やカスタムコマンドはカウントに含まれないため、コマンド種別の比率に依存せず一定間隔でチェックポイントが作成される。

**最大履歴数**: DrawCommand の数でカウント。StructuralCommand やカスタムコマンドは軽量であり、カウントに含めない。

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
function undo<TCustom = never>(state: HistoryState<TCustom>): HistoryState<TCustom>
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState<TCustom>` | ○ | 現在の履歴状態 |

**戻り値**: `HistoryState<TCustom>` - currentIndex が1減った状態

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
function redo<TCustom = never>(state: HistoryState<TCustom>): HistoryState<TCustom>
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState<TCustom>` | ○ | 現在の履歴状態 |

**戻り値**: `HistoryState<TCustom>` - currentIndex が1増えた状態

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
function canUndo<TCustom = never>(state: HistoryState<TCustom>): boolean
```

**戻り値**: `boolean` - currentIndex >= 0 の場合 true

---

## canRedo

Redoが可能かどうかを判定する。

```typescript
function canRedo<TCustom = never>(state: HistoryState<TCustom>): boolean
```

**戻り値**: `boolean` - currentIndex < commands.length - 1 の場合 true

---

## findBestCheckpointForLayer

指定レイヤーに対する最適なチェックポイントを取得する。`currentIndex` 以前のチェックポイントのうち、最も新しいものを返す。

```typescript
function findBestCheckpointForLayer<TCustom = never>(
  state: HistoryState<TCustom>,
  layerId: string,
): Checkpoint | undefined
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState<TCustom>` | ○ | 現在の履歴状態 |
| `layerId` | `string` | ○ | 対象レイヤーのID |

**戻り値**: `Checkpoint | undefined` - 見つかった場合はチェックポイント、なければ `undefined`

---

## getCommandsToReplayForLayer

指定レイヤーのリプレイ対象コマンドを取得する（描画コマンドのみ）。`wrap-shift` はグローバル操作のため全レイヤーのリプレイに含まれる。

```typescript
function getCommandsToReplayForLayer<TCustom = never>(
  state: HistoryState<TCustom>,
  layerId: string,
  fromCheckpoint?: Checkpoint,
): readonly DrawCommand[]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState<TCustom>` | ○ | 現在の履歴状態 |
| `layerId` | `string` | ○ | 対象レイヤーのID |
| `fromCheckpoint` | `Checkpoint` | - | 起点チェックポイント（省略時は先頭から） |

**戻り値**: `readonly DrawCommand[]` - リプレイ対象の描画コマンド列

---

## rebuildLayerFromHistory

履歴状態から指定レイヤーを再構築する。レイヤー ID に基づいてチェックポイントとコマンドをフィルタリングし、該当レイヤーの描画のみをリプレイする。

```typescript
function rebuildLayerFromHistory<TCustom = never>(
  layer: Layer,
  state: HistoryState<TCustom>,
  registry?: BrushTipRegistry,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 再構築するレイヤー |
| `state` | `HistoryState<TCustom>` | ○ | 履歴状態 |
| `registry` | `BrushTipRegistry` | - | ブラシチップレジストリ（スタンプブラシのリプレイに必要） |

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

## getAffectedLayerIds

指定範囲で影響を受けるレイヤーIDの集合を取得する。

```typescript
function getAffectedLayerIds<TCustom = never>(
  state: HistoryState<TCustom>,
  fromIndex: number,
  toIndex: number,
): ReadonlySet<string>
```

---

## computeCumulativeOffset

wrap-shift の累積オフセットを算出する（グローバル、全レイヤー共通）。

```typescript
function computeCumulativeOffset<TCustom = never>(state: HistoryState<TCustom>): { readonly x: number; readonly y: number }
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `HistoryState<TCustom>` | ○ | 現在の履歴状態 |

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
