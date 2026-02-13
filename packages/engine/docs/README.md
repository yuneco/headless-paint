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
| `BrushDynamics` | スタンプブラシの動的パラメータ（全 required） |
| `LayerMeta` | レイヤーメタデータ `{ name, visible, opacity, compositeOperation? }` |
| `Layer` | レイヤー本体（id, width, height, canvas, ctx, meta） |
| `ExpandLevel` | 1レベル分の展開設定 `{ mode, offset, angle, divisions }` |
| `PressureCurve` | 筆圧カーブ制御点 `{ y1, y2 }` |
| `BackgroundSettings` | 背景設定 `{ color, visible }` |
| `BrushConfig` | ブラシ設定（判別共用体: `RoundPenBrushConfig \| StampBrushConfig`） |
| `BrushRenderState` | ブラシレンダリング状態 `{ accumulatedDistance, tipCanvas, seed, stampCount }` |

### Layer 管理関数

詳細は [layer-api.md](./layer-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createLayer(width, height, meta?)` | 新規レイヤー作成（一意の `id` を自動付与） |
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
| `drawVariableWidthPath(layer, points, color, baseLineWidth, pressureSensitivity, pressureCurve?, compositeOperation?, overlapCount?)` | 可変太さパス描画（筆圧対応） |
| `calculateRadius(pressure, baseLineWidth, pressureSensitivity, pressureCurve?)` | 筆圧から描画半径を計算 |
| `applyPressureCurve(pressure, curve)` | 筆圧カーブを適用 |
| `interpolateStrokePoints(points, overlapCount?)` | Catmull-Romスプライン補間 |

### Brush API

詳細は [brush-api.md](./brush-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `renderBrushStroke(layer, points, style, overlapCount?, state?)` | ブラシ種別に応じてストローク描画（ディスパッチ） |
| `generateBrushTip(config, size, color, registry?)` | ブラシチップ画像を生成 |
| `createBrushTipRegistry()` | 画像チップ管理用の `BrushTipRegistry` を作成 |
| `mulberry32(seed)` | 32bit シードから PRNG を生成 |
| `hashSeed(globalSeed, distance)` | 位置固有のシードを生成 |
| `ROUND_PEN` | デフォルトの round-pen ブラシ定数 |
| `AIRBRUSH` | エアブラシプリセット（ソフト円、密間隔・低フロー） |
| `PENCIL` | 鉛筆プリセット（ほぼハード円、微小 jitter） |
| `MARKER` | マーカープリセット（やや柔らか、中間フロー） |

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
| `compileLocalTransforms(mode, divisions)` | 1レベル分のローカル回転/反射行列を生成 |
| `expandPoint(point, compiled)` | 単一点を展開 |
| `expandStroke(points, compiled)` | ストローク全体を展開（Point版） |
| `expandStrokePoints(points, compiled)` | ストローク全体を展開（StrokePoint版、pressure保持） |
| `getExpandCount(config)` | 展開の出力数を取得 |
| `createDefaultExpandConfig(width, height)` | デフォルト設定を作成 |

### 差分描画 API

詳細は [incremental-render-api.md](./incremental-render-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `appendToCommittedLayer(layer, points, style, expand, overlapCount?, brushState?)` | 確定レイヤーに追加描画。`BrushRenderState` を返す |
| `renderPendingLayer(layer, points, style, expand, brushState?)` | 作業レイヤーを再描画 |
| `composeLayers(target, layers, transform?)` | レイヤーを合成 |

### Pattern Preview

詳細は [pattern-preview-api.md](./pattern-preview-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createPatternTile(layers, config)` | レイヤー内容からパターンタイルを生成 |
| `renderPatternPreview(ctx, tile, config, transform, ...)` | レイヤー領域外にパターンを半透明描画 |

### Layer Collection

| 関数 | 説明 |
|---|---|
| `addLayer(layers, width, height, meta?, insertIndex?)` | レイヤーを追加し `[newLayers, newLayer]` を返す。`insertIndex` 省略時は末尾に追加 |
| `removeLayer(layers, layerId)` | 指定IDのレイヤーを削除 |
| `findLayerById(layers, layerId)` | IDでレイヤーを検索 |
| `getLayerIndex(layers, layerId)` | IDからインデックスを取得（-1 = 未検出） |
| `moveLayer(layers, fromIndex, toIndex)` | レイヤーの順序を変更 |
| `updateLayerMeta(layers, layerId, meta)` | レイヤーのメタデータを更新 |

### Wrap Shift

| 関数 | 説明 |
|---|---|
| `wrapShiftLayer(layer, dx, dy, temp?)` | レイヤー全ピクセルをラップシフト（GPU加速drawImage使用）。整数シフトは完全可逆 |

## アーキテクチャ

- **Canvas2D ベース**: OffscreenCanvas を使用し、Node.js や Worker でも動作可能
- **関数型設計**: Layer を受け取る純粋関数として設計
- **イミュータブル**: Layer のプロパティは readonly
- **エラー許容**: 範囲外アクセスはエラーを投げず安全な値を返す
