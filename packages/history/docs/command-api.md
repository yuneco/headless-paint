# Command API

コマンドの作成と操作に関するAPI。

## createDrawPathCommand

パス描画コマンドを作成。

```typescript
function createDrawPathCommand(
  points: readonly Point[],
  color: Color,
  lineWidth: number,
): DrawPathCommand
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `points` | `readonly Point[]` | パスを構成する点の配列 |
| `color` | `Color` | 描画色 |
| `lineWidth` | `number` | 線の太さ |

### 戻り値

`DrawPathCommand` - タイムスタンプ付きのコマンド

### 使用例

```typescript
const command = createDrawPathCommand(
  [{ x: 0, y: 0 }, { x: 100, y: 100 }],
  { r: 0, g: 0, b: 0, a: 255 },
  3
);
```

## createDrawLineCommand

直線描画コマンドを作成。

```typescript
function createDrawLineCommand(
  start: Point,
  end: Point,
  color: Color,
  lineWidth: number,
): DrawLineCommand
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `start` | `Point` | 始点 |
| `end` | `Point` | 終点 |
| `color` | `Color` | 描画色 |
| `lineWidth` | `number` | 線の太さ |

## createDrawCircleCommand

円描画コマンドを作成。

```typescript
function createDrawCircleCommand(
  center: Point,
  radius: number,
  color: Color,
  lineWidth: number,
): DrawCircleCommand
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `center` | `Point` | 中心座標 |
| `radius` | `number` | 半径 |
| `color` | `Color` | 描画色 |
| `lineWidth` | `number` | 線の太さ |

## createClearCommand

クリアコマンドを作成。

```typescript
function createClearCommand(): ClearCommand
```

### 戻り値

`ClearCommand` - タイムスタンプ付きのクリアコマンド

## createStrokeCommand

ストロークコマンドを作成。パイプラインAPIと組み合わせて使用。

```typescript
function createStrokeCommand(
  inputPoints: readonly Point[],
  pipeline: PipelineConfig,
  color: Color,
  lineWidth: number,
): StrokeCommand
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `inputPoints` | `readonly Point[]` | 変換前の入力点列 |
| `pipeline` | `PipelineConfig` | パイプライン設定（@headless-paint/input） |
| `color` | `Color` | 描画色 |
| `lineWidth` | `number` | 線の太さ |

### 戻り値

`StrokeCommand` - タイムスタンプ付きのストロークコマンド

### 使用例

```typescript
import { endStrokeSession } from "@headless-paint/input";
import { createStrokeCommand, pushCommand } from "@headless-paint/history";

// ストローク終了時
const { inputPoints, pipelineConfig } = endStrokeSession(sessionState);

const command = createStrokeCommand(
  inputPoints,
  pipelineConfig,
  { r: 0, g: 0, b: 0, a: 255 },
  3
);

historyState = pushCommand(historyState, command, layer, config);
```

## createBatchCommand

複数のコマンドをまとめるバッチコマンドを作成。

```typescript
function createBatchCommand(commands: readonly Command[]): BatchCommand
```

> **Note**: ストローク描画には `createStrokeCommand` の使用を推奨します。

## getCommandLabel

コマンドの表示用ラベルを取得。

```typescript
function getCommandLabel(command: Command): string
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `command` | `Command` | ラベルを取得するコマンド |

### 戻り値

`string` - 表示用ラベル

### 戻り値の例

| コマンドタイプ | 戻り値 |
|--------------|--------|
| `drawPath` | `"drawPath (15 points)"` |
| `drawLine` | `"drawLine"` |
| `drawCircle` | `"drawCircle (r=50)"` |
| `clear` | `"clear"` |
| `stroke` | `"stroke (10 points, 6 strokes)"` |
| `batch` | `"batch (3 commands)"` |
