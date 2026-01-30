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
