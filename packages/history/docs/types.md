# 型定義リファレンス

## Command 型

### Command (Discriminated Union)

```typescript
type Command =
  | DrawPathCommand
  | DrawLineCommand
  | DrawCircleCommand
  | ClearCommand
  | StrokeCommand
  | BatchCommand;
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

### StrokeCommand

ストローク描画コマンド。入力点とパイプライン設定を保存し、リプレイ時に展開する。

```typescript
interface StrokeCommand {
  readonly type: "stroke";
  readonly inputPoints: readonly Point[];
  readonly pipeline: PipelineConfig;
  readonly color: Color;
  readonly lineWidth: number;
  readonly timestamp: number;
}
```

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `type` | `"stroke"` | コマンド種別 |
| `inputPoints` | `readonly Point[]` | 変換前の入力点列 |
| `pipeline` | `PipelineConfig` | パイプライン設定（@headless-paint/input） |
| `color` | `Color` | 描画色 |
| `lineWidth` | `number` | 線の太さ |
| `timestamp` | `number` | 作成時刻 |

**特徴**:
- 対称描画などでも入力点のみを保存（展開後のデータは保存しない）
- リプレイ時にパイプライン設定で再展開
- データサイズが小さい（6分割対称でも1/6）

**使用例**:
```typescript
// 履歴に保存されるデータ
const command: StrokeCommand = {
  type: "stroke",
  inputPoints: [{ x: 100, y: 100 }, { x: 150, y: 120 }],
  pipeline: {
    transforms: [{ type: "symmetry", config: { mode: "radial", divisions: 6, ... } }]
  },
  color: { r: 0, g: 0, b: 0, a: 255 },
  lineWidth: 3,
  timestamp: 1706841600000
};
// → リプレイ時に6本のストロークに展開される
```

### BatchCommand

複数のコマンドをまとめるバッチコマンド。

```typescript
interface BatchCommand {
  readonly type: "batch";
  readonly commands: readonly Command[];
  readonly timestamp: number;
}
```

> **Note**: ストローク描画には `StrokeCommand` の使用を推奨します。

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
