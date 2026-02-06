# @headless-paint/engine

ヘッドレス環境で動作するCanvas2Dベースのペイントエンジンです。

## インストール

```bash
pnpm add @headless-paint/engine
```

## 基本的な使い方

```typescript
import {
  createLayer,
  drawLine,
  drawCircle,
  drawPath,
  getPixel,
  setPixel,
} from "@headless-paint/engine";

// レイヤーを作成
const layer = createLayer(640, 480, { name: "MyLayer" });

// 描画
drawLine(layer, { x: 10, y: 10 }, { x: 100, y: 100 }, { r: 255, g: 0, b: 0, a: 255 }, 2);
drawCircle(layer, { x: 200, y: 200 }, 50, { r: 0, g: 255, b: 0, a: 255 });

// ピクセル操作
const pixel = getPixel(layer, 50, 50);
setPixel(layer, 60, 60, { r: 0, g: 0, b: 255, a: 255 });
```

## API リファレンス

### 型定義

詳細は [types.md](./types.md) を参照。

| 型 | 説明 |
|---|---|
| `Point` | 2D座標 `{ x, y }` |
| `Color` | RGBA色 `{ r, g, b, a }` (各値 0-255) |
| `StrokePoint` | Point + 筆圧 `{ x, y, pressure? }` |
| `LayerMeta` | レイヤーメタデータ `{ name, visible, opacity }` |
| `Layer` | レイヤー本体（width, height, canvas, ctx, meta） |
| `BackgroundSettings` | 背景設定 `{ color, visible }` |

### Layer 管理関数

詳細は [layer-api.md](./layer-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createLayer(width, height, meta?)` | 新規レイヤー作成 |
| `clearLayer(layer)` | レイヤーをクリア |
| `getPixel(layer, x, y)` | ピクセル色を取得 |
| `setPixel(layer, x, y, color)` | ピクセル色を設定 |
| `getImageData(layer)` | ImageData を取得 |
| `colorToStyle(color)` | Color を CSS文字列に変換 |

### 描画関数

詳細は [draw-api.md](./draw-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `drawLine(layer, from, to, color, lineWidth?)` | 直線を描画 |
| `drawCircle(layer, center, radius, color)` | 塗りつぶし円を描画 |
| `drawPath(layer, points, color, lineWidth?)` | パス（連続線）を描画 |
| `drawVariableWidthPath(layer, points, color, baseLineWidth, pressureSensitivity)` | 可変太さパス描画（筆圧対応） |
| `calculateRadius(pressure, baseLineWidth, pressureSensitivity)` | 筆圧から描画半径を計算 |
| `interpolateStrokePoints(points)` | Catmull-Romスプライン補間 |

### レンダリング関数

詳細は [render-api.md](./render-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `renderLayerWithTransform(layer, ctx, transform)` | ビュー変換を適用してレイヤーを描画 |
| `renderLayers(layers, ctx, transform, options?)` | 複数レイヤーを合成描画（背景設定対応） |

### Expand 関数

詳細は [expand-api.md](./expand-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `compileExpand(config)` | 展開設定をコンパイル |
| `expandPoint(point, compiled)` | 単一点を展開 |
| `expandStroke(points, compiled)` | ストローク全体を展開（Point版） |
| `expandStrokePoints(points, compiled)` | ストローク全体を展開（StrokePoint版、pressure保持） |
| `getExpandCount(config)` | 展開の出力数を取得 |
| `createDefaultExpandConfig(width, height)` | デフォルト設定を作成 |

### 差分描画 API

詳細は [incremental-render-api.md](./incremental-render-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `appendToCommittedLayer(layer, points, style, expand)` | 確定レイヤーに追加描画 |
| `renderPendingLayer(layer, points, style, expand)` | 作業レイヤーを再描画 |
| `composeLayers(target, layers, transform?)` | レイヤーを合成 |

## アーキテクチャ

- **Canvas2D ベース**: OffscreenCanvas を使用し、Node.js や Worker でも動作可能
- **関数型設計**: Layer を受け取る純粋関数として設計
- **イミュータブル**: Layer のプロパティは readonly
- **エラー許容**: 範囲外アクセスはエラーを投げず安全な値を返す
