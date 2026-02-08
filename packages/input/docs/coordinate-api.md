# 座標変換 API

Screen Space と Layer Space の間で座標を変換する関数群です。

## 座標系の関係

```
Screen Space (入力)        Layer Space (記録)
┌─────────────────┐        ┌─────────────────┐
│  Canvas要素      │  ←→   │  レイヤー        │
│  offsetX/Y      │        │  ストローク座標   │
└─────────────────┘        └─────────────────┘
      ↓                            ↑
   screenToLayer()           layerToScreen()
      ↓                            ↑
   逆ビュー変換              正ビュー変換
```

---

## screenToLayer

Screen Space の座標を Layer Space に変換する。

```typescript
function screenToLayer(
  screenPoint: Point,
  transform: ViewTransform,
): Point | null
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `screenPoint` | `Point` | ○ | Screen Space の座標 |
| `transform` | `ViewTransform` | ○ | 現在のビュー変換 |

**戻り値**: `Point | null` - Layer Space の座標。変換不可の場合は `null`

**用途**: ポインターイベントの座標をストローク記録用の座標に変換

**使用例**:
```typescript
function onPointerMove(e: PointerEvent) {
  const screenPoint = { x: e.offsetX, y: e.offsetY };
  const layerPoint = screenToLayer(screenPoint, transform);

  if (layerPoint) {
    // ストロークに追加
    stroke.points.push(layerPoint);
  }
}
```

---

## layerToScreen

Layer Space の座標を Screen Space に変換する。

```typescript
function layerToScreen(
  layerPoint: Point,
  transform: ViewTransform,
): Point
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layerPoint` | `Point` | ○ | Layer Space の座標 |
| `transform` | `ViewTransform` | ○ | 現在のビュー変換 |

**戻り値**: `Point` - Screen Space の座標

**用途**: レイヤー上の座標を画面上の位置に変換（UI表示、ヒットテスト等）

**使用例**:
```typescript
// ストロークの開始点を画面上で表示
const startPoint = stroke.points[0];
const screenPos = layerToScreen(startPoint, transform);

// 画面上にマーカーを表示
drawMarker(ctx, screenPos.x, screenPos.y);
```

---

## 実践的な使用パターン

### パターン1: ペンツールでの描画

```typescript
let stroke: Point[] = [];

function onPointerDown(e: PointerEvent) {
  stroke = [];
  const point = screenToLayer({ x: e.offsetX, y: e.offsetY }, transform);
  if (point) stroke.push(point);
}

function onPointerMove(e: PointerEvent) {
  if (!isDrawing) return;
  const point = screenToLayer({ x: e.offsetX, y: e.offsetY }, transform);
  if (point) {
    stroke.push(point);
    drawPath(layer, stroke, color, lineWidth);
  }
}
```

### パターン2: スクロールツール

```typescript
function onPointerMove(e: PointerEvent) {
  if (!isPanning) return;
  // Screen Spaceでの移動量をそのまま適用
  transform = pan(transform, e.movementX, e.movementY);
  redraw();
}
```

### パターン3: 回転考慮のスクロール

回転がある場合、Screen Spaceでのドラッグ方向を Layer Space の移動方向に変換する必要があります。

```typescript
function onPointerMove(e: PointerEvent) {
  if (!isPanning) return;

  // 移動量をベクトルとして変換
  const screenDelta = { x: e.movementX, y: e.movementY };

  // 回転成分のみを逆適用（スケールは無視）
  const { rotation: angle } = decomposeTransform(transform);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const layerDx = screenDelta.x * cos - screenDelta.y * sin;
  const layerDy = screenDelta.x * sin + screenDelta.y * cos;

  transform = pan(transform, layerDx, layerDy);
  redraw();
}
```
