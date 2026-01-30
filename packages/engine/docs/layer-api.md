# Layer 管理 API

## createLayer

新しいレイヤーを作成する。

```typescript
function createLayer(
  width: number,
  height: number,
  meta?: Partial<LayerMeta>,
): Layer
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `width` | `number` | ○ | レイヤーの幅 |
| `height` | `number` | ○ | レイヤーの高さ |
| `meta` | `Partial<LayerMeta>` | - | メタデータ（部分指定可） |

**戻り値**: `Layer`

**デフォルトメタデータ**:
```typescript
{ name: "Layer", visible: true, opacity: 1 }
```

**使用例**:
```typescript
// 基本
const layer = createLayer(640, 480);

// メタデータ付き
const background = createLayer(1920, 1080, {
  name: "Background",
  opacity: 0.5,
});
```

---

## clearLayer

レイヤー全体を透明にクリアする。

```typescript
function clearLayer(layer: Layer): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 対象レイヤー |

**使用例**:
```typescript
clearLayer(layer);
```

---

## getPixel

指定座標のピクセル色を取得する。

```typescript
function getPixel(layer: Layer, x: number, y: number): Color
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 対象レイヤー |
| `x` | `number` | ○ | X座標 |
| `y` | `number` | ○ | Y座標 |

**戻り値**: `Color`

**特記事項**:
- 座標は自動的に整数化（`Math.floor`）
- 範囲外の座標は `{ r: 0, g: 0, b: 0, a: 0 }` を返す

**使用例**:
```typescript
const pixel = getPixel(layer, 100, 200);
console.log(pixel); // { r: 255, g: 128, b: 64, a: 255 }
```

---

## setPixel

指定座標にピクセル色を設定する。

```typescript
function setPixel(layer: Layer, x: number, y: number, color: Color): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 対象レイヤー |
| `x` | `number` | ○ | X座標 |
| `y` | `number` | ○ | Y座標 |
| `color` | `Color` | ○ | 設定する色 |

**特記事項**:
- 座標は自動的に整数化（`Math.floor`）
- 範囲外の座標は無視される（エラーなし）

**使用例**:
```typescript
setPixel(layer, 50, 50, { r: 255, g: 0, b: 0, a: 255 });
```

---

## getImageData

レイヤー全体の ImageData を取得する。

```typescript
function getImageData(layer: Layer): ImageData
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 対象レイヤー |

**戻り値**: `ImageData` - Canvas の ImageData オブジェクト

**用途**:
- ピクセルデータへの直接アクセス
- バッチ処理による高速操作
- 画像エクスポート

**使用例**:
```typescript
const imageData = getImageData(layer);
const pixels = imageData.data; // Uint8ClampedArray [r,g,b,a,r,g,b,a,...]

// 全ピクセルを走査
for (let i = 0; i < pixels.length; i += 4) {
  const r = pixels[i];
  const g = pixels[i + 1];
  const b = pixels[i + 2];
  const a = pixels[i + 3];
}
```

---

## colorToStyle

Color を Canvas の strokeStyle/fillStyle 用の CSS 文字列に変換する。

```typescript
function colorToStyle(color: Color): string
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `color` | `Color` | ○ | 変換する色 |

**戻り値**: `string` - `"rgba(r, g, b, a)"` 形式

**注意**: アルファ値は 0-255 から 0.0-1.0 に自動変換される

**使用例**:
```typescript
const style = colorToStyle({ r: 255, g: 0, b: 0, a: 255 });
console.log(style); // "rgba(255, 0, 0, 1)"

const semiTransparent = colorToStyle({ r: 0, g: 128, b: 255, a: 128 });
console.log(semiTransparent); // "rgba(0, 128, 255, 0.5019607843137255)"
```
