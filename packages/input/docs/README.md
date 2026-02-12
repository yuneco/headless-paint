# @headless-paint/input

ポインター入力の処理とビュー変換を行うパッケージです。

## インストール

```bash
pnpm add @headless-paint/input
```

## 基本的な使い方

```typescript
import {
  // ビュー変換
  createViewTransform,
  pan,
  zoom,
  rotate,
  fitToView,
  applyDpr,
  decomposeTransform,
  // 座標変換
  screenToLayer,
  layerToScreen,
  // 間引き
  shouldAcceptPoint,
  createSamplingState,
  // フィルタパイプライン
  compileFilterPipeline,
  createFilterPipelineState,
  processPoint,
  finalizePipeline,
  // ジェスチャー
  createGestureState,
  processGestureEvent,
  DEFAULT_GESTURE_CONFIG,
  computeSimilarityTransform,
} from "@headless-paint/input";

// ビュー変換を作成
let transform = createViewTransform();

// パン・ズーム・回転
transform = pan(transform, 100, 50);
transform = zoom(transform, 1.5, centerX, centerY);
transform = rotate(transform, Math.PI / 12, centerX, centerY);

// 座標変換
const layerPoint = screenToLayer({ x: e.offsetX, y: e.offsetY }, transform);
const screenPoint = layerToScreen(layerPoint, transform);

// 変換成分の取得（デバッグ用など）
const components = decomposeTransform(transform);
console.log(`Scale: ${components.scaleX}, Rotation: ${components.rotation}`);

// 入力間引き
const [accepted, newState] = shouldAcceptPoint(point, timestamp, state, config);

// フィルタパイプライン（スムージング等）
const compiled = compileFilterPipeline({
  filters: [{ type: "smoothing", config: { windowSize: 5 } }]
});
let pipelineState = createFilterPipelineState(compiled);

// 入力点を処理
const result = processPoint(pipelineState, { x: 100, y: 100, pressure: 0.5, timestamp: Date.now() }, compiled);
pipelineState = result.state;
// result.output.committed - 確定した点
// result.output.pending - 未確定の点

// ジェスチャー状態マシン
let gestureState = createGestureState();
const gestureConfig = DEFAULT_GESTURE_CONFIG;

const [newState, events] = processGestureEvent(
  gestureState, pointerEvent, gestureConfig, transform
);
gestureState = newState;
for (const event of events) {
  // event.type: "draw-start" | "draw-move" | "draw-confirm" | ...
}
```

## API リファレンス

### 型定義

詳細は [types.md](./types.md) を参照。

| 型 | 説明 |
|---|---|
| `Point` | 2D座標 `{ x, y }` |
| `InputPoint` | 入力点 `{ x, y, pressure?, timestamp }` |
| `ViewTransform` | ビュー変換行列（mat3 形式） |
| `SamplingConfig` | 間引き設定 |
| `SamplingState` | 間引き状態 |
| `TransformComponents` | 変換成分（スケール、回転、平行移動） |
| `FilterType` | フィルタ種別（`"smoothing" \| "straight-line"`） |
| `SmoothingConfig` | スムージングフィルタ設定 |
| `StraightLineConfig` | 直線フィルタ設定 |
| `FilterConfig` | フィルタ設定（Discriminated Union） |
| `FilterPipelineConfig` | フィルタパイプライン設定 |
| `CompiledFilterPipeline` | コンパイル済みフィルタパイプライン |
| `FilterPipelineState` | フィルタパイプライン状態 |
| `FilterOutput` | フィルタ出力（committed/pending） |
| `GesturePointerEvent` | ジェスチャー入力イベント（DOM非依存） |
| `GestureConfig` | ジェスチャー認識設定 |
| `GestureState` | ジェスチャー状態（Discriminated Union） |
| `GestureEvent` | ジェスチャー出力イベント |

### ビュー変換関数

詳細は [transform-api.md](./transform-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createViewTransform()` | 単位行列のビュー変換を作成 |
| `pan(transform, dx, dy)` | 平行移動 |
| `zoom(transform, scale, cx, cy)` | 中心点基準でズーム |
| `rotate(transform, angle, cx, cy)` | 中心点基準で回転 |
| `fitToView(viewW, viewH, layerW, layerH)` | ビューポートにフィットする変換を作成 |
| `applyDpr(transform, dpr)` | Device Pixel Ratio スケーリングを適用 |
| `invertViewTransform(transform)` | 逆変換を計算 |
| `decomposeTransform(transform)` | 行列から変換成分を抽出 |
| `computeSimilarityTransform(lP1, lP2, sP1, sP2)` | 2点対応から相似変換を計算 |

### 座標変換関数

詳細は [coordinate-api.md](./coordinate-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `screenToLayer(screenPoint, transform)` | Screen Space → Layer Space |
| `layerToScreen(layerPoint, transform)` | Layer Space → Screen Space |

### 間引き関数

詳細は [sampling-api.md](./sampling-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `shouldAcceptPoint(point, timestamp, state, config)` | 間引き判定 |
| `createSamplingState()` | 間引き状態の初期値を作成 |

### フィルタパイプライン

詳細は [filter-pipeline-api.md](./filter-pipeline-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `compileFilterPipeline(config)` | パイプライン設定をコンパイル |
| `createFilterPipelineState(compiled)` | パイプライン状態を作成 |
| `processPoint(state, point, compiled)` | 点を処理 |
| `finalizePipeline(state, compiled)` | パイプラインを終了 |
| `processAllPoints(points, compiled)` | 全点を一括処理（リプレイ用） |

### ジェスチャー関数

詳細は [gesture-api.md](./gesture-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createGestureState()` | ジェスチャー状態の初期値を作成 |
| `processGestureEvent(state, event, config, transform)` | ポインターイベントを処理 |
| `DEFAULT_GESTURE_CONFIG` | デフォルトのジェスチャー設定 |

## 座標系

| 座標系 | 英語名 | 説明 |
|--------|--------|------|
| スクリーン座標系 | Screen Space | Canvas要素内の座標。`offsetX/Y` で取得 |
| 論理座標系 | Layer Space | レイヤー固有の座標。ストローク記録先 |

### 座標変換フロー

```
【入力】Screen Space → Layer Space (逆ビュー変換)
【描画】Layer Space → Screen Space (正ビュー変換)
```

## Retina対応

アプリ層で `ctx.scale(dpr, dpr)` を適用することで、`offsetX/Y` をそのまま Screen Space として使用できます。描画時のビュー変換には `applyDpr` で DPR スケーリングを適用してください。

```typescript
import { applyDpr } from "@headless-paint/input";
import { renderLayers } from "@headless-paint/engine";

const dpr = window.devicePixelRatio;
canvas.width = logicalWidth * dpr;
canvas.height = logicalHeight * dpr;
canvas.style.width = `${logicalWidth}px`;
canvas.style.height = `${logicalHeight}px`;
ctx.scale(dpr, dpr);

// 描画時: DPR 適用済みの変換を使用
renderLayers(layers, ctx, applyDpr(transform, dpr), { background });
```
