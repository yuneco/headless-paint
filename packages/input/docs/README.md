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
  decomposeTransform,
  // 座標変換
  screenToLayer,
  layerToScreen,
  // 間引き
  shouldAcceptPoint,
  // ストローク変換パイプライン
  compilePipeline,
  expandPoint,
  expandStroke,
  startStrokeSession,
  addPointToSession,
  endStrokeSession,
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
```

## API リファレンス

### 型定義

詳細は [types.md](./types.md) を参照。

| 型 | 説明 |
|---|---|
| `Point` | 2D座標 `{ x, y }` |
| `ViewTransform` | ビュー変換行列（mat3 形式） |
| `SamplingConfig` | 間引き設定 |
| `SamplingState` | 間引き状態 |
| `TransformComponents` | 変換成分（スケール、回転、平行移動） |
| `SymmetryConfig` | 対称変換設定 |
| `PipelineConfig` | パイプライン設定 |
| `CompiledPipeline` | コンパイル済みパイプライン |
| `StrokeSessionState` | ストロークセッション状態 |
| `StrokeSessionResult` | セッション操作結果 |

### ビュー変換関数

詳細は [transform-api.md](./transform-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `createViewTransform()` | 単位行列のビュー変換を作成 |
| `pan(transform, dx, dy)` | 平行移動 |
| `zoom(transform, scale, cx, cy)` | 中心点基準でズーム |
| `rotate(transform, angle, cx, cy)` | 中心点基準で回転 |
| `invertViewTransform(transform)` | 逆変換を計算 |
| `decomposeTransform(transform)` | 行列から変換成分を抽出 |

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

### ストローク変換パイプライン

詳細は [pipeline-api.md](./pipeline-api.md) を参照。

| 関数 | 説明 |
|---|---|
| `compilePipeline(config)` | パイプライン設定をコンパイル |
| `expandPoint(point, compiled)` | 単一点を展開 |
| `expandStroke(points, compiled)` | ストローク全体を展開 |
| `startStrokeSession(point, compiled)` | ストロークセッション開始 |
| `addPointToSession(state, point, compiled)` | セッションに点を追加 |
| `endStrokeSession(state)` | セッション終了 |

### 対称変換（低レベルAPI）

パイプラインAPIの内部で使用。通常はパイプラインAPIを使用してください。

| 関数 | 説明 |
|---|---|
| `compileSymmetry(config)` | 対称設定をコンパイル |
| `expandSymmetry(point, compiled)` | 点を対称展開 |
| `getSymmetryCount(config)` | 対称変換の出力数を取得 |
| `createDefaultSymmetryConfig(width, height)` | デフォルト設定を作成 |

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

アプリ層で `ctx.scale(dpr, dpr)` を適用することで、`offsetX/Y` をそのまま Screen Space として使用できます。

```typescript
const dpr = window.devicePixelRatio;
canvas.width = logicalWidth * dpr;
canvas.height = logicalHeight * dpr;
canvas.style.width = `${logicalWidth}px`;
canvas.style.height = `${logicalHeight}px`;
ctx.scale(dpr, dpr);
```
