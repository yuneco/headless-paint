# レンダリング API

ビュー変換を適用してレイヤーを Canvas に描画する関数群です。

## transform（mat3）

外部利用では `@yuneco/headless-paint/core` から `ViewTransform` として import できるビュー変換行列。
実装上は input パッケージで定義される。
パン・ズーム・回転情報を含む 3x3 行列（gl-matrix の `mat3` 形式）。

```typescript
import type { mat3 } from "gl-matrix";
// or
import type { ViewTransform } from "@yuneco/headless-paint/core";  // ViewTransform = mat3
```

---

## renderLayerWithTransform

ビュー変換を適用してレイヤーを描画する。

```typescript
function renderLayerWithTransform(
  layer: Layer,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  transform: mat3,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 描画するレイヤー |
| `ctx` | `CanvasRenderingContext2D \| OffscreenCanvasRenderingContext2D` | ○ | 描画先のコンテキスト |
| `transform` | `mat3` | ○ | 適用するビュー変換（gl-matrix の mat3 形式） |

**処理内容**:
1. `ctx.save()` で状態保存
2. `ctx.setTransform()` でビュー変換を適用
3. レイヤーのcanvasを描画
4. `ctx.restore()` で状態復元

**使用例**:
```typescript
import { createViewTransform, zoom } from "@yuneco/headless-paint/core";
import { renderLayerWithTransform } from "@yuneco/headless-paint/core";

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

## RenderOptions

`renderLayers` に渡すオプション。

```typescript
interface RenderOptions {
  background?: BackgroundSettings;
  pendingOverlay?: PendingOverlay;
  layerTransformPreview?: LayerTransformPreview;
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `background` | `BackgroundSettings` | - | 背景設定。`visible: true` の場合、レイヤー領域に背景色を描画 |
| `pendingOverlay` | `PendingOverlay` | - | pending レイヤーのプレ合成情報。指定時は対象 committed レイヤーと pending を正しく合成する |
| `layerTransformPreview` | `LayerTransformPreview` | - | レイヤー変換プレビュー。指定時は対象レイヤーの描画にレイヤーローカル変換を合成する |

---

## renderLayers

複数レイヤーを順番に合成描画する。

```typescript
function renderLayers(
  layers: readonly Layer[],
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  transform: mat3,
  options?: RenderOptions,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layers` | `readonly Layer[]` | ○ | 描画するレイヤーの配列（背面から前面順） |
| `ctx` | `CanvasRenderingContext2D \| OffscreenCanvasRenderingContext2D` | ○ | 描画先のコンテキスト |
| `transform` | `mat3` | ○ | 適用するビュー変換（gl-matrix の mat3 形式） |
| `options` | `RenderOptions` | - | 背景設定などのオプション |

**処理内容**:
1. `options.background` が `visible: true` の場合、ビュー変換を適用してレイヤー領域に背景色を描画
2. 配列の先頭から順に（背面→前面）描画
3. 各レイヤーの `meta.visible` が false のものはスキップ
4. `pendingOverlay` が指定されており、対象レイヤーにプレ合成が必要な場合:
   - workLayer に committed + pending をプレ合成（pending は `meta.compositeOperation` で合成）
   - workLayer を committed の `meta.opacity` / `meta.compositeOperation` で描画
5. プレ合成不要な場合は committed → pending の順でフラット描画（従来と同等）
6. 各レイヤーの `meta.opacity` を `globalAlpha` に、`meta.compositeOperation` を `globalCompositeOperation` に適用

**使用例**:
```typescript
import { createLayer, DEFAULT_BACKGROUND_COLOR } from "@yuneco/headless-paint/core";
import { createViewTransform } from "@yuneco/headless-paint/core";

const drawing = createLayer(1920, 1080, { name: "Drawing" });
const layers = [drawing];

const transform = createViewTransform();

// 背景付きで描画
renderLayers(layers, ctx, transform, {
  background: { color: DEFAULT_BACKGROUND_COLOR, visible: true },
});

// 背景なし（従来互換）
renderLayers(layers, ctx, transform);
```

---

## DPR（Device Pixel Ratio）対応

高DPIディスプレイ（Retina等）でシャープな描画を行うには、DPRを考慮した処理が必要です。

`renderLayerWithTransform` は内部で `ctx.setTransform()` を使用するため、呼び出し前に設定した `ctx.scale(dpr, dpr)` がリセットされます。そのため、DPR スケーリングをビュー変換行列に含める必要があります。

外部利用では `@yuneco/headless-paint/core` から import できる `applyDpr` ユーティリティを使うと簡潔に対応できます。

```typescript
import { applyDpr } from "@yuneco/headless-paint/core";

// 1. キャンバスのDPR対応
const dpr = window.devicePixelRatio;
canvas.width = width * dpr;
canvas.height = height * dpr;
ctx.scale(dpr, dpr);

// 2. 背景描画（DPRスケーリングが適用される）
ctx.fillStyle = "#f0f0f0";
ctx.fillRect(0, 0, width, height);

// 3. DPRを含めた変換行列を作成してレイヤー描画
const dprTransform = applyDpr(transform, dpr);
renderLayerWithTransform(layer, ctx, dprTransform);

// 4. その他の描画（DPRスケーリングは restore 後に戻る）
ctx.strokeStyle = "#444";
ctx.strokeRect(0, 0, 100, 100);  // DPRスケーリング適用
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
