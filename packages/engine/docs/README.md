# @headless-paint/engine

ヘッドレス環境で動作するCanvas2Dベースのペイントエンジンです。

このドキュメントは workspace 内部パッケージ `@headless-paint/engine` に対応する。
外部アプリケーションから利用する場合は `@yuneco/headless-paint` をインストールし、`@yuneco/headless-paint/core` から同等の API を import する。

## インストール

```bash
pnpm add @yuneco/headless-paint
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
} from "@yuneco/headless-paint/core";

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
| `PressureDynamics` | 筆圧をブラシサイズ/flowへ反映する強さ `{ size, flow }` |
| `SprayPressureDynamics` | 筆圧を spray の散布径/flow/密度へ反映する強さ `{ size, flow, density }` |
| `BrushDynamics` | スタンプブラシの動的パラメータ（全 required） |
| `SprayDynamics` | spray ブラシの動的パラメータ（spacing, density, particleSize など） |
| `BrushMixing` | 距離rate、更新距離、checkpoint距離、tip-local色場解像度を持つスタンプ混色設定 |
| `BristleBrushConfig` / `BristleDynamics` | 連続毛束断面、面掠れ、紙目、反復接触、折返し追従を持つ荒いハケ設定 |
| `LayerMeta` | レイヤーメタデータ `{ name, visible, opacity, alphaLocked, compositeOperation? }` |
| `Layer` | レイヤー本体（id, width, height, canvas, ctx, meta） |
| `ExpandLevel` | 1レベル分の展開設定 `{ mode, offset, angle, divisions }` |
| `ParametricCurve` | 0-1 パラメータ変換カーブ制御点 `{ y1, y2 }` |
| `PressureCurve` | 筆圧カーブ制御点 `{ y1, y2 }` |
| `DensityProfileCurve` | spray の半径方向密度プロファイル `{ startY, control1, control2, endY }` |
| `SpraySizeJitterMode` | spray 粒子径ジッタの分布モード |
| `ContentBounds` | レイヤー内容の非透明ピクセル境界矩形 `{ x, y, width, height }` |
| `LayerTransformPreview` | レイヤー変換プレビュー `{ layerId, matrix }` |
| `Mat3Like` | gl-matrix `mat3` 互換の flat 3x3 行列 |
| `QuadCorners` | 変換後矩形の4隅 `[tl, tr, bl, br]` |
| `BackgroundSettings` | 背景設定 `{ color, visible }` |
| `BrushConfig` | ブラシ設定（判別共用体: `RoundPenBrushConfig \| StampBrushConfig \| SprayBrushConfig`） |
| `BrushRenderState` | ブラシレンダリング状態 `{ seed, tipCanvas, branches }` |

### Layer 管理関数

詳細は [layer-api.md](./layer-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createLayer(width, height, meta?)` | 新規レイヤー作成（一意の `id` を自動付与） |
| `cloneLayer(source, options?)` | レイヤーサイズ・メタデータ・pixels を複製した新規レイヤーを作成 |
| `copyLayerPixels(source, target)` | target をクリアして source の pixels をコピー |
| `mergeLayerDown(targetLayer, sourceLayer, options?)` | source を target に焼き込み、target meta を統合後の状態に正規化 |
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
| `drawVariableWidthPath(layer, points, color, baseLineWidth, pressureSize, pressureCurve?, compositeOperation?, overlapCount?)` | 可変太さパス描画（筆圧対応） |
| `calculateRadius(pressure, baseLineWidth, pressureSize, pressureCurve?)` | 筆圧から描画半径を計算 |
| `evaluateParametricCurve(value, curve)` | 0-1 パラメータ変換カーブを評価 |
| `interpolateStrokePoints(points, overlapCount?)` | Catmull-Romスプライン補間 |

### Brush API

詳細は [brush-api.md](./brush-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `renderBrushStroke(layer, points, style, overlapCount?, state?, sourceLayer?, accelerator?)` | ブラシ種別に応じてストローク描画（ディスパッチ） |
| `createBrushAccelerator(options?)` | 混色stampをWebGL2で描くGPU加速器を生成（非対応環境は `null`）。詳細は [gpu-acceleration.md](./gpu-acceleration.md) |
| `walkEmissions(interpolated, spacingPx, startState, overlapCount, emit, timeSpacingMs?, spacingAt?)` | 固定/局所可変の距離ベース + 時間ベース emission を走査（stamp / spray 共有） |
| `timeSpacingMsFromRate(emissionsPerSecond)` | 吹きつけレートを時間ベース emission 間隔 ms に変換 |
| `generateBrushTip(config, size, color, registry?)` | ブラシチップ画像を生成 |
| `createBrushTipRegistry()` | 画像チップ管理用の `BrushTipRegistry` を作成 |
| `mulberry32(seed)` | 32bit シードから PRNG を生成 |
| `hashSeed(globalSeed, index)` | branch / emission 固有のシードを生成 |
| `ROUND_PEN` | デフォルトの round-pen ブラシ定数 |
| `AIRBRUSH` | エアブラシプリセット（ソフト円、密間隔・低フロー、時間ベース emission 有効） |
| `SPRAY_AIRBRUSH` | 粒子感エアブラシプリセット（spray、小粒子散布、時間ベース emission 有効） |
| `PENCIL` | 鉛筆プリセット（ほぼハード円、微小 jitter） |
| `MARKER` | マーカープリセット（やや柔らか、中間フロー） |
| `ROUGH_BRISTLE` | 荒いハケプリセット（連続毛束、面掠れ、紙目、反復接触、混色） |
| `DEFAULT_PRESSURE_DYNAMICS` | `PressureDynamics` のデフォルト値 |
| `DEFAULT_SPRAY_DYNAMICS` | `SprayDynamics` のデフォルト値 |
| `DEFAULT_SPRAY_PRESSURE_DYNAMICS` | `SprayPressureDynamics` のデフォルト値 |
| `DEFAULT_RADIAL_DISTRIBUTION` | spray の半径方向密度プロファイルのデフォルト値 |
| `SPRAY_MAX_PARTICLES_PER_EMISSION` | spray の emission あたり粒子数上限 |

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
| `expandStrokePoints(points, compiled)` | ストローク全体を展開（StrokePoint版、pressure/timestamp保持） |
| `getExpandCount(config)` | 展開の出力数を取得 |
| `createDefaultExpandConfig(width, height)` | デフォルト設定を作成 |

### 差分描画 API

詳細は [incremental-render-api.md](./incremental-render-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `appendToCommittedLayer(layer, points, style, expand, overlapCount?, brushState?, sourceLayer?, alphaLocked?)` | 確定レイヤーに追加描画。`alphaLocked` 有効時の通常描画は既存 alpha に制限する。`BrushRenderState` を返す |
| `renderPendingLayer(layer, points, style, expand, brushState?, sourceLayer?, previewBaseLayer?)` | 作業レイヤーを再描画。stateful mixing有効時はclear後no-op |
| `composeLayers(target, layers, transform?)` | レイヤーを合成 |

### Pattern Preview

詳細は [pattern-preview-api.md](./pattern-preview-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createPatternTile(layers, config, background?)` | レイヤー内容からパターンタイルを生成 |
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

### Transform API

詳細は [transform-api.md](./transform-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `getContentBounds(layer)` | レイヤーの非透明ピクセル境界矩形を返す。空レイヤーは `null` |
| `getTransformedCorners(bounds, matrix)` | content bounds の4隅に mat3 を適用し `[tl, tr, bl, br]` を返す |
| `getEdgeMidpoints(corners)` | 変換後4隅から `[top, bottom, left, right]` の辺中点を返す |
| `getOutwardNormal(edgeStart, edgeEnd, quadCenter)` | 辺の外側単位法線を返す |
| `isPointInQuad(point, corners)` | 点が四角形の内側または境界上にあるか判定する |
| `composeTranslation(startMatrix, dx, dy)` | `translation * startMatrix` の mat3 を返す |
| `composeRotation(startMatrix, center, angleDelta)` | 指定中心まわりの回転を `startMatrix` に合成した mat3 を返す |
| `composeScaleAboutAnchor(startMatrix, anchor, sx, sy)` | anchor を支点にした scale を `startMatrix` に合成した mat3 を返す |
| `isIdentityMatrix(matrix)` | mat3 が単位行列と厳密一致するか判定する |
| `transformLayer(layer, matrix, temp?)` | アフィン変換をピクセルに焼き込む（temp canvas パターン） |

### Wrap Shift

| 関数 | 説明 |
|---|---|
| `wrapShiftLayer(layer, dx, dy, temp?)` | レイヤー全ピクセルをラップシフト（GPU加速drawImage使用）。整数シフトは完全可逆 |

## アーキテクチャ

- **Canvas2D ベース**: OffscreenCanvas を使用し、Node.js や Worker でも動作可能
- **関数型設計**: Layer を受け取る純粋関数として設計
- **イミュータブル**: Layer のプロパティは readonly
- **エラー許容**: 範囲外アクセスはエラーを投げず安全な値を返す
