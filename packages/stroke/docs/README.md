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
3. **履歴管理**: Undo/Redo機能の提供
4. **StrokeCommand生成**: 履歴保存用のコマンド生成

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
  // セッション管理
  startStrokeSession,
  addPointToSession,
  endStrokeSession,
  // 履歴管理
  createHistoryState,
  pushCommand,
  undo,
  redo,
  canUndo,
  canRedo,
  rebuildLayerState,
} from "@headless-paint/stroke";
import { createLayer, clearLayer } from "@headless-paint/engine";
import { compileFilterPipeline, processPoint } from "@headless-paint/input";

// 初期化
const layer = createLayer(1920, 1080);
let historyState = createHistoryState(1920, 1080);

// ストロークセッション開始
function onPointerDown(filterOutput, strokeStyle, expandConfig) {
  const result = startStrokeSession(filterOutput, strokeStyle, expandConfig);
  sessionRef.current = result.state;
  renderUpdate(result.renderUpdate); // 描画更新
}

// ストローク中
function onPointerMove(filterOutput) {
  const result = addPointToSession(sessionRef.current, filterOutput);
  sessionRef.current = result.state;
  renderUpdate(result.renderUpdate);
}

// ストローク終了
function onPointerUp(inputPoints, filterPipelineConfig) {
  const command = endStrokeSession(
    sessionRef.current,
    inputPoints,
    filterPipelineConfig
  );
  sessionRef.current = null;

  if (command) {
    historyState = pushCommand(historyState, command, layer, config);
  }
}

// Undo
if (canUndo(historyState)) {
  historyState = undo(historyState);
  clearLayer(layer);
  rebuildLayerState(layer, historyState);
}
```

## API リファレンス

### 型定義

詳細は [types.md](./types.md) を参照。

| 型 | 説明 |
|---|---|
| `StrokeSessionState` | セッション状態 |
| `RenderUpdate` | 描画更新データ |
| `StrokeCommand` | ストロークコマンド |
| `HistoryState` | 履歴状態 |
| `HistoryConfig` | 履歴設定 |
| `Checkpoint` | チェックポイント |

### セッション管理

詳細は [session-api.md](./session-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `startStrokeSession(filterOutput, style, expand)` | セッション開始 |
| `addPointToSession(state, filterOutput)` | 点を追加 |
| `endStrokeSession(state, inputPoints, filterConfig)` | セッション終了 |

### 履歴管理

詳細は [history-api.md](./history-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createHistoryState(width, height)` | 履歴状態を作成 |
| `pushCommand(state, command, layer, config)` | コマンドを追加 |
| `undo(state)` | 1つ前に戻る |
| `redo(state)` | 1つ先に進む |
| `canUndo(state)` | Undo可能か |
| `canRedo(state)` | Redo可能か |
| `rebuildLayerState(layer, state)` | レイヤーを再構築 |

## アーキテクチャ

### データフロー

```
input (FilterOutput)
    ↓
stroke: セッション管理
    - 前回からの差分計算
    → RenderUpdate { newlyCommitted, currentPending, style, expand }
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
  - newlyCommitted: 今回新たに確定した点（差分）
  - currentPending: 現在のpending全体
```
