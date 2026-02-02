# @headless-paint/history

履歴管理（Undo/Redo）パッケージ。チェックポイント + コマンド ハイブリッド方式で効率的な履歴管理を実現。

## インストール

```bash
pnpm add @headless-paint/history
```

## 概要

### アーキテクチャ

```
[Command 1] ─ [Command 2] ─ ... ─ [Command N] ─ [Checkpoint] ─ [Command N+1] ...
                                                     │
                                              ImageData保存
```

- **Command**: 操作を記録（drawPath の points, color, lineWidth など）
- **Checkpoint**: N 操作ごとに ImageData スナップショット保存
- **Undo**: 直近の Checkpoint まで戻り → Commands をリプレイ

## 基本使用例

```typescript
import {
  createHistoryState,
  createDrawPathCommand,
  pushCommand,
  undo,
  redo,
  canUndo,
  canRedo,
  rebuildLayerState,
} from "@headless-paint/history";
import { createLayer, clearLayer } from "@headless-paint/engine";

// 履歴状態を初期化
const layer = createLayer(1920, 1080);
let historyState = createHistoryState(1920, 1080);

// ストローク完了時にコマンドを記録
const command = createDrawPathCommand(points, color, lineWidth);
historyState = pushCommand(historyState, command, layer, {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
});

// Undo
if (canUndo(historyState)) {
  historyState = undo(historyState);
  clearLayer(layer);
  rebuildLayerState(layer, historyState);
}

// Redo
if (canRedo(historyState)) {
  historyState = redo(historyState);
  clearLayer(layer);
  rebuildLayerState(layer, historyState);
}
```

### パイプラインAPIとの統合（推奨）

```typescript
import {
  compilePipeline,
  endStrokeSession,
} from "@headless-paint/input";
import {
  createHistoryState,
  createStrokeCommand,
  pushCommand,
} from "@headless-paint/history";

// パイプラインAPIでストロークセッションを管理
// ...（startStrokeSession, addPointToSession）

// ストローク終了時
const { inputPoints, pipelineConfig } = endStrokeSession(sessionState);

// StrokeCommandを作成（入力点 + パイプライン設定のみ保存）
const command = createStrokeCommand(inputPoints, pipelineConfig, color, lineWidth);
historyState = pushCommand(historyState, command, layer, config);

// → リプレイ時にパイプライン設定で自動的に展開される
```

## API 一覧

### 状態操作

| 関数 | 説明 |
|------|------|
| `createHistoryState(width, height)` | 空の履歴状態を作成 |
| `pushCommand(state, command, layer, config)` | コマンドを追加 |
| `undo(state)` | 1つ前に戻る |
| `redo(state)` | 1つ先に進む |
| `canUndo(state)` | Undo 可能か |
| `canRedo(state)` | Redo 可能か |

### コマンド作成

| 関数 | 説明 |
|------|------|
| `createStrokeCommand(inputPoints, pipeline, color, lineWidth)` | ストロークコマンド（推奨） |
| `createDrawPathCommand(points, color, lineWidth)` | パス描画コマンド |
| `createDrawLineCommand(start, end, color, lineWidth)` | 直線描画コマンド |
| `createDrawCircleCommand(center, radius, color, lineWidth)` | 円描画コマンド |
| `createClearCommand()` | クリアコマンド |
| `getCommandLabel(command)` | コマンドの表示ラベル |

### レイヤー復元

| 関数 | 説明 |
|------|------|
| `rebuildLayerState(layer, state)` | 履歴状態からレイヤーを再構築 |
| `replayCommands(layer, commands)` | コマンドリストをリプレイ |

### デバッグ

| 関数 | 説明 |
|------|------|
| `getHistoryEntries(state)` | デバッグUI用のエントリ一覧 |
| `estimateMemoryUsage(state)` | メモリ使用量を推定 |
| `generateThumbnailDataUrl(imageData, maxWidth, maxHeight)` | サムネイル生成 |

## 関連ドキュメント

- [型定義リファレンス](./types.md)
- [Command API](./command-api.md)
- [Checkpoint API](./checkpoint-api.md)
- [History API](./history-api.md)
- [Debug API](./debug-api.md)
