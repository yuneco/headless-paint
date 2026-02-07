# 型定義

## Point

2次元座標を表す基本型。

```typescript
interface Point {
  x: number;
  y: number;
}
```

**使用例**:
```typescript
const point: Point = { x: 100, y: 200 };
```

## Color

RGBA色を表す型。各成分は 0-255 の整数値。

```typescript
interface Color {
  r: number;  // 赤 (0-255)
  g: number;  // 緑 (0-255)
  b: number;  // 青 (0-255)
  a: number;  // アルファ (0=透明, 255=不透明)
}
```

**使用例**:
```typescript
const red: Color = { r: 255, g: 0, b: 0, a: 255 };
const semiTransparentBlue: Color = { r: 0, g: 0, b: 255, a: 128 };
```

## StrokePoint

Point を拡張し、筆圧情報を含む型。ペンタブレット入力などで使用。

```typescript
interface StrokePoint extends Point {
  pressure?: number;  // 筆圧 (オプション)
}
```

**使用例**:
```typescript
const strokePoint: StrokePoint = { x: 50, y: 50, pressure: 0.8 };
```

## LayerMeta

レイヤーのメタデータを表す型。

```typescript
interface LayerMeta {
  name: string;      // レイヤー名
  visible: boolean;  // 表示/非表示
  opacity: number;   // 不透明度 (0.0-1.0)
  compositeOperation?: GlobalCompositeOperation;  // 合成モード
}
```

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `name` | `string` | `"Layer"` | レイヤー名 |
| `visible` | `boolean` | `true` | 表示/非表示 |
| `opacity` | `number` | `1` | 不透明度（0.0〜1.0） |
| `compositeOperation` | `GlobalCompositeOperation` | `undefined` | レイヤー合成時の合成モード。`undefined` は `"source-over"`（通常合成）。消しゴムのpendingレイヤープレビューでは `"destination-out"` を設定する |

**使用例**:
```typescript
const meta: LayerMeta = {
  name: "Background",
  visible: true,
  opacity: 0.8,
};

// 消しゴムプレビュー用に合成モードを設定
pendingLayer.meta.compositeOperation = "destination-out";
```

## Layer

ペイントレイヤーの本体。すべてのプロパティは readonly。

```typescript
interface Layer {
  readonly width: number;                           // 幅（ピクセル）
  readonly height: number;                          // 高さ（ピクセル）
  readonly canvas: OffscreenCanvas;                 // キャンバス
  readonly ctx: OffscreenCanvasRenderingContext2D;  // 2Dコンテキスト
  readonly meta: LayerMeta;                         // メタデータ
}
```

**注意**: Layer は `createLayer()` 関数で作成する。直接コンストラクトしない。

---

## ExpandMode

対称展開モードの種類。

```typescript
type ExpandMode = "none" | "axial" | "radial" | "kaleidoscope";
```

| 値 | 説明 |
|---|---|
| `"none"` | 展開なし（1点→1点） |
| `"axial"` | 線対称（軸対称）展開 |
| `"radial"` | 点対称（回転対称）展開 |
| `"kaleidoscope"` | 万華鏡（回転 + 反射）展開 |

---

## ExpandConfig

対称展開の設定。

```typescript
interface ExpandConfig {
  readonly mode: ExpandMode;
  readonly origin: Point;
  readonly angle: number;
  readonly divisions: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `mode` | `ExpandMode` | 展開モード |
| `origin` | `Point` | 展開の中心点（Layer Space） |
| `angle` | `number` | 対称軸の角度（ラジアン、0=垂直軸）。axial/kaleidoscope で使用。radial では無視される |
| `divisions` | `number` | 分割数（radial/kaleidoscope で使用、2以上） |

**使用例**:
```typescript
const config: ExpandConfig = {
  mode: "radial",
  origin: { x: 500, y: 500 },
  angle: 0,
  divisions: 6,
};
```

---

## CompiledExpand

コンパイル済み展開設定。`compileExpand()` で生成。

```typescript
interface CompiledExpand {
  readonly config: ExpandConfig;
  readonly matrices: readonly Float32Array[];
  readonly outputCount: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `config` | `ExpandConfig` | 元の設定 |
| `matrices` | `readonly Float32Array[]` | 事前計算された変換行列（mat3形式） |
| `outputCount` | `number` | 1入力あたりの出力数 |

---

## BackgroundSettings

背景色の設定。ピクセルデータを持たず、色と表示/非表示のみを管理する。

```typescript
interface BackgroundSettings {
  readonly color: Color;   // 背景色
  readonly visible: boolean; // 表示/非表示
}
```

**使用例**:
```typescript
const bg: BackgroundSettings = {
  color: { r: 255, g: 255, b: 255, a: 255 },
  visible: true,
};
```

**関連定数**:

```typescript
const DEFAULT_BACKGROUND_COLOR: Color = { r: 255, g: 255, b: 255, a: 255 };
```

---

## PressureCurve

入力筆圧(0-1)→出力筆圧(0-1)のマッピングを制御する cubic-bezier カーブの制御点。

```typescript
interface PressureCurve {
  readonly y1: number;  // 第1制御点のy座標 (0-1)
  readonly y2: number;  // 第2制御点のy座標 (0-1)
}
```

端点 `(0,0)→(1,1)` は固定。制御点の x 座標は `1/3`, `2/3` で固定され、y 座標のみ調整可能。

| フィールド | 型 | 説明 |
|---|---|---|
| `y1` | `number` | 第1制御点のy座標（0-1） |
| `y2` | `number` | 第2制御点のy座標（0-1） |

**関連定数**:

```typescript
const DEFAULT_PRESSURE_CURVE: PressureCurve = { y1: 1/3, y2: 2/3 };
```

デフォルト値 `{ y1: 1/3, y2: 2/3 }` は数学的に線形（output = input）。

**カーブの例**:
- `{ y1: 1/3, y2: 2/3 }` — 線形（デフォルト）
- `{ y1: 1, y2: 1 }` — 柔らかい（軽いタッチでも太くなる）
- `{ y1: 0, y2: 1/3 }` — 硬い（強く押さないと太くならない）

---

## StrokeStyle

ストローク描画のスタイル設定。

```typescript
interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity?: number;
  readonly pressureCurve?: PressureCurve;
  readonly compositeOperation?: GlobalCompositeOperation;
}
```

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `color` | `Color` | - | 描画色 |
| `lineWidth` | `number` | - | 線の基準太さ |
| `pressureSensitivity` | `number` | `0` | 筆圧感度（0.0=均一太さ、1.0=最大感度） |
| `pressureCurve` | `PressureCurve` | `undefined` | 筆圧カーブ（undefinedは線形） |
| `compositeOperation` | `GlobalCompositeOperation` | `undefined` | Canvas合成モード。`undefined` は `"source-over"`。消しゴムでは `"destination-out"` を指定 |

**筆圧感度の動作**:
- `0`: 全ポイントが `lineWidth` で均一描画
- `1`: 筆圧に完全比例（`lineWidth * pressure` が直径）
- `0〜1`: 均一太さと筆圧太さの線形補間

**筆圧カーブの動作**:
- `pressureCurve` が設定されている場合、筆圧感度の計算前に入力筆圧をカーブで変換する
- `undefined` の場合は変換なし（線形のまま）

**合成モードの動作**:
- `"source-over"`（デフォルト）: 通常の加算描画
- `"destination-out"`: 消しゴムモード（描画した箇所を透明にする）
- その他の `GlobalCompositeOperation` 値も将来的にサポート可能
