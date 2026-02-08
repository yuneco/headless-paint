# 型定義

## Point

2次元座標を表す基本型。

```typescript
interface Point {
  readonly x: number;
  readonly y: number;
}
```

**使用例**:
```typescript
const screenPoint: Point = { x: 100, y: 200 };
const layerPoint: Point = { x: 50, y: 75 };
```

---

## ViewTransform

ビュー変換を表す 3x3 行列。gl-matrix の `mat3` 形式。

```typescript
type ViewTransform = mat3;  // gl-matrix の mat3 型
```

**行列構造**:
```
| a  c  tx |   | [0] [3] [6] |
| b  d  ty | = | [1] [4] [7] |
| 0  0  1  |   | [2] [5] [8] |
```

**注意**: 直接操作せず、`pan` / `zoom` / `rotate` 関数を使用してください。

**使用例**:
```typescript
import { createViewTransform, pan, zoom } from "@headless-paint/input";

let transform = createViewTransform();  // 単位行列
transform = pan(transform, 100, 50);
transform = zoom(transform, 2.0, 320, 240);
```

---

## SamplingConfig

入力座標の間引き設定。

```typescript
interface SamplingConfig {
  readonly minDistance?: number;      // 最小距離（ピクセル）。デフォルト: 2
  readonly minTimeInterval?: number;  // 最小時間間隔（ミリ秒）。デフォルト: 0
}
```

**フィールド説明**:

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `minDistance` | `number` | `2` | 前回の採用点からこの距離以上離れていれば採用 |
| `minTimeInterval` | `number` | `0` | 前回の採用からこの時間以上経過していれば採用 |

**使用例**:
```typescript
// 距離ベースの間引き
const config: SamplingConfig = { minDistance: 3 };

// 時間ベースの間引き
const config: SamplingConfig = { minTimeInterval: 16 };  // 約60fps

// 組み合わせ（両方の条件を満たす場合に採用）
const config: SamplingConfig = { minDistance: 2, minTimeInterval: 8 };
```

---

## SamplingState

間引き処理の状態。

```typescript
interface SamplingState {
  readonly lastPoint: Point | null;     // 最後に採用した座標
  readonly lastTimestamp: number | null; // 最後に採用した時刻
}
```

**フィールド説明**:

| フィールド | 型 | 説明 |
|---|---|---|
| `lastPoint` | `Point \| null` | 最後に採用された座標。初期状態は `null` |
| `lastTimestamp` | `number \| null` | 最後に採用された時刻（ms）。初期状態は `null` |

**使用例**:
```typescript
// 初期状態
let state: SamplingState = { lastPoint: null, lastTimestamp: null };

// ストローク開始時にリセット
function onPointerDown() {
  state = { lastPoint: null, lastTimestamp: null };
}
```

---

## TransformComponents

変換行列から抽出した変換成分。

```typescript
interface TransformComponents {
  scaleX: number;      // X軸方向のスケール
  scaleY: number;      // Y軸方向のスケール
  rotation: number;    // 回転角度（ラジアン、正=反時計回り）
  translateX: number;  // X軸方向の平行移動
  translateY: number;  // Y軸方向の平行移動
}
```

**フィールド説明**:

| フィールド | 型 | 説明 |
|---|---|---|
| `scaleX` | `number` | X軸方向のスケール値 |
| `scaleY` | `number` | Y軸方向のスケール値 |
| `rotation` | `number` | 回転角度（ラジアン）。度に変換: `rotation * (180 / Math.PI)` |
| `translateX` | `number` | X軸方向の平行移動量 |
| `translateY` | `number` | Y軸方向の平行移動量 |

**使用例**:
```typescript
import { decomposeTransform } from "@headless-paint/input";

const components = decomposeTransform(transform);

// 度に変換して表示
const rotationDeg = components.rotation * (180 / Math.PI);
console.log(`Scale: ${components.scaleX}x${components.scaleY}`);
console.log(`Rotation: ${rotationDeg}°`);
console.log(`Translation: (${components.translateX}, ${components.translateY})`);
```

---

## InputPoint

入力点を表す型。座標に加えて筆圧とタイムスタンプを持つ。

```typescript
interface InputPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;   // 筆圧（0.0-1.0、オプション）
  readonly timestamp: number;   // タイムスタンプ（ミリ秒）
}
```

**使用例**:
```typescript
const point: InputPoint = {
  x: 100,
  y: 200,
  pressure: 0.8,
  timestamp: Date.now(),
};
```

---

## FilterType

フィルタの種類。

```typescript
type FilterType = "smoothing";
```

| 値 | 説明 |
|---|---|
| `"smoothing"` | スムージング（移動平均）フィルタ |

---

## SmoothingConfig

スムージングフィルタの設定。

```typescript
interface SmoothingConfig {
  readonly windowSize: number;  // 移動平均のウィンドウサイズ（3以上の奇数推奨）
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `windowSize` | `number` | 平滑化に使う点数。大きいほど滑らか。 |

**使用例**:
```typescript
const config: SmoothingConfig = { windowSize: 5 };
```

---

## FilterConfig

フィルタ設定（Discriminated Union）。

```typescript
type FilterConfig =
  | { type: "smoothing"; config: SmoothingConfig }
  // 将来の拡張用
  // | { type: "pressure-curve"; config: PressureCurveConfig }
```

**使用例**:
```typescript
const filter: FilterConfig = {
  type: "smoothing",
  config: { windowSize: 5 },
};
```

---

## FilterPipelineConfig

フィルタパイプラインの設定。

```typescript
interface FilterPipelineConfig {
  readonly filters: readonly FilterConfig[];
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `filters` | `readonly FilterConfig[]` | 適用するフィルタの配列（順序で直列適用） |

**使用例**:
```typescript
// スムージングを含むパイプライン
const config: FilterPipelineConfig = {
  filters: [
    { type: "smoothing", config: { windowSize: 5 } }
  ]
};

// フィルタなし（通常ペイント）
const identityConfig: FilterPipelineConfig = { filters: [] };
```

---

## CompiledFilterPipeline

コンパイル済みフィルタパイプライン。`compileFilterPipeline()` で生成。

```typescript
interface CompiledFilterPipeline {
  readonly config: FilterPipelineConfig;
  // 内部実装の詳細は非公開
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `config` | `FilterPipelineConfig` | 元の設定（履歴保存用） |

---

## FilterPipelineState

フィルタパイプラインの状態。

```typescript
interface FilterPipelineState {
  // 内部実装
}
```

セッション管理関数間でのみ使用。直接参照しないでください。

---

## FilterOutput

フィルタパイプラインの出力。

```typescript
interface FilterOutput {
  readonly committed: readonly InputPoint[];  // 確定済みの点
  readonly pending: readonly InputPoint[];    // 未確定の点
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `committed` | `readonly InputPoint[]` | 座標確定済み。確定レイヤーに永続描画 |
| `pending` | `readonly InputPoint[]` | 座標変更の可能性あり。作業レイヤーに毎回再描画 |

**committed/pendingの違い**:
- **committed**: 新しい入力が来ても座標が変わらない。追加描画のみで良い。
- **pending**: 新しい入力が来ると座標が変わる可能性がある。毎回クリア→再描画が必要。

---

## FilterProcessResult

フィルタ処理の結果。

```typescript
interface FilterProcessResult {
  readonly state: FilterPipelineState;
  readonly output: FilterOutput;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `state` | `FilterPipelineState` | 次の呼び出しに渡す状態 |
| `output` | `FilterOutput` | committed/pendingに分離された出力 |

