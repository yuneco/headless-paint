# Expand API

入力点を対称展開する関数群。描画時に適用される。

## 概要

### 設計思想

Expandは「1点→N点」の展開処理であり、描画時に適用される。これはフィルタ処理（N点→M点、入力時に適用）とは根本的に異なる処理モデル。

```
入力点 → filter（入力時） → 1ストローク → expand（描画時） → N本の描画
```

WebGLで例えると：
- **filter**: 頂点シェーダー的（入力の前処理）
- **expand**: 描画パイプライン内処理（出力の展開）

### 遅延適用の利点

- セッション管理がシンプル（常に1本のストローク）
- pending/committed の管理が容易
- 履歴には入力点のみ保存し、リプレイ時に再展開

### 多段対称展開（Multi-Level Expand）

データモデルはN段の展開に対応している。`ExpandConfig` は `ExpandLevel` の配列を持ち、各レベルが独立したモード・分割数・位置を定義する。

**行列合成**: 各レベルを **T_level（位置+回転）** と **ローカル回転/反射行列** に分離し、ツリー走査で合成する。

```
M(i, j) = T_root * R_root_i * T_child * R_child_j
```

- `T_root = translate(root.offset) * rotate(root.angle)` -- 親の位置+角度
- `R_root_i` = ローカル回転/反射（mode/divisions で決定）
- `T_child = translate(child.offset) * rotate(autoAngle + child.angle)` -- 親ローカル空間内での子の位置+方向
- `R_child_j` = ローカル回転/反射

**auto-angle**: 子レベルの回転角は `atan2(offset.y, offset.x) + child.angle` で自動計算される。親の angle は `T_root` に含まれるため、行列合成で子の位置・方向に自動反映される。

**正規化**: `M_norm(i,j) = M(i,j) * inverse(M(0,0))` により、第一出力 = identity（入力座標がそのまま残る）を保証する。

**`CompiledExpand` の出力は従来通りフラットな行列配列** であるため、下流（描画・セッション・ヒストリ）の変更は不要。

---

## 型定義

### ExpandLevel

1レベル分の展開設定。

```typescript
interface ExpandLevel {
  readonly mode: ExpandMode;
  readonly offset: Point;     // root: 絶対座標, child: 親からの相対座標
  readonly angle: number;     // root: 座標系回転角度, child: autoAngle に加算される自前角度
  readonly divisions: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `mode` | `ExpandMode` | 展開モード |
| `offset` | `Point` | root: 絶対座標（展開の中心点）、child: 親からの相対座標 |
| `angle` | `number` | root: 座標系の回転角度（ラジアン）、child: auto-angle に加算される自前角度 |
| `divisions` | `number` | 分割数（radial/kaleidoscope で使用、2以上） |

### ExpandConfig

多段対称展開の設定。levels 配列の各要素が1段の展開を定義する。

```typescript
interface ExpandConfig {
  readonly levels: readonly ExpandLevel[];
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `levels` | `readonly ExpandLevel[]` | 展開レベルの配列。1要素で従来の単一レベル展開と同等 |

---

## compileExpand

展開設定を事前コンパイルする。設定変更時に1回だけ呼び出す。内部で多段展開の行列合成と正規化を行う。

```typescript
function compileExpand(config: ExpandConfig): CompiledExpand
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `config` | `ExpandConfig` | ○ | 展開設定 |

**戻り値**: `CompiledExpand` - コンパイル済み展開設定

**使用例**:
```typescript
import { compileExpand } from "@headless-paint/engine";

// 単一レベル: 6分割の回転対称
const compiled = compileExpand({
  levels: [
    { mode: "radial", offset: { x: 500, y: 500 }, angle: 0, divisions: 6 },
  ],
});

// 展開なし
const noExpand = compileExpand({
  levels: [
    { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
  ],
});

// 多段展開: 親 radial 3分割 × 子 kaleidoscope 4分割 = 24コピー
const multiLevel = compileExpand({
  levels: [
    { mode: "radial", offset: { x: 400, y: 300 }, angle: 0, divisions: 3 },
    { mode: "kaleidoscope", offset: { x: 0, y: -80 }, angle: 0, divisions: 4 },
  ],
});
// multiLevel.outputCount === 3 * 8 = 24
// multiLevel.matrices[0] は identity（第一出力 = 入力）
```

---

## compileLocalTransforms

1レベル分のローカル回転/反射行列を生成する。angle パラメータは使用しない（angle は T_level 側で処理される）。

```typescript
function compileLocalTransforms(mode: ExpandMode, divisions: number): mat3[]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `mode` | `ExpandMode` | ○ | 展開モード |
| `divisions` | `number` | ○ | 分割数 |

**戻り値**: `mat3[]` - ローカル空間での回転/反射行列の配列

**モード別出力**:
| モード | 出力行列 |
|--------|----------|
| `none` | `[identity]` （1個） |
| `axial` | `[identity, reflect_axis(0)]` （2個） |
| `radial` | `[rotate(2*pi*i/n)]` for i=0..n-1 （n個） |
| `kaleidoscope` | for i=0..n-1: `[rotate(2*pi*i/n), reflect_axis(2*pi*i/n + pi/n)]` （n*2個） |

**使用例**:
```typescript
import { compileLocalTransforms } from "@headless-paint/engine";

// radial 6分割のローカル行列
const matrices = compileLocalTransforms("radial", 6);
// 6個の回転行列が返る（0°, 60°, 120°, 180°, 240°, 300°）

// kaleidoscope 4分割のローカル行列
const kaleidoMatrices = compileLocalTransforms("kaleidoscope", 4);
// 8個の行列が返る（回転4個 + 反射4個）
```

---

## expandPoint

単一の点を展開する。

```typescript
function expandPoint(point: Point, compiled: CompiledExpand): Point[]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `point` | `Point` | ○ | 入力点（Layer Space） |
| `compiled` | `CompiledExpand` | ○ | コンパイル済み展開設定 |

**戻り値**: `Point[]` - 展開された点の配列

**使用例**:
```typescript
const expandedPoints = expandPoint({ x: 100, y: 100 }, compiled);
// 6分割対称なら6点の配列が返る
// 多段展開なら全レベルの積の数だけ返る
```

---

## expandStroke

ストローク全体を展開する。

```typescript
function expandStroke(
  points: readonly Point[],
  compiled: CompiledExpand
): Point[][]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `points` | `readonly Point[]` | ○ | 入力点列 |
| `compiled` | `CompiledExpand` | ○ | コンパイル済み展開設定 |

**戻り値**: `Point[][]` - 展開されたストローク群（各ストロークは点の配列）

**使用例**:
```typescript
// 元のストローク
const inputPoints = [
  { x: 100, y: 100 },
  { x: 150, y: 120 },
  { x: 200, y: 110 },
];

// 展開（6分割対称なら6本のストロークになる）
const strokes = expandStroke(inputPoints, compiled);

// 各ストロークを描画
for (const stroke of strokes) {
  drawPath(layer, stroke, color, lineWidth);
}
```

---

## getExpandCount

展開設定の出力数を取得する。多段展開の場合、全レベルの出力数の積を返す。

```typescript
function getExpandCount(config: ExpandConfig): number
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `config` | `ExpandConfig` | ○ | 展開設定 |

**戻り値**: `number` - 1入力あたりの出力数（全レベルの積）

**モード別出力数**（1レベルあたり）:
| モード | 出力数 |
|--------|--------|
| `none` | 1 |
| `axial` | 2 |
| `radial` | divisions |
| `kaleidoscope` | divisions * 2 |

多段展開では各レベルの出力数を乗算する。

**使用例**:
```typescript
// 単一レベル: radial 6分割
const count1 = getExpandCount({
  levels: [{ mode: "radial", offset: { x: 500, y: 500 }, angle: 0, divisions: 6 }],
});
// count1 === 6

// 多段展開: radial 3分割 × kaleidoscope 4分割
const count2 = getExpandCount({
  levels: [
    { mode: "radial", offset: { x: 400, y: 300 }, angle: 0, divisions: 3 },
    { mode: "kaleidoscope", offset: { x: 0, y: -80 }, angle: 0, divisions: 4 },
  ],
});
// count2 === 3 * (4 * 2) = 24

// levels が空の場合
const count3 = getExpandCount({ levels: [] });
// count3 === 1
```

---

## createDefaultExpandConfig

デフォルトの展開設定を作成する。

```typescript
function createDefaultExpandConfig(width: number, height: number): ExpandConfig
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `width` | `number` | ○ | レイヤーの幅 |
| `height` | `number` | ○ | レイヤーの高さ |

**戻り値**: `ExpandConfig` - 1レベル、mode="none"、offset=中心点の設定

**使用例**:
```typescript
const config = createDefaultExpandConfig(1920, 1080);
// { levels: [{ mode: "none", offset: { x: 960, y: 540 }, angle: 0, divisions: 6 }] }
```

---

## expandStrokePoints

StrokePoint版のストローク展開。座標を変換しつつ、pressure値をそのまま保持する。

```typescript
function expandStrokePoints(
  points: readonly StrokePoint[],
  compiled: CompiledExpand,
): StrokePoint[][]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `points` | `readonly StrokePoint[]` | ○ | 入力StrokePoint列 |
| `compiled` | `CompiledExpand` | ○ | コンパイル済み展開設定 |

**戻り値**: `StrokePoint[][]` - 展開されたストローク群（各ストロークはStrokePointの配列）

**動作**:
- 座標（x, y）は `expandPoint` と同様に変換行列で変換
- `pressure` は元の値をそのままコピー（全展開ストロークで同じ筆圧）

**使用例**:
```typescript
const strokePoints: StrokePoint[] = [
  { x: 100, y: 100, pressure: 0.5 },
  { x: 150, y: 120, pressure: 0.8 },
];

const strokes = expandStrokePoints(strokePoints, compiled);
for (const stroke of strokes) {
  drawVariableWidthPath(layer, stroke, color, lineWidth, pressureSensitivity);
}
```
