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
}
```

**使用例**:
```typescript
const meta: LayerMeta = {
  name: "Background",
  visible: true,
  opacity: 0.8,
};
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
| `angle` | `number` | 対称軸の角度（ラジアン、0=垂直軸） |
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

## StrokeStyle

ストローク描画のスタイル設定。

```typescript
interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `color` | `Color` | 描画色 |
| `lineWidth` | `number` | 線の太さ |
