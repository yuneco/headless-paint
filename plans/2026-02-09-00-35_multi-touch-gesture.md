# Multi-Touch Gesture Support

## Context

タブレットでのタッチ操作を最適化する。現状は PointerEvent 経由の単一ポインター入力のみ対応（マウス/ペン/タッチ統一）で、マルチタッチジェスチャーは一切未実装。

**ゴール:**
- タッチ/ペンで描画を含む全操作が可能
- 二本指タップ → Undo
- 二本指ドラッグ → スクロール/回転/ズーム（指の下のピクセルが常に追従）
- タッチの時間差に対する適切なケア（即座に描画開始→猶予期間内なら二本指切替）

## Architecture

### PointerType ルーティング

```
PointerEvent
  ├─ pointerType: "pen" / "mouse" → usePointerHandler (既存、変更なし)
  └─ pointerType: "touch" → useTouchGesture (新規)
```

PaintCanvas がイベントを `pointerType` で振り分け。既存のマウス/ペン操作に影響なし。

### Gesture State Machine (`packages/input/src/gesture.ts`)

純粋関数の状態マシン。DOM非依存。

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

### Similarity Transform (`computeSimilarityTransform`)

ピンチジェスチャーで incremental な pan/zoom/rotate を使うとドリフトが蓄積する。
代わりに **2組の点対応から相似変換を直接計算** し、ViewTransform を丸ごと置換する。

```
ジェスチャー開始時: 2指の Screen 座標 → screenToLayer → Layer 座標アンカー (L1, L2) を記録
各フレーム: 現在の Screen 座標 (S1, S2) と L1, L2 から相似変換を計算
  → L1→S1, L2→S2 を満たす ViewTransform を返す
  → 指の下のレイヤー座標が完全に保存される（ドリフトゼロ）
```

数式: `dL = L2-L1`, `dS = S2-S1`, `denom = |dL|^2`
```
a = (dSx*dLx + dSy*dLy) / denom
b = (dSy*dLx - dSx*dLy) / denom
tx = S1x - a*L1x + b*L1y,  ty = S1y - b*L1x - a*L1y
→ mat3 column-major: [a, b, 0, -b, a, 0, tx, ty, 1]
```

### Pending-Until-Confirmed モデル

描画は即座に開始（低レイテンシ）だが、**確定前は全ポイントを pendingLayer にレンダリング**し committedLayer は触らない。
これにより二本指切替時のキャンセルが `clearLayer(pendingLayer)` だけで済み、ImageData スナップショットが不要になる。

```
未確定 (single_down):
  FilterPipeline は通常通り committed/pending を分離
  ただし描画は全ポイント (committed + pending) を pendingLayer にレンダリング
  committedLayer は一切触らない

確定 (draw-confirm 発行時):
  蓄積した committed ポイントを committedLayer に一括フラッシュ
  以降は通常の committed/pending フロー

キャンセル (draw-cancel 発行時):
  clearLayer(pendingLayer) するだけ → committedLayer は無傷
```

猶予期間は ~150ms なので、全ポイントを pending として毎フレーム再描画するコストは無視できる。

---

## Implementation Steps (Doc-First)

### Phase 1: API Design & Documentation

#### 1-1. 型定義 (`packages/input/src/types.ts`)

```typescript
// Gesture input (DOM非依存)
export interface GesturePointerEvent {
  readonly pointerId: number;
  readonly pointerType: "touch" | "pen" | "mouse";
  readonly x: number;       // Screen Space
  readonly y: number;       // Screen Space
  readonly pressure: number;
  readonly timestamp: number;
  readonly eventType: "down" | "move" | "up" | "cancel";
}

// Config
export interface GestureConfig {
  readonly graceWindowMs: number;       // 猶予期間 (default: 150ms)
  readonly confirmDistancePx: number;   // ストローク確定の移動閾値 (default: 10px)
  readonly undoMaxMovePx: number;       // Undo判定の最大移動量 (default: 20px)
  readonly undoMaxDurationMs: number;   // Undo判定の最大時間 (default: 300ms)
}

// State (discriminated union)
export type GestureState =
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

// Output events
export type GestureEvent =
  | { readonly type: "draw-start"; readonly point: GesturePointerEvent }
  | { readonly type: "draw-move"; readonly point: GesturePointerEvent }
  | { readonly type: "draw-confirm" }   // ストローク確定: pending→committed フラッシュ
  | { readonly type: "draw-end" }
  | { readonly type: "draw-cancel" }    // ストロークキャンセル: pendingLayer クリアのみ
  | { readonly type: "pinch-start"; readonly transform: ViewTransform }
  | { readonly type: "pinch-move"; readonly transform: ViewTransform }
  | { readonly type: "pinch-end" }
  | { readonly type: "undo" };
```

#### 1-2. 関数シグネチャ

**gesture.ts (新規)**:
- `createGestureState(): GestureState` — 初期状態 (`{ phase: "idle" }`)
- `processGestureEvent(state, event, config, currentTransform): [GestureState, readonly GestureEvent[]]` — 状態遷移 + イベント発行
- `DEFAULT_GESTURE_CONFIG: GestureConfig` — デフォルト設定値

**transform.ts (追加)**:
- `computeSimilarityTransform(layerP1, layerP2, screenP1, screenP2): ViewTransform | null` — 2点対応から相似変換を計算。2点が一致する場合 null

#### 1-3. ドキュメント作成

| ファイル | 変更 |
|---------|------|
| `packages/input/docs/gesture-api.md` | 新規: 状態遷移図、型リファレンス、統合例 |
| `packages/input/docs/transform-api.md` | `computeSimilarityTransform` 追加 |
| `packages/input/docs/types.md` | ジェスチャー関連型の追加 |
| `packages/input/docs/README.md` | ジェスチャーセクション追加 |

### Phase 2: 利用イメージレビュー (承認チェックポイント)

Web app 側の統合イメージ:

```typescript
// PaintCanvas.tsx - pointerType ルーティング
const handlePointerDown = (e: React.PointerEvent) => {
  if (e.pointerType === "touch") touchHandlers.onPointerDown(e);
  else toolHandlers.onPointerDown(e);
};

// useTouchGesture.ts - 新 React Hook
// GestureEvent を受けて適切なコールバックを呼ぶ
const touchHandlers = useTouchGesture({
  transform,
  onSetTransform: handleSetTransform,
  onStrokeStart, onStrokeMove, onStrokeEnd,
  onStrokeConfirm,  // draw-confirm: pending→committed フラッシュ
  onStrokeCancel,   // draw-cancel: pendingLayer クリアのみ
  onUndo: handleUndo,
});

// App.tsx - 未確定フェーズ: 全ポイントを pending としてレンダリング
const onStrokeStart = useCallback((point: InputPoint) => {
  // session 開始、FilterPipeline 初期化
  // committed も pending も全て pendingLayer にレンダリング
  // committedLayer は触らない
}, []);

const onStrokeConfirm = useCallback(() => {
  // session の allCommitted を committedLayer に一括フラッシュ
  // 以降は通常の committed/pending フロー
}, []);

const onStrokeCancel = useCallback(() => {
  clearLayer(pendingLayer);  // これだけ！committedLayer は無傷
  sessionRef.current = null;
}, []);
```

### Phase 3: Implementation

| # | 内容 | ファイル |
|---|------|---------|
| 3-1 | `computeSimilarityTransform` 実装 + テスト | `packages/input/src/transform.ts`, `transform.test.ts` |
| 3-2 | ジェスチャー型定義 | `packages/input/src/types.ts` |
| 3-3 | `gesture.ts` 状態マシン実装 + テスト | `packages/input/src/gesture.ts`, `gesture.test.ts` |
| 3-4 | export 更新 | `packages/input/src/index.ts` |
| 3-5 | `useViewTransform` に `handleSetTransform` 追加 | `apps/web/src/hooks/useViewTransform.ts` |
| 3-6 | `useTouchGesture` React Hook 新規作成 | `apps/web/src/hooks/useTouchGesture.ts` |
| 3-7 | Pending-Until-Confirmed + キャンセル対応 | `apps/web/src/App.tsx` |
| 3-8 | PaintCanvas の pointerType ルーティング | `apps/web/src/components/PaintCanvas.tsx` |
| 3-9 | ドキュメント作成・更新 | `packages/input/docs/` |
| 3-10 | `TouchDebugOverlay` コンポーネント新規作成 | `apps/web/src/components/TouchDebugOverlay.tsx` |
| 3-11 | DebugPanel に Touch Debug トグル + フェーズ表示追加 | `apps/web/src/components/DebugPanel.tsx` |
| 3-12 | App.tsx でデバッグ state 管理 + コンポーネント配線 | `apps/web/src/App.tsx` |

### Phase 4: セルフレビュー (review-library-usage)

- `computeSimilarityTransform` が既存の `mat3` 操作と一貫性あるか
- `createGestureState`/`processGestureEvent` が `createSamplingState`/`shouldAcceptPoint` のパターンに従っているか
- 全ての新型に `readonly` が付いているか
- ドキュメントと実装の整合性

---

## Touch Debug 機能

### TouchDebugOverlay コンポーネント (新規)

`SymmetryOverlay` と同様の canvas オーバーレイ（`pointerEvents: "none"`）。
アクティブなタッチポイントを視覚化する。

**表示内容:**
- 各タッチポイントに **色分けされた円** (半径 ~30px)
  - pointer ID ごとに固定色 (例: `hsl(pointerId * 137.5 % 360, 70%, 50%)`)
  - 半透明のフィル + 不透明のストローク
- 円の中央に **ラベル** (`P0`, `P1` 等の pointer ID)
- 画面上部に **ジェスチャーフェーズ** をテキスト表示
  - 例: `gesture: pinch`, `touch: drawing`, `touch: idle`
  - フェーズに応じた背景色で視認性確保

**Props:**
```typescript
interface TouchDebugOverlayProps {
  enabled: boolean;
  touchPoints: ReadonlyMap<number, Point>;  // pointerId → screen position
  gesturePhase: string;
  width: number;
  height: number;
}
```

**データフロー:**
- `useTouchGesture` hook がアクティブなタッチポイント位置と gesturePhase を公開
- `App.tsx` が `TouchDebugOverlay` に渡す
- DebugPanel の lil-gui チェックボックスで ON/OFF 制御

### DebugPanel への統合

lil-gui に以下を追加:
- **"Touch Debug" チェックボックス** — オーバーレイの ON/OFF
- **テキスト表示** — 現在のジェスチャーフェーズ (`idle` / `single_down` / `drawing` / `gesture` / `gesture_ending`)

State は App.tsx で管理:
```typescript
const [touchDebugEnabled, setTouchDebugEnabled] = useState(false);
```

---

## テスト方法

### ユニットテスト: 純粋関数 (DOM 不要)

gesture.ts の状態マシンは純粋関数なので vitest で直接テスト:

```typescript
const state0 = createGestureState();
const [state1, events1] = processGestureEvent(
  state0,
  { pointerId: 1, eventType: "down", x: 100, y: 200, ... },
  config, transform,
);
expect(state1.phase).toBe("single_down");
expect(events1[0].type).toBe("draw-start");
```

### E2E テスト: Playwright + CDP

外部ライブラリは使用しない。Playwright の CDP API でマルチタッチをシミュレート:

```typescript
// テストヘルパー (packages/input/src/test-utils/touch-helpers.ts)
async function createTouchSession(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return {
    async touchStart(points: Array<{ x: number; y: number; id: number }>) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: points,
      });
    },
    async touchMove(points: Array<{ x: number; y: number; id: number }>) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points,
      });
    },
    async touchEnd() {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    },
  };
}
```

テストケース:
- **ピンチズーム**: 2点を配置 → 離す方向に移動 → ズーム倍率が変化
- **二本指タップ**: 2点同時 down → すぐ up → Undo 発行
- **ストロークキャンセル**: 1点 down → 描画開始 → 猶予期間内に2点目 → ストロークキャンセル
- **猶予期間外**: 1点 down → 閾値超え移動 → 2点目 → 無視される

### 手動テスト: TouchDebugOverlay

タブレット実機で TouchDebugOverlay を ON にして:
- タッチポイントの位置・数が正しく表示されるか
- ジェスチャーフェーズの遷移が正しいか
- ピンチ操作で指の下のピクセルが追従するか

---

## Verification

1. **ユニットテスト**: `pnpm --filter @headless-paint/input test`
   - `computeSimilarityTransform`: 恒等/平行移動/回転/ズーム/複合/退化ケース
   - `processGestureEvent`: 全状態遷移パス、猶予期間の境界値、Undo判定
2. **ビルド**: `pnpm build` が通ること
3. **E2E テスト**: Playwright + CDP でマルチタッチシナリオが通ること
4. **手動テスト**: TouchDebugOverlay で実機動作確認
5. **回帰テスト**: マウス/ペン操作が従来通り動作すること
