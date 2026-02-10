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

---

## decomposeTransform

ビュー変換行列を個別の変換成分（スケール・回転・平行移動）に分解する。

```typescript
function decomposeTransform(
  transform: ViewTransform,
): TransformComponents
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `transform` | `ViewTransform` | ○ | 分解対象のビュー変換 |

**戻り値**: `TransformComponents` - 変換成分（スケール、回転、平行移動）

**用途**: デバッグ表示、UI での変換情報表示など。

**使用例**:
```typescript
import { decomposeTransform } from "@headless-paint/input";

const components = decomposeTransform(transform);

// スケール値を取得
console.log(`Scale: ${components.scaleX} x ${components.scaleY}`);

// 回転角度を度に変換して表示
const rotationDeg = components.rotation * (180 / Math.PI);
console.log(`Rotation: ${rotationDeg.toFixed(1)}°`);

// 平行移動量を表示
console.log(`Translate: (${components.translateX}, ${components.translateY})`);
```

**注意**:
- `zoom()` は常に均等スケールを適用するため、通常は `scaleX === scaleY`
- シアー（せん断）変換を含む行列では正確な分解ができない場合がある

---

## fitToView

レイヤー全体がビューポートに収まるビュー変換を作成する。初期表示・リセット時に使用する。

```typescript
function fitToView(
  viewWidth: number,
  viewHeight: number,
  layerWidth: number,
  layerHeight: number,
): ViewTransform
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `viewWidth` | `number` | ○ | ビューポートの幅（Screen Space） |
| `viewHeight` | `number` | ○ | ビューポートの高さ（Screen Space） |
| `layerWidth` | `number` | ○ | レイヤーの幅（Layer Space） |
| `layerHeight` | `number` | ○ | レイヤーの高さ（Layer Space） |

**戻り値**: `ViewTransform` - レイヤーをビュー中央にフィットさせるビュー変換

**注意**:
- アスペクト比を保ったまま、ビューポートに収まる最大スケールを適用する
- レイヤーとビューポートのアスペクト比が異なる場合、短い辺の方向に中央寄せされる

**使用例**:
```typescript
import { fitToView } from "@headless-paint/input";

// 1024x768 のレイヤーを 800x600 のビューポートにフィット
const transform = fitToView(800, 600, 1024, 768);

// React での初期表示
const setInitialFit = useCallback(
  (viewW: number, viewH: number, layerW: number, layerH: number) => {
    setTransform(fitToView(viewW, viewH, layerW, layerH));
  },
  [],
);
```

---

## applyDpr

ビュー変換に Device Pixel Ratio スケーリングを適用する。Canvas API の描画時に、論理ピクセルと物理ピクセルの対応を取るために使用する。

```typescript
function applyDpr(
  transform: ViewTransform,
  dpr: number,
): ViewTransform
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `transform` | `ViewTransform` | ○ | 適用元のビュー変換 |
| `dpr` | `number` | ○ | Device Pixel Ratio（通常は `window.devicePixelRatio`） |

**戻り値**: `ViewTransform` - DPR スケーリングが適用された新しいビュー変換（元の変換は変更されない）

**注意**:
- Canvas の物理ピクセルサイズを `width * dpr`, `height * dpr` に設定した上で、この関数で変換した行列を `renderLayers` 等に渡す
- 元のビュー変換は座標変換（`screenToLayer` 等）にそのまま使い、DPR 適用済みの変換は描画にのみ使用する

**使用例**:
```typescript
import { applyDpr } from "@headless-paint/input";
import { renderLayers } from "@headless-paint/engine";

// Canvas の物理サイズを DPR に合わせる
const dpr = window.devicePixelRatio;
canvas.width = width * dpr;
canvas.height = height * dpr;
ctx.scale(dpr, dpr);

// DPR 適用済みの変換で描画
renderLayers(layers, ctx, applyDpr(transform, dpr), { background });
```

---

## computeSimilarityTransform

2組の点対応（レイヤー座標とスクリーン座標）から相似変換を計算する。ピンチジェスチャーで使用し、指の下のレイヤー座標が完全に保存される（ドリフトゼロ）。

```typescript
function computeSimilarityTransform(
  layerP1: Point,
  layerP2: Point,
  screenP1: Point,
  screenP2: Point,
): ViewTransform | null
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layerP1` | `Point` | ○ | 1本目の指のレイヤー座標（ジェスチャー開始時に記録） |
| `layerP2` | `Point` | ○ | 2本目の指のレイヤー座標（ジェスチャー開始時に記録） |
| `screenP1` | `Point` | ○ | 1本目の指の現在のスクリーン座標 |
| `screenP2` | `Point` | ○ | 2本目の指の現在のスクリーン座標 |

**戻り値**: `ViewTransform | null` - 相似変換行列。2つのレイヤー座標が一致する場合（退化ケース）は `null`

**アルゴリズム**:
```
dL = L2 - L1, dS = S2 - S1, denom = |dL|²
a = (dSx·dLx + dSy·dLy) / denom
b = (dSy·dLx - dSx·dLy) / denom
tx = S1x - a·L1x + b·L1y
ty = S1y - b·L1x - a·L1y
→ mat3 column-major: [a, b, 0, -b, a, 0, tx, ty, 1]
```

**注意**:
- incremental な pan/zoom/rotate ではなく、2点対応から ViewTransform を丸ごと計算する
- ドリフトが蓄積しないため、長時間のジェスチャーでも精度が保たれる
- 2つのレイヤー座標が完全に一致する場合は除算エラーを避けるため `null` を返す

**使用例**:
```typescript
import { computeSimilarityTransform, screenToLayer } from "@headless-paint/input";

// ジェスチャー開始時: スクリーン座標からレイヤーアンカーを記録
const layerP1 = screenToLayer(screenP1, currentTransform);
const layerP2 = screenToLayer(screenP2, currentTransform);

// 各フレーム: 現在のスクリーン座標とアンカーから ViewTransform を計算
const newTransform = computeSimilarityTransform(
  layerP1, layerP2,
  currentScreenP1, currentScreenP2,
);
if (newTransform) {
  setTransform(newTransform);
}
```
