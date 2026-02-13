# Brush API

ブラシ種別に応じたストローク描画を行う API。`drawVariableWidthPath` を内包するディスパッチ層として、`appendToCommittedLayer` / `renderPendingLayer` の内部から呼ばれる。

## 概要

### 背景

従来の描画は `drawVariableWidthPath`（circle + trapezoid fill）による単一方式。ブラシ拡張により、スタンプベースの描画（エアブラシ、鉛筆、パステル等）を追加する。

### ディスパッチ方式

`StrokeStyle.brush` の `type` フィールドで描画方式を切り替える:

```
StrokeStyle.brush.type
  ├── "round-pen" → drawVariableWidthPath（従来方式）
  └── "stamp"     → renderStampBrushStroke（スタンプ方式）
```

### チップ生成の責務分離

チップ画像の生成は呼び出し側（`useStrokeSession` 等）の責務。`renderBrushStroke` は事前生成された `tipCanvas` を `BrushRenderState` 経由で受け取る。

---

## renderBrushStroke

ブラシ種別に応じてストロークを描画するディスパッチ関数。

```typescript
function renderBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  overlapCount?: number,
  state?: BrushRenderState,
): BrushRenderState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 描画先レイヤー |
| `points` | `readonly StrokePoint[]` | ○ | 描画ポイント列（展開済みの単一ストローク） |
| `style` | `StrokeStyle` | ○ | 描画スタイル（`brush` フィールドでブラシ種別を判定） |
| `overlapCount` | `number` | - | 先頭のオーバーラップ点数。`round-pen` では `drawVariableWidthPath` にパススルー。`stamp` では無視される（距離ベースのため不要） |
| `state` | `BrushRenderState` | - | ブラシレンダリング状態。`stamp` ブラシでは `accumulatedDistance` と `tipCanvas` を含む。`round-pen` では無視される |

**戻り値**: `BrushRenderState` — 更新されたレンダリング状態。`stamp` ブラシでは `accumulatedDistance` が更新される。`round-pen` では `{ accumulatedDistance: 0, tipCanvas: null, seed: 0 }` を返す。

**動作**:
1. `style.brush.type` を判定
2. `"round-pen"`: `drawVariableWidthPath` を呼び出し（従来方式）
3. `"stamp"`: スタンプ方式で描画:
   - ポイント列を Catmull-Rom 補間
   - `accumulatedDistance` から `spacing` 間隔でパスを走査
   - 各スタンプ位置で `tipCanvas` を `drawImage` で配置
   - jitter パラメータは位置ベース PRNG で決定

**使用例**:
```typescript
import { renderBrushStroke } from "@headless-paint/engine";

// round-pen（従来互換）
const state = renderBrushStroke(layer, points, style, overlapCount);

// stamp ブラシ
const initialState: BrushRenderState = {
  accumulatedDistance: 0,
  tipCanvas: generateBrushTip(brush.tip, size, color),
  seed: brushSeed,
};
const nextState = renderBrushStroke(layer, points, style, 0, initialState);
// nextState.accumulatedDistance を次の呼び出しに渡す
```

---

## generateBrushTip

ブラシチップ画像を生成する。ストローク開始時に1回呼び出し、全スタンプで再利用する。

```typescript
function generateBrushTip(
  config: BrushTipConfig,
  size: number,
  color: Color,
  registry?: BrushTipRegistry,
): OffscreenCanvas
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `config` | `BrushTipConfig` | ○ | チップ形状の設定 |
| `size` | `number` | ○ | チップのピクセルサイズ（`lineWidth * 2`） |
| `color` | `Color` | ○ | チップに焼き込む色 |
| `registry` | `BrushTipRegistry` | - | 画像チップ用のレジストリ。`ImageTipConfig` 使用時に必要 |

**戻り値**: `OffscreenCanvas` — 生成されたチップ画像

**動作**:
- `CircleTipConfig`: `hardness` に応じた radialGradient でチップを生成
  - `hardness=1.0`: 完全にハードな円（アルファ100%）
  - `hardness=0.0`: ガウシアンフォールオフ（中心から外縁へ透明度が増す）
  - 中間値: 線形補間
- `ImageTipConfig`: `registry` から `imageId` で画像を取得し、指定色で着色

**使用例**:
```typescript
// ソフト円形チップ
const softTip = generateBrushTip(
  { type: "circle", hardness: 0.0 },
  64,
  { r: 0, g: 0, b: 0, a: 255 },
);

// 画像チップ
const imageTip = generateBrushTip(
  { type: "image", imageId: "pastel-grain" },
  64,
  { r: 100, g: 50, b: 20, a: 255 },
  myRegistry,
);
```

---

## BrushTipRegistry

画像ベースチップの管理インターフェース。

```typescript
interface BrushTipRegistry {
  readonly get: (imageId: string) => ImageBitmap | undefined;
  readonly set: (imageId: string, image: ImageBitmap) => void;
}
```

| メソッド | 説明 |
|---------|------|
| `get(imageId)` | 登録済み画像を取得。未登録の場合 `undefined` |
| `set(imageId, image)` | 画像を登録 |

**設計意図**: 画像チップの base64 埋め込みはコマンド履歴の肥大化を招くため、`imageId` 参照でランタイム解決する。

---

## PRNG ユーティリティ

スタンプブラシの jitter を決定論的に生成するための疑似乱数関数。

### mulberry32

32bit シードから疑似乱数列を生成する。

```typescript
function mulberry32(seed: number): () => number
```

**引数**: `seed` — 32bit 整数シード
**戻り値**: 呼び出すたびに [0, 1) の疑似乱数を返す関数

### hashSeed

グローバルシードとストローク上の距離から、位置固有のシードを生成する。

```typescript
function hashSeed(globalSeed: number, distance: number): number
```

**引数**:
| 名前 | 型 | 説明 |
|------|-----|------|
| `globalSeed` | `number` | ストロークごとのグローバルシード |
| `distance` | `number` | ストローク始点からの累積距離（`round(distance * 100)` で量子化される） |

**戻り値**: `number` — 位置固有の 32bit シード

**設計意図**:
位置ベースの PRNG により、committed と pending を独立に描画しても、同一距離のスタンプは同一の jitter を持つ。pending 再描画時に committed のスタンプ数を復元する必要がない。

**使用例**:
```typescript
// ストローク開始時にグローバルシードを生成
const globalSeed = Math.random() * 0xffffffff | 0;

// 各スタンプ位置で位置固有の乱数を生成
const localSeed = hashSeed(globalSeed, accumulatedDistance);
const rng = mulberry32(localSeed);
const opacityVariation = rng() * opacityJitter;
const sizeVariation = rng() * sizeJitter;
```

---

## プリセットブラシ

エクスポートされた標準ブラシプリセット定数。`@headless-paint/engine` および `@headless-paint/react` から import できる。

```typescript
import { ROUND_PEN, AIRBRUSH, PENCIL, MARKER } from "@headless-paint/engine";
```

```typescript
const AIRBRUSH: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.05, flow: 0.1 },
};

const PENCIL: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.95 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.1, sizeJitter: 0.05, scatter: 0.02 },
};

const MARKER: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.7 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.15, flow: 0.8 },
};

const PASTEL: StampBrushConfig = {
  type: "stamp",
  tip: { type: "image", imageId: "pastel-grain" },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.2,
    rotationJitter: Math.PI,
    scatter: 0.1,
    opacityJitter: 0.2,
  },
};
```

| プリセット | チップ | 特徴 |
|-----------|--------|------|
| AIRBRUSH | ソフト円 (hardness=0.0) | 密間隔・低フロー。滑らかな噴射効果 |
| PENCIL | ほぼハード円 (hardness=0.95) | 微小なサイズ・位置のゆらぎ |
| MARKER | やや柔らか (hardness=0.7) | 中間フロー。マーカー的な塗り |
| PASTEL | テクスチャ画像 | 大きな回転・散布。乾燥メディア風 |
