# 間引き API

入力座標の間引き（サンプリング）を行う関数です。

## 概要

ペンタブレットやタッチデバイスは高頻度で座標を報告するため、そのまま記録すると：
- 過剰なデータ量
- 描画パフォーマンスの低下
- 不自然に密なパス

間引き処理により、必要十分な精度を保ちながらデータ量を削減します。

---

## shouldAcceptPoint

座標を採用するかどうかを判定する。

```typescript
function shouldAcceptPoint(
  point: Point,
  timestamp: number,
  state: SamplingState,
  config: SamplingConfig,
): [boolean, SamplingState]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `point` | `Point` | ○ | 判定対象の座標（Layer Space） |
| `timestamp` | `number` | ○ | イベントのタイムスタンプ（ms） |
| `state` | `SamplingState` | ○ | 現在の間引き状態 |
| `config` | `SamplingConfig` | ○ | 間引き設定 |

**戻り値**: `[boolean, SamplingState]`
- `boolean`: この座標を採用するかどうか
- `SamplingState`: 更新された間引き状態（次回の呼び出しに使用）

**判定ロジック**:
1. `state.lastPoint` が `null` → 最初の点なので採用
2. 前回の点からの距離が `minDistance` 以上 → 採用
3. 前回からの経過時間が `minTimeInterval` 以上 → 採用
4. いずれも満たさない → 不採用

---

## 使用例

### 基本的な使用パターン

```typescript
import { shouldAcceptPoint, screenToLayer } from "@headless-paint/input";
import type { SamplingState, SamplingConfig } from "@headless-paint/input";

const config: SamplingConfig = { minDistance: 2 };
let samplingState: SamplingState = { lastPoint: null, lastTimestamp: null };

function onPointerDown(e: PointerEvent) {
  // ストローク開始時に状態をリセット
  samplingState = { lastPoint: null, lastTimestamp: null };

  const layerPoint = screenToLayer({ x: e.offsetX, y: e.offsetY }, transform);
  if (layerPoint) {
    const [accepted, newState] = shouldAcceptPoint(
      layerPoint,
      e.timeStamp,
      samplingState,
      config,
    );
    samplingState = newState;

    if (accepted) {
      stroke.push(layerPoint);
    }
  }
}

function onPointerMove(e: PointerEvent) {
  if (!isDrawing) return;

  const layerPoint = screenToLayer({ x: e.offsetX, y: e.offsetY }, transform);
  if (!layerPoint) return;

  const [accepted, newState] = shouldAcceptPoint(
    layerPoint,
    e.timeStamp,
    samplingState,
    config,
  );
  samplingState = newState;

  if (accepted) {
    stroke.push(layerPoint);
    redraw();
  }
}
```

### フレームレート制限

```typescript
// 約60fpsに制限（16ms間隔）
const config: SamplingConfig = {
  minDistance: 1,
  minTimeInterval: 16,
};
```

### 高精度モード

```typescript
// 細かい動きも拾う
const config: SamplingConfig = {
  minDistance: 0.5,
};
```

### 粗いスケッチモード

```typescript
// 大まかな線のみ
const config: SamplingConfig = {
  minDistance: 10,
};
```

---

## パフォーマンスの考慮

間引きは **Layer Space** で評価されます。これにより：
- ズームイン時：画面上では大きく動いても、Layer Spaceでは小さな動きとなり適切に間引かれる
- ズームアウト時：画面上では小さな動きでも、Layer Spaceでは大きな動きとなり採用される

```
┌───────────────────────────────────────┐
│ Screen Space (2倍ズーム時)             │
│                                       │
│    A ──────────── B                   │
│    画面上: 100px                       │
│                                       │
└───────────────────────────────────────┘
                    ↓ screenToLayer
┌───────────────────────────────────────┐
│ Layer Space                           │
│                                       │
│    A ───── B                          │
│    実際: 50px                         │
│                                       │
└───────────────────────────────────────┘
```

`minDistance: 2` の場合、Layer Spaceで2px以上離れていれば採用されます。
