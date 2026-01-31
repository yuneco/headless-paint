# レンダリング API

ビュー変換を適用してレイヤーを Canvas に描画する関数群です。

## ViewTransform

`@headless-paint/input` パッケージで定義されるビュー変換行列。
パン・ズーム・回転情報を含む 3x3 行列（gl-matrix の mat3 形式）。

```typescript
import type { ViewTransform } from "@headless-paint/input";
```

---

## renderLayerWithTransform

ビュー変換を適用してレイヤーを描画する。

```typescript
function renderLayerWithTransform(
  layer: Layer,
  ctx: CanvasRenderingContext2D,
  transform: ViewTransform,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 描画するレイヤー |
| `ctx` | `CanvasRenderingContext2D` | ○ | 描画先のコンテキスト |
| `transform` | `ViewTransform` | ○ | 適用するビュー変換 |

**処理内容**:
1. `ctx.save()` で状態保存
2. `ctx.setTransform()` でビュー変換を適用
3. レイヤーのcanvasを描画
4. `ctx.restore()` で状態復元

**使用例**:
```typescript
import { createViewTransform, zoom } from "@headless-paint/input";
import { renderLayerWithTransform } from "@headless-paint/engine";

const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");

// ビュー変換を作成（1.5倍ズーム）
let transform = createViewTransform();
transform = zoom(transform, 1.5, canvas.width / 2, canvas.height / 2);

// 描画
ctx.clearRect(0, 0, canvas.width, canvas.height);
renderLayerWithTransform(layer, ctx, transform);
```

---

## renderLayers

複数レイヤーを順番に合成描画する。

```typescript
function renderLayers(
  layers: readonly Layer[],
  ctx: CanvasRenderingContext2D,
  transform: ViewTransform,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layers` | `readonly Layer[]` | ○ | 描画するレイヤーの配列（背面から前面順） |
| `ctx` | `CanvasRenderingContext2D` | ○ | 描画先のコンテキスト |
| `transform` | `ViewTransform` | ○ | 適用するビュー変換 |

**処理内容**:
- 配列の先頭から順に（背面→前面）描画
- 各レイヤーの `meta.visible` が false のものはスキップ
- 各レイヤーの `meta.opacity` を `globalAlpha` に適用

**使用例**:
```typescript
import { createLayer } from "@headless-paint/engine";
import { createViewTransform } from "@headless-paint/input";

const background = createLayer(1920, 1080, { name: "Background" });
const drawing = createLayer(1920, 1080, { name: "Drawing" });
const layers = [background, drawing];

const transform = createViewTransform();
renderLayers(layers, ctx, transform);
```

---

## Minimapへの応用

ミニマップ（全体ビュー）には別のビュー変換を適用します。

```typescript
// メインビュー
renderLayerWithTransform(layer, mainCtx, viewTransform);

// ミニマップ用の変換（レイヤー全体が収まるようにスケール）
const minimapScale = minimapWidth / layer.width;
const minimapTransform = zoom(createViewTransform(), minimapScale, 0, 0);
renderLayerWithTransform(layer, minimapCtx, minimapTransform);
```
