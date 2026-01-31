# 型定義リファレンス

## Command 型

### Command (Discriminated Union)

```typescript
type Command =
  | DrawPathCommand
  | DrawLineCommand
  | DrawCircleCommand
  | ClearCommand;
```

### DrawPathCommand

```typescript
interface DrawPathCommand {
  readonly type: "drawPath";
  readonly points: readonly Point[];
  readonly color: Color;
  readonly lineWidth: number;
  readonly timestamp: number;
}
```

### DrawLineCommand

```typescript
interface DrawLineCommand {
  readonly type: "drawLine";
  readonly start: Point;
  readonly end: Point;
  readonly color: Color;
  readonly lineWidth: number;
  readonly timestamp: number;
}
```

### DrawCircleCommand

```typescript
interface DrawCircleCommand {
  readonly type: "drawCircle";
  readonly center: Point;
  readonly radius: number;
  readonly color: Color;
  readonly lineWidth: number;
  readonly timestamp: number;
}
```

### ClearCommand

```typescript
interface ClearCommand {
  readonly type: "clear";
  readonly timestamp: number;
}
```

## Checkpoint 型

```typescript
interface Checkpoint {
  readonly id: string;
  readonly commandIndex: number;
  readonly imageData: ImageData;
  readonly createdAt: number;
}
```

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `id` | `string` | 一意な識別子 |
| `commandIndex` | `number` | 対応するコマンドのインデックス |
| `imageData` | `ImageData` | レイヤーのスナップショット |
| `createdAt` | `number` | 作成時刻（タイムスタンプ） |

## HistoryState 型

```typescript
interface HistoryState {
  readonly commands: readonly Command[];
  readonly checkpoints: readonly Checkpoint[];
  readonly currentIndex: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
}
```

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `commands` | `readonly Command[]` | 記録されたコマンド一覧 |
| `checkpoints` | `readonly Checkpoint[]` | チェックポイント一覧 |
| `currentIndex` | `number` | 現在位置（-1 は空の状態） |
| `layerWidth` | `number` | レイヤーの幅 |
| `layerHeight` | `number` | レイヤーの高さ |

## HistoryConfig 型

```typescript
interface HistoryConfig {
  readonly maxHistorySize: number;
  readonly checkpointInterval: number;
  readonly maxCheckpoints: number;
}
```

| プロパティ | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `maxHistorySize` | `number` | 100 | 最大履歴数 |
| `checkpointInterval` | `number` | 10 | チェックポイント作成間隔 |
| `maxCheckpoints` | `number` | 10 | 最大チェックポイント数 |

### DEFAULT_HISTORY_CONFIG

```typescript
const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
};
```

## MemoryUsageInfo 型

```typescript
interface MemoryUsageInfo {
  readonly checkpointsBytes: number;
  readonly commandsBytes: number;
  readonly totalBytes: number;
  readonly formatted: string;
}
```

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `checkpointsBytes` | `number` | チェックポイントの合計バイト数 |
| `commandsBytes` | `number` | コマンドの概算バイト数 |
| `totalBytes` | `number` | 合計バイト数 |
| `formatted` | `string` | 表示用文字列 (例: "12.5 MB") |

## HistoryEntry 型

デバッグUI用。

```typescript
interface HistoryEntry {
  readonly index: number;
  readonly command: Command;
  readonly hasCheckpoint: boolean;
  readonly thumbnailDataUrl?: string;
}
```
