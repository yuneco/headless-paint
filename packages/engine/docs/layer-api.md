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

## cloneLayer

レイヤーのサイズ・メタデータ・pixels を複製した新しいレイヤーを作成する。

```typescript
interface CloneLayerOptions {
  readonly id?: string;
  readonly meta?: Partial<LayerMeta>;
  readonly copyPixels?: boolean;
}

function cloneLayer(source: Layer, options?: CloneLayerOptions): Layer
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `source` | `Layer` | ○ | 複製元レイヤー |
| `options.id` | `string` | - | 復元・redo 用に指定する複製先 ID |
| `options.meta` | `Partial<LayerMeta>` | - | 複製先メタデータの上書き |
| `options.copyPixels` | `boolean` | - | pixels をコピーするか。既定値は `true` |

**戻り値**: `Layer`

**特記事項**:
- `source.width` / `source.height` と同じサイズの新規レイヤーを作成する。
- `options.meta` は source の `meta` に上書き適用される。
- `options.id` は履歴 replay / redo で決定的な ID を使うための指定。

**使用例**:
```typescript
const duplicate = cloneLayer(sourceLayer, {
  meta: { name: "Layer copy" },
});
```

---

## copyLayerPixels

target を透明にクリアしてから、source の pixels を `source-over` でコピーする。

```typescript
function copyLayerPixels(source: Layer, target: Layer): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `source` | `Layer` | ○ | コピー元レイヤー |
| `target` | `Layer` | ○ | コピー先レイヤー |

**特記事項**:
- `target` の既存 pixels はコピー前に消去される。
- `LayerMeta` は変更しない。

---

## mergeLayerDown

source layer を target layer に焼き込み、target の pixels と meta を統合後の状態に更新する。

```typescript
interface MergeLayerDownOptions {
  readonly resultMeta?: Partial<LayerMeta>;
}

function mergeLayerDown(
  targetLayer: Layer,
  sourceLayer: Layer,
  options?: MergeLayerDownOptions,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `targetLayer` | `Layer` | ○ | 焼き込み先。レイヤースタック上の直下レイヤー |
| `sourceLayer` | `Layer` | ○ | 焼き込むレイヤー |
| `options.resultMeta` | `Partial<LayerMeta>` | - | 統合後 target meta の上書き |

**特記事項**:
- target / source の `opacity` と `compositeOperation` を考慮して target pixels に焼き込む。
- 統合後 target meta は既定で target の `name` / `visible` を維持し、`opacity: 1`, `compositeOperation: "source-over"` に正規化される。
- `visible` は pixel burning を gate しない。非表示レイヤーの pixel buffer も統合対象になる。
- non-normal blend mode や backdrop 依存の見た目を含む場合、全スタック表示結果の完全維持は保証しない。これは2レイヤーの破壊的統合として扱う。

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
