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
type FilterType = "smoothing" | "straight-line";
```

| 値 | 説明 |
|---|---|
| `"smoothing"` | スムージング（移動平均）フィルタ |
| `"straight-line"` | 直線フィルタ（始点→終点の2点に圧縮） |

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

## StraightLineConfig

直線フィルタの設定。現在は設定項目なし（将来の拡張用に型を予約）。

```typescript
// biome-ignore lint/suspicious/noEmptyInterface: 将来の拡張ポイント
interface StraightLineConfig {}
```

---

## FilterConfig

フィルタ設定（Discriminated Union）。

```typescript
type FilterConfig =
  | { readonly type: "smoothing"; readonly config: SmoothingConfig }
  | { readonly type: "straight-line"; readonly config: StraightLineConfig };
```

**使用例**:
```typescript
const smoothing: FilterConfig = {
  type: "smoothing",
  config: { windowSize: 5 },
};

const straightLine: FilterConfig = {
  type: "straight-line",
  config: {},
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

---

## GesturePointerEvent

ジェスチャー入力イベント。DOM の PointerEvent から必要な情報を抽出した DOM 非依存の型。

```typescript
interface GesturePointerEvent {
  readonly pointerId: number;
  readonly pointerType: "touch" | "pen" | "mouse";
  readonly x: number;       // Screen Space
  readonly y: number;       // Screen Space
  readonly pressure: number;
  readonly timestamp: number;
  readonly eventType: "down" | "move" | "up" | "cancel";
}
```

**フィールド説明**:

| フィールド | 型 | 説明 |
|---|---|---|
| `pointerId` | `number` | ポインター識別子 |
| `pointerType` | `"touch" \| "pen" \| "mouse"` | ポインターデバイスの種類 |
| `x` | `number` | Screen Space の X 座標 |
| `y` | `number` | Screen Space の Y 座標 |
| `pressure` | `number` | 筆圧（0.0–1.0） |
| `timestamp` | `number` | タイムスタンプ（ミリ秒） |
| `eventType` | `"down" \| "move" \| "up" \| "cancel"` | イベント種別 |

**使用例**:
```typescript
// DOM PointerEvent から変換
const gestureEvent: GesturePointerEvent = {
  pointerId: e.pointerId,
  pointerType: e.pointerType as "touch",
  x: e.offsetX,
  y: e.offsetY,
  pressure: e.pressure,
  timestamp: e.timeStamp,
  eventType: "down",
};
```

---

## GestureConfig

ジェスチャー認識の設定。

```typescript
interface GestureConfig {
  readonly graceWindowMs: number;
  readonly confirmDistancePx: number;
  readonly undoMaxMovePx: number;
  readonly undoMaxDurationMs: number;
}
```

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `graceWindowMs` | `number` | `150` | 二本指切替の猶予期間（ms）。タッチダウンからこの時間内に2指目が来るとジェスチャーに切替 |
| `confirmDistancePx` | `number` | `10` | ストローク確定の移動閾値（px）。これ以上動くと committed フラッシュ |
| `undoMaxMovePx` | `number` | `20` | Undo 判定の最大移動量（px）。ジェスチャー中にこれ以上動くと Undo にならない |
| `undoMaxDurationMs` | `number` | `300` | Undo 判定の最大時間（ms）。ジェスチャーがこれ以上長いと Undo にならない |

**使用例**:
```typescript
import { DEFAULT_GESTURE_CONFIG } from "@headless-paint/input";

// デフォルト設定を使用
const config = DEFAULT_GESTURE_CONFIG;

// カスタム設定
const customConfig: GestureConfig = {
  graceWindowMs: 200,    // 猶予期間を長めに
  confirmDistancePx: 5,  // 確定閾値を小さく
  undoMaxMovePx: 30,
  undoMaxDurationMs: 400,
};
```

---

## GestureState

ジェスチャー状態マシンの状態（Discriminated Union）。

```typescript
type GestureState =
  | { readonly phase: "idle" }
  | {
      readonly phase: "single_down";
      readonly primaryPointerId: number;
      readonly downTimestamp: number;
      readonly downPos: Point;
      readonly lastPos: Point;
    }
  | {
      readonly phase: "drawing";
      readonly primaryPointerId: number;
      readonly downTimestamp: number;
    }
  | {
      readonly phase: "gesture";
      readonly primaryPointerId: number;
      readonly secondaryPointerId: number;
      readonly layerP1: Point;
      readonly layerP2: Point;
      readonly lastScreenP1: Point;
      readonly lastScreenP2: Point;
      readonly downTimestamp: number;
      readonly gestureMoved: boolean;
    }
  | {
      readonly phase: "gesture_ending";
      readonly remainingPointerId: number;
      readonly layerP1: Point;
      readonly layerP2: Point;
      readonly lastScreenP1: Point;
      readonly lastScreenP2: Point;
      readonly downTimestamp: number;
      readonly gestureMoved: boolean;
    };
```

**各フェーズの説明**:

| フェーズ | 説明 |
|---|---|
| `idle` | 入力なし。初期状態 |
| `single_down` | 1指タッチ中。描画開始済みだが未確定（pending-only） |
| `drawing` | 描画確定済み。通常の committed/pending フロー |
| `gesture` | 2指ジェスチャー中（ピンチズーム/回転/パン） |
| `gesture_ending` | 1指が離れ、残り1指の up 待ち |

---

## GestureEvent

ジェスチャー状態マシンが発行する出力イベント。

```typescript
type GestureEvent =
  | { readonly type: "draw-start"; readonly point: GesturePointerEvent }
  | { readonly type: "draw-move"; readonly point: GesturePointerEvent }
  | { readonly type: "draw-confirm" }
  | { readonly type: "draw-end" }
  | { readonly type: "draw-cancel" }
  | { readonly type: "pinch-start"; readonly transform: ViewTransform }
  | { readonly type: "pinch-move"; readonly transform: ViewTransform }
  | { readonly type: "pinch-end" }
  | { readonly type: "undo" };
```

**各イベントの説明**:

| イベント | 発行タイミング | 説明 |
|---|---|---|
| `draw-start` | タッチダウン時 | 描画開始。pending-only レンダリングを開始 |
| `draw-move` | タッチ移動時 | 描画継続。ポイント追加 |
| `draw-confirm` | 移動閾値超過時 | ストローク確定。pending→committed フラッシュ |
| `draw-end` | タッチアップ時 | 描画終了 |
| `draw-cancel` | 2指切替時 | ストロークキャンセル。pendingLayer クリアのみ |
| `pinch-start` | 2指目ダウン時 | ピンチジェスチャー開始。初期 ViewTransform を含む |
| `pinch-move` | 2指移動時 | ピンチ継続。新しい ViewTransform を含む |
| `pinch-end` | ジェスチャー終了時 | ピンチ終了 |
| `undo` | 二本指短タップ時 | Undo 操作 |
