# 履歴管理（Undo/Redo）機能 実装計画

## 概要

`packages/history` パッケージを新規作成し、チェックポイント+コマンド ハイブリッド方式で履歴管理を実装する。

## アーキテクチャ

```
[Command 1] ─ [Command 2] ─ ... ─ [Command N] ─ [Checkpoint] ─ [Command N+1] ...
                                                     │
                                              ImageData保存
```

- **Command**: 操作を記録（drawPath の points, color, lineWidth など）
- **Checkpoint**: N操作ごとに ImageData スナップショット保存
- **Undo**: 直近の Checkpoint まで戻り → Commands をリプレイ

## パッケージ構成

```
packages/history/
├── package.json
├── vite.config.ts
├── docs/
│   ├── README.md          # 概要・インストール・基本使用例
│   ├── types.md           # 型定義リファレンス
│   ├── command-api.md     # Command関連API
│   ├── checkpoint-api.md  # Checkpoint関連API
│   ├── history-api.md     # 履歴操作API
│   └── debug-api.md       # デバッグ用API（サムネイル、メモリ計算）
└── src/
    ├── index.ts           # 公開API
    ├── types.ts           # Command, Checkpoint, HistoryState, HistoryConfig
    ├── command.ts         # Command作成関数
    ├── checkpoint.ts      # Checkpoint作成・復元
    ├── history.ts         # 履歴操作の純粋関数
    ├── replay.ts          # コマンドリプレイ
    ├── thumbnail.ts       # サムネイル生成
    └── *.test.ts          # テスト
```

## 主要な型

```typescript
// Command（Discriminated Union）
type Command = DrawPathCommand | DrawLineCommand | DrawCircleCommand | ClearCommand;

interface DrawPathCommand {
  readonly type: "drawPath";
  readonly points: readonly Point[];
  readonly color: Color;
  readonly lineWidth: number;
  readonly timestamp: number;
}

// Checkpoint
interface Checkpoint {
  readonly id: string;
  readonly commandIndex: number;
  readonly imageData: ImageData;
  readonly createdAt: number;
}

// 履歴状態
interface HistoryState {
  readonly commands: readonly Command[];
  readonly checkpoints: readonly Checkpoint[];
  readonly currentIndex: number;  // 現在位置
  readonly layerWidth: number;
  readonly layerHeight: number;
}

// 設定
interface HistoryConfig {
  readonly maxHistorySize: number;      // 最大履歴数（デフォルト: 100）
  readonly checkpointInterval: number;  // Checkpoint間隔（デフォルト: 10）
  readonly maxCheckpoints: number;      // 最大Checkpoint数（デフォルト: 10）
}
```

## 公開API

```typescript
// 状態操作（純粋関数）
export function createHistoryState(width: number, height: number): HistoryState;
export function pushCommand(state: HistoryState, command: Command, layer: Layer, config: HistoryConfig): HistoryState;
export function undo(state: HistoryState): HistoryState;
export function redo(state: HistoryState): HistoryState;
export function canUndo(state: HistoryState): boolean;
export function canRedo(state: HistoryState): boolean;

// コマンド作成
export function createDrawPathCommand(points: readonly Point[], color: Color, lineWidth: number): DrawPathCommand;

// レイヤー復元
export function rebuildLayerState(layer: Layer, state: HistoryState): void;

// デバッグUI用
export function getHistoryEntries(state: HistoryState): readonly HistoryEntry[];
export function generateThumbnailDataUrl(imageData: ImageData, maxWidth: number, maxHeight: number): string;

// メモリ使用量計算
export function estimateMemoryUsage(state: HistoryState): MemoryUsageInfo;
```

```typescript
// メモリ使用量情報
interface MemoryUsageInfo {
  readonly checkpointsBytes: number;   // Checkpoint の合計バイト数
  readonly commandsBytes: number;      // Command の概算バイト数
  readonly totalBytes: number;         // 合計
  readonly formatted: string;          // 表示用文字列 (例: "12.5 MB")
}
```

## App.tsx 統合イメージ

```typescript
const [historyState, setHistoryState] = useState(() => createHistoryState(LAYER_WIDTH, LAYER_HEIGHT));

// ストローク完了時
const onStrokeEnd = useCallback(() => {
  const command = createDrawPathCommand(strokePoints, PEN_COLOR, PEN_WIDTH);
  setHistoryState(prev => pushCommand(prev, command, layer, config));
}, [layer, strokePoints]);

// Undo
const handleUndo = useCallback(() => {
  if (!canUndo(historyState)) return;
  const newState = undo(historyState);
  setHistoryState(newState);
  clearLayer(layer);
  rebuildLayerState(layer, newState);
}, [historyState, layer]);
```

## デバッグUI: HistoryDebugPanel

```
┌─ History (15) ─────────────────────── ▼ ┐
│  Memory: 24.3 MB (CP: 24.0 / Cmd: 0.3)  │  ← メモリ使用量
│  [Undo]  [Redo]                         │
│                                         │
│  ┌────┬──────────────────────────────┐ │
│  │ 🖼 │ 1. drawPath             CP   │ │  ← Checkpoint + サムネイル
│  ├────┼──────────────────────────────┤ │
│  │    │ 2. drawPath                  │ │
│  ├────┼──────────────────────────────┤ │
│  │    │ 3. drawPath          ◀ 現在  │ │  ← ハイライト
│  └────┴──────────────────────────────┘ │
└─────────────────────────────────────────┘
```

- 折りたたみ可能（ヘッダークリック）
- **メモリ使用量**: 合計、Checkpoint分、Command分を表示
- サムネイル: 24x24px、Checkpointありのエントリのみ
- 現在位置をハイライト表示
- 最大高さ200px、スクロール可能

## 実装ステップ

### Step 1: パッケージ基盤
- [x] `packages/history/package.json` 作成
- [x] `packages/history/vite.config.ts` 作成
- [x] `types.ts` - 全型定義
- [x] `index.ts` - バレルエクスポート

### Step 2: Command & Checkpoint
- [x] `command.ts` - createDrawPathCommand, getCommandLabel
- [x] `checkpoint.ts` - createCheckpoint, restoreFromCheckpoint
- [x] テスト追加

### Step 3: History State
- [x] `history.ts` - createHistoryState, pushCommand, undo, redo, canUndo, canRedo
- [x] `replay.ts` - replayCommands, rebuildLayerState
- [x] テスト追加

### Step 4: App.tsx 統合
- [x] 履歴状態の追加
- [x] onStrokeEnd でコマンド記録
- [x] handleUndo / handleRedo 実装
- [x] キーボードショートカット（Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z）

### Step 5: デバッグUI
- [x] `thumbnail.ts` - generateThumbnailDataUrl
- [x] `history.ts` に estimateMemoryUsage 追加
- [x] `HistoryDebugPanel.tsx` 作成（メモリ使用量表示含む）
- [x] App.tsx に組み込み

### Step 6: ドキュメント作成
- [x] `docs/README.md` - 概要、インストール、基本使用例、API一覧
- [x] `docs/types.md` - 型定義リファレンス
- [x] `docs/command-api.md` - Command関連API
- [x] `docs/checkpoint-api.md` - Checkpoint関連API
- [x] `docs/history-api.md` - 履歴操作API
- [x] `docs/debug-api.md` - サムネイル、メモリ計算API

### Step 7: 最適化 & テスト
- [x] 大きいキャンバスでのパフォーマンス確認
- [x] メモリ制限動作確認
- [x] エッジケーステスト

## 修正対象ファイル

### 新規作成
- `packages/history/package.json`
- `packages/history/vite.config.ts`
- `packages/history/src/index.ts`
- `packages/history/src/types.ts`
- `packages/history/src/command.ts`
- `packages/history/src/checkpoint.ts`
- `packages/history/src/history.ts`
- `packages/history/src/replay.ts`
- `packages/history/src/thumbnail.ts`
- `packages/history/src/*.test.ts`
- `packages/history/docs/README.md`
- `packages/history/docs/types.md`
- `packages/history/docs/command-api.md`
- `packages/history/docs/checkpoint-api.md`
- `packages/history/docs/history-api.md`
- `packages/history/docs/debug-api.md`
- `apps/web/src/components/HistoryDebugPanel.tsx`

### 修正
- `apps/web/src/App.tsx` - 履歴統合
- `apps/web/package.json` - dependency追加
- `pnpm-workspace.yaml` - 確認（既存で対応済みのはず）

## 検証方法

1. **基本動作**: 複数ストローク描画 → Undo → Redo で正しく復元
2. **キーボード**: Cmd+Z / Cmd+Shift+Z で動作
3. **デバッグUI**: 履歴リスト表示、サムネイル表示、折りたたみ動作
4. **メモリ表示**: 操作に応じてメモリ使用量が増減することを確認
5. **パフォーマンス**: 50回以上のUndo/Redoがスムーズに動作
6. **メモリ制限**: maxHistorySize/maxCheckpoints 超過時に古いエントリが削除される

## 設計上の考慮点

| 項目 | 値 |
|------|-----|
| Checkpoint間隔 | 10操作ごと |
| 最大履歴数 | 100 |
| 最大Checkpoint数 | 10 |
| 1 Checkpoint サイズ | 約8MB (1920x1080) |
| Undo最悪計算量 | O(10) のリプレイ |

## 作業結果

**実装日**: 2026-01-31

### テスト結果

- 全39テストがパス（command: 8, checkpoint: 4, history: 21, replay: 6）

### 動作確認結果

| 機能 | 結果 |
|------|------|
| ストローク描画 → 履歴記録 | OK |
| Undoボタン | OK |
| Redoボタン | OK |
| Cmd+Z（Undo） | OK |
| Cmd+Shift+Z（Redo） | OK |
| チェックポイント作成（10操作ごと） | OK |
| メモリ使用量表示 | OK |
| 履歴リスト表示 | OK |
