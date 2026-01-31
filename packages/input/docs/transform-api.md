# ビュー変換 API

ビュー変換（パン・ズーム・回転）を操作する関数群です。

## createViewTransform

単位行列のビュー変換を作成する。

```typescript
function createViewTransform(): ViewTransform
```

**戻り値**: `ViewTransform` - 単位行列

**使用例**:
```typescript
const transform = createViewTransform();
// 変換なし（等倍、回転なし、移動なし）
```

---

## pan

ビュー変換に平行移動を適用する。

```typescript
function pan(
  transform: ViewTransform,
  dx: number,
  dy: number,
): ViewTransform
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `transform` | `ViewTransform` | ○ | 現在のビュー変換 |
| `dx` | `number` | ○ | X方向の移動量（Screen Space） |
| `dy` | `number` | ○ | Y方向の移動量（Screen Space） |

**戻り値**: `ViewTransform` - 新しいビュー変換（元の変換は変更されない）

**使用例**:
```typescript
let transform = createViewTransform();

// 右に100px、下に50px移動
transform = pan(transform, 100, 50);

// ドラッグ中の移動
function onPointerMove(e: PointerEvent) {
  const dx = e.movementX;
  const dy = e.movementY;
  transform = pan(transform, dx, dy);
}
```

---

## zoom

中心点を基準にズームを適用する。

```typescript
function zoom(
  transform: ViewTransform,
  scale: number,
  centerX: number,
  centerY: number,
): ViewTransform
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `transform` | `ViewTransform` | ○ | 現在のビュー変換 |
| `scale` | `number` | ○ | スケール倍率（1.0 = 等倍） |
| `centerX` | `number` | ○ | ズーム中心のX座標（Screen Space） |
| `centerY` | `number` | ○ | ズーム中心のY座標（Screen Space） |

**戻り値**: `ViewTransform` - 新しいビュー変換

**注意**:
- `scale > 1.0` で拡大、`scale < 1.0` で縮小
- 中心点は固定されたまま周囲が拡大/縮小される

**使用例**:
```typescript
let transform = createViewTransform();

// キャンバス中央を基準に1.5倍に拡大
const cx = canvas.width / 2;
const cy = canvas.height / 2;
transform = zoom(transform, 1.5, cx, cy);

// ホイールイベントでズーム
function onWheel(e: WheelEvent) {
  const scale = e.deltaY > 0 ? 0.9 : 1.1;
  transform = zoom(transform, scale, e.offsetX, e.offsetY);
}
```

---

## rotate

中心点を基準に回転を適用する。

```typescript
function rotate(
  transform: ViewTransform,
  angleRad: number,
  centerX: number,
  centerY: number,
): ViewTransform
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `transform` | `ViewTransform` | ○ | 現在のビュー変換 |
| `angleRad` | `number` | ○ | 回転角度（ラジアン、正=反時計回り） |
| `centerX` | `number` | ○ | 回転中心のX座標（Screen Space） |
| `centerY` | `number` | ○ | 回転中心のY座標（Screen Space） |

**戻り値**: `ViewTransform` - 新しいビュー変換

**使用例**:
```typescript
let transform = createViewTransform();

// キャンバス中央を基準に15度回転
const cx = canvas.width / 2;
const cy = canvas.height / 2;
transform = rotate(transform, Math.PI / 12, cx, cy);

// ショートカットキーで回転
function onKeyDown(e: KeyboardEvent) {
  if (e.key === "r") {
    transform = rotate(transform, Math.PI / 12, cx, cy);  // 15度
  }
  if (e.key === "R") {
    transform = rotate(transform, -Math.PI / 12, cx, cy); // -15度
  }
}
```

---

## invertViewTransform

ビュー変換の逆変換を計算する。

```typescript
function invertViewTransform(
  transform: ViewTransform,
): ViewTransform | null
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `transform` | `ViewTransform` | ○ | 逆変換を求める対象 |

**戻り値**: `ViewTransform | null` - 逆変換行列。逆行列が存在しない場合は `null`

**用途**: `screenToLayer` 関数の内部で使用。通常は直接呼び出す必要はありません。

**使用例**:
```typescript
const inverse = invertViewTransform(transform);
if (inverse) {
  // 逆変換が存在する
}
```
