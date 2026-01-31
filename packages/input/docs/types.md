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
