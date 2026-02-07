# 描画 API

## drawLine

2点間に直線を描画する。

```typescript
function drawLine(
  layer: Layer,
  from: Point,
  to: Point,
  color: Color,
  lineWidth?: number,
): void
```

**引数**:
| 名前 | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `layer` | `Layer` | ○ | - | 対象レイヤー |
| `from` | `Point` | ○ | - | 開始点 |
| `to` | `Point` | ○ | - | 終了点 |
| `color` | `Color` | ○ | - | 線の色 |
| `lineWidth` | `number` | - | `1` | 線の太さ |

**描画設定**:
- `lineCap: "round"` - 線の終端が丸い

**使用例**:
```typescript
const red = { r: 255, g: 0, b: 0, a: 255 };

// 基本
drawLine(layer, { x: 0, y: 0 }, { x: 100, y: 100 }, red);

// 太い線
drawLine(layer, { x: 0, y: 50 }, { x: 100, y: 50 }, red, 5);
```

---

## drawCircle

塗りつぶされた円を描画する。

```typescript
function drawCircle(
  layer: Layer,
  center: Point,
  radius: number,
  color: Color,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 対象レイヤー |
| `center` | `Point` | ○ | 円の中心 |
| `radius` | `number` | ○ | 半径（ピクセル） |
| `color` | `Color` | ○ | 塗りつぶし色 |

**使用例**:
```typescript
const blue = { r: 0, g: 0, b: 255, a: 255 };

drawCircle(layer, { x: 200, y: 200 }, 50, blue);
```

---

## drawPath

複数の点を通る連続パス（折れ線）を描画する。

```typescript
function drawPath(
  layer: Layer,
  points: readonly Point[],
  color: Color,
  lineWidth?: number,
): void
```

**引数**:
| 名前 | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `layer` | `Layer` | ○ | - | 対象レイヤー |
| `points` | `readonly Point[]` | ○ | - | パスの点の配列 |
| `color` | `Color` | ○ | - | 線の色 |
| `lineWidth` | `number` | - | `1` | 線の太さ |

**描画設定**:
- `lineCap: "round"` - 線の終端が丸い
- `lineJoin: "round"` - コーナーが丸い

**特記事項**:
- 空配列を渡した場合は何も描画しない

**使用例**:
```typescript
const green = { r: 0, g: 255, b: 0, a: 255 };

// 三角形の輪郭
const triangle = [
  { x: 50, y: 10 },
  { x: 90, y: 90 },
  { x: 10, y: 90 },
  { x: 50, y: 10 }, // 閉じる
];
drawPath(layer, triangle, green, 2);

// フリーハンド風の線
const freehand = [
  { x: 10, y: 10 },
  { x: 20, y: 15 },
  { x: 30, y: 12 },
  { x: 40, y: 18 },
];
drawPath(layer, freehand, green);
```

---

## applyPressureCurve

筆圧カーブを適用する。パラメトリック cubic-bezier で入力筆圧を変換する。

```typescript
function applyPressureCurve(
  pressure: number,
  curve: PressureCurve,
): number
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `pressure` | `number` | ○ | 入力筆圧（0.0〜1.0） |
| `curve` | `PressureCurve` | ○ | カーブの制御点 |

**戻り値**: `number` - 変換後の筆圧（0.0〜1.0）

**計算式**: `output = 3 * mt² * t * y1 + 3 * mt * t² * y2 + t³` (t=pressure, mt=1-t)

---

## calculateRadius

筆圧から描画半径を計算する。

```typescript
function calculateRadius(
  pressure: number | undefined,
  baseLineWidth: number,
  pressureSensitivity: number,
  pressureCurve?: PressureCurve,
): number
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `pressure` | `number \| undefined` | ○ | 筆圧値（0.0〜1.0、undefinedはデフォルト0.5） |
| `baseLineWidth` | `number` | ○ | 基準線幅 |
| `pressureSensitivity` | `number` | ○ | 筆圧感度（0.0〜1.0） |
| `pressureCurve` | `PressureCurve` | - | 筆圧カーブ（undefinedは変換なし） |

**戻り値**: `number` - 描画半径（ピクセル）

**計算ロジック**:
1. `pressureCurve` がある場合、`applyPressureCurve` で筆圧を変換
2. `sensitivity=0`: `baseLineWidth / 2`（均一）
3. `sensitivity=1`: `baseLineWidth * pressure`（筆圧比例）
4. 中間値: 均一と筆圧の線形補間

---

## interpolateStrokePoints

Catmull-Romスプラインでポイント列を補間する。描画の滑らかさを向上させる。

```typescript
function interpolateStrokePoints(
  points: readonly StrokePoint[],
): StrokePoint[]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `points` | `readonly StrokePoint[]` | ○ | 入力ポイント列 |

**戻り値**: `StrokePoint[]` - 補間されたポイント列（x, y はCatmull-Rom、pressureは線形補間）

**特記事項**:
- 2点未満の場合はそのままコピーを返す
- ポイント間の距離に応じて補間点数を自動決定
- 描画関数の内部で使用される（FilterPipelineではなく描画時に適用）

---

## drawVariableWidthPath

可変太さでパスを描画する。各ポイントに筆圧対応の円を描画し、隣接点間を台形ポリゴンで接続する。

```typescript
function drawVariableWidthPath(
  layer: Layer,
  points: readonly StrokePoint[],
  color: Color,
  baseLineWidth: number,
  pressureSensitivity: number,
  pressureCurve?: PressureCurve,
  compositeOperation?: GlobalCompositeOperation,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 対象レイヤー |
| `points` | `readonly StrokePoint[]` | ○ | ポイント列（pressure含む） |
| `color` | `Color` | ○ | 描画色 |
| `baseLineWidth` | `number` | ○ | 基準線幅 |
| `pressureSensitivity` | `number` | ○ | 筆圧感度（0.0〜1.0） |
| `pressureCurve` | `PressureCurve` | - | 筆圧カーブ（undefinedは変換なし） |
| `compositeOperation` | `GlobalCompositeOperation` | - | Canvas合成モード（undefinedは `"source-over"`） |

**描画手順**:
1. `compositeOperation` が指定されている場合、`ctx.globalCompositeOperation` を設定
2. ポイント列をCatmull-Romスプラインで補間
3. 各ポイントの筆圧から半径を計算（`calculateRadius`）
4. 各ポイントに円を描画（fill）
5. 隣接ポイント間を台形ポリゴンで接続（fill）
6. `compositeOperation` を元の値に復元

**特記事項**:
- `pressureSensitivity=0` でも正常動作（均一太さの円+台形描画）
- committed/pending差分描画と互換性あり
- 消しゴムモード: `compositeOperation="destination-out"` で既存ピクセルを消去
