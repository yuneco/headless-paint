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
