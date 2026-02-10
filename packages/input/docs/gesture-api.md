# ジェスチャー API

マルチタッチジェスチャーの認識と状態管理を行う純粋関数群です。DOM非依存で、テストやシミュレーションが容易です。

## 状態遷移図

```
idle ──down──→ single_down (draw-start 発行、pending-only レンダリング)
                 │
                 ├─ 2指目 (猶予期間内) → gesture (draw-cancel + pinch-start 発行)
                 ├─ 移動 > 閾値 → drawing (draw-confirm 発行 → committed フラッシュ)
                 │                   │
                 │                   ├─ 2指目 (猶予期間内) → gesture (draw-cancel + pinch-start)
                 │                   ├─ 2指目 (猶予期間外) → 無視
                 │                   └─ up → idle (draw-end)
                 └─ up → idle (draw-end)

gesture ──move──→ gesture (pinch-move: 相似変換による ViewTransform 発行)
         ──1指up──→ gesture_ending
                      └─ 残り指up → idle
                           ├─ 短時間 + 移動なし → undo 発行
                           └─ それ以外 → pinch-end 発行
```

## createGestureState

ジェスチャー状態の初期値を作成する。

```typescript
function createGestureState(): GestureState;
```

**戻り値**: `GestureState` - `{ phase: "idle" }`

**使用例**:

```typescript
import { createGestureState } from "@headless-paint/input";

const state = createGestureState();
// { phase: "idle" }
```

---

## processGestureEvent

ポインターイベントを処理し、状態遷移と出力イベントを返す。

```typescript
function processGestureEvent(
  state: GestureState,
  event: GesturePointerEvent,
  config: GestureConfig,
  currentTransform: ViewTransform,
): [GestureState, readonly GestureEvent[]];
```

**引数**:

| 名前               | 型                   | 必須 | 説明                                       |
| ------------------ | -------------------- | ---- | ------------------------------------------ |
| `state`            | `GestureState`       | ○    | 現在のジェスチャー状態                     |
| `event`            | `GesturePointerEvent` | ○   | ポインターイベント                         |
| `config`           | `GestureConfig`      | ○    | ジェスチャー設定                           |
| `currentTransform` | `ViewTransform`      | ○    | 現在のビュー変換（レイヤー座標計算用）     |

**戻り値**: `[GestureState, readonly GestureEvent[]]` - [新しい状態, 発行されたイベント配列]

**注意**:

- 純粋関数。同じ入力に対して常に同じ出力を返す
- イベント配列は0〜複数個のイベントを含む（例: `draw-cancel` + `pinch-start` が同時発行）
- `currentTransform` はジェスチャー開始時のレイヤーアンカー計算にのみ使用

**使用例**:

```typescript
import {
  createGestureState,
  processGestureEvent,
  DEFAULT_GESTURE_CONFIG,
  createViewTransform,
} from "@headless-paint/input";

let state = createGestureState();
const config = DEFAULT_GESTURE_CONFIG;
const transform = createViewTransform();

// タッチダウン
const [state1, events1] = processGestureEvent(
  state,
  {
    pointerId: 1,
    pointerType: "touch",
    x: 100,
    y: 200,
    pressure: 1.0,
    timestamp: 1000,
    eventType: "down",
  },
  config,
  transform,
);
// state1.phase === "single_down"
// events1[0].type === "draw-start"

// 移動（閾値超え → ストローク確定）
const [state2, events2] = processGestureEvent(
  state1,
  {
    pointerId: 1,
    pointerType: "touch",
    x: 120,
    y: 200,
    pressure: 1.0,
    timestamp: 1050,
    eventType: "move",
  },
  config,
  transform,
);
// state2.phase === "drawing"
// events2 には "draw-confirm" + "draw-move" が含まれる
```

---

## DEFAULT_GESTURE_CONFIG

デフォルトのジェスチャー設定値。

```typescript
const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  graceWindowMs: 150,
  confirmDistancePx: 10,
  undoMaxMovePx: 20,
  undoMaxDurationMs: 300,
};
```

| 設定               | デフォルト値 | 説明                               |
| ------------------ | ------------ | ---------------------------------- |
| `graceWindowMs`    | `150`        | 二本指切替の猶予期間（ms）         |
| `confirmDistancePx` | `10`       | ストローク確定の移動閾値（px）     |
| `undoMaxMovePx`    | `20`         | Undo判定の最大移動量（px）         |
| `undoMaxDurationMs` | `300`       | Undo判定の最大時間（ms）           |

---

## Pending-Until-Confirmed モデル

ジェスチャー状態マシンは **Pending-Until-Confirmed** モデルを採用しています。

### フロー

1. **タッチダウン** (`single_down`):
   - `draw-start` が発行される
   - 描画は即座に開始されるが、全ポイントを `pendingLayer` にレンダリング
   - `committedLayer` は一切触らない

2. **閾値超え移動** (`drawing`):
   - `draw-confirm` が発行される
   - 蓄積した committed ポイントを `committedLayer` に一括フラッシュ
   - 以降は通常の committed/pending フロー

3. **二本指切替** (`gesture`):
   - `draw-cancel` が発行される
   - `clearLayer(pendingLayer)` するだけ → `committedLayer` は無傷

### メリット

- 低レイテンシ: 描画は即座に開始
- 安全なキャンセル: `committedLayer` を汚さないため、スナップショット不要
- 猶予期間（~150ms）内は全ポイントが pending なので、再描画コストは無視できる

---

## 統合例

```typescript
// PaintCanvas.tsx - pointerType ルーティング
onPointerDown={(e) => {
  if (e.pointerType === "touch" && onTouchPointerEvent) {
    onTouchPointerEvent(e);
  } else {
    pointerHandlers.onPointerDown(e);
  }
}}

// App.tsx - useTouchGesture で GestureEvent を処理
const touchGesture = useTouchGesture({
  transform,
  onSetTransform: handleSetTransform,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd,
  onDrawConfirm, // draw-confirm: pending→committed フラッシュ
  onDrawCancel, // draw-cancel: pendingLayer クリアのみ
  onUndo: handleUndo,
});
```
