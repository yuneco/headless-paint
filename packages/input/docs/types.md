# 型定義

## Point

2次元座標を表す基本型。

```typescript
interface Point {
  x: number;
  y: number;
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
type ViewTransform = Float32Array;  // 長さ 9 の配列
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
  minDistance?: number;      // 最小距離（ピクセル）。デフォルト: 2
  minTimeInterval?: number;  // 最小時間間隔（ミリ秒）。デフォルト: 0
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
  lastPoint: Point | null;     // 最後に採用した座標
  lastTimestamp: number | null; // 最後に採用した時刻
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

## SymmetryMode

対称モードの種類。

```typescript
type SymmetryMode = "none" | "axial" | "radial" | "kaleidoscope";
```

| 値 | 説明 |
|---|---|
| `"none"` | 対称なし |
| `"axial"` | 線対称（軸対称） |
| `"radial"` | 点対称（回転対称） |
| `"kaleidoscope"` | 万華鏡（回転 + 反射） |

---

## SymmetryConfig

対称変換の設定。

```typescript
interface SymmetryConfig {
  readonly mode: SymmetryMode;
  readonly origin: Point;
  readonly angle: number;
  readonly divisions: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `mode` | `SymmetryMode` | 対称モード |
| `origin` | `Point` | 対称の中心点（Layer Space） |
| `angle` | `number` | 対称軸の角度（ラジアン、0=垂直軸） |
| `divisions` | `number` | 分割数（radial/kaleidoscope で使用、2以上） |

**使用例**:
```typescript
const config: SymmetryConfig = {
  mode: "radial",
  origin: { x: 500, y: 500 },
  angle: 0,
  divisions: 6,
};
```

---

## CompiledSymmetry

コンパイル済み対称変換。`compileSymmetry()` で生成。

```typescript
interface CompiledSymmetry {
  readonly config: SymmetryConfig;
  readonly matrices: readonly mat3[];
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `config` | `SymmetryConfig` | 元の設定 |
| `matrices` | `readonly mat3[]` | 事前計算された変換行列 |

---

## TransformConfig

パイプラインの変換設定（Discriminated Union）。

```typescript
type TransformConfig =
  | { type: "symmetry"; config: SymmetryConfig }
  // 将来の拡張用
  // | { type: "smoothing"; config: SmoothingConfig }
  // | { type: "pattern"; config: PatternConfig }
```

**使用例**:
```typescript
const transform: TransformConfig = {
  type: "symmetry",
  config: symmetryConfig,
};
```

---

## PipelineConfig

ストローク変換パイプラインの設定。

```typescript
interface PipelineConfig {
  readonly transforms: readonly TransformConfig[];
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `transforms` | `readonly TransformConfig[]` | 適用する変換の配列（順序で直列適用） |

**使用例**:
```typescript
// 対称変換を含むパイプライン
const config: PipelineConfig = {
  transforms: [
    { type: "symmetry", config: symmetryConfig }
  ]
};

// 変換なし（通常ペイント）
const identityConfig: PipelineConfig = { transforms: [] };
```

---

## CompiledPipeline

コンパイル済みパイプライン。`compilePipeline()` で生成。

```typescript
interface CompiledPipeline {
  readonly config: PipelineConfig;
  readonly outputCount: number;
  // 内部実装の詳細は非公開
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `config` | `PipelineConfig` | 元の設定（履歴保存用） |
| `outputCount` | `number` | 1入力あたりの出力数 |

---

## StrokeSessionState

ストロークセッションの状態（不透明型）。

```typescript
interface StrokeSessionState {
  // 内部実装
}
```

セッション管理関数間でのみ使用。直接参照しないでください。

---

## StrokeSessionResult

セッション操作の結果。

```typescript
interface StrokeSessionResult {
  readonly state: StrokeSessionState;
  readonly expandedStrokes: readonly (readonly Point[])[];
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `state` | `StrokeSessionState` | 次の呼び出しに渡す状態 |
| `expandedStrokes` | `readonly (readonly Point[])[]` | 現在の展開済みストローク群（描画用） |

---

## StrokeSessionEndResult

セッション終了時の結果。

```typescript
interface StrokeSessionEndResult {
  readonly inputPoints: readonly Point[];
  readonly validStrokes: readonly (readonly Point[])[];
  readonly pipelineConfig: PipelineConfig;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `inputPoints` | `readonly Point[]` | 元の入力点列（履歴保存用） |
| `validStrokes` | `readonly (readonly Point[])[]` | 有効なストローク群（2点以上） |
| `pipelineConfig` | `PipelineConfig` | 使用したパイプライン設定 |
