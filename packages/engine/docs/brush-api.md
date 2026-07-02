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
  ├── "stamp"     → renderStampBrushStroke（スタンプ方式）
  └── "spray"     → renderSprayBrushStroke（散布方式）
```

### チップ生成の責務分離

チップ画像の生成は呼び出し側（`useStrokeSession` 等）の責務。`renderBrushStroke` は事前生成された `tipCanvas` を `BrushRenderState` 経由で受け取る。stamp では dab の元画像、spray では粒子チップとして使う。混色有効時は `tipCanvas` を alpha mask として使い、分岐ごとの `mixing.colorBuffer` に背景 footprint と復元色を転写してから、tip alpha が適用された dab を描画する。

### モジュール構成

ブラシ実装は `packages/engine/src/brush/` 配下に分割される。

| ファイル | 責務 |
|---|---|
| `index.ts` | `renderBrushStroke` の dispatch と公開 re-export |
| `prng.ts` | `mulberry32` / `hashSeed` |
| `scheduler.ts` | 距離ベース emission 走査（stamp / spray 共有） |
| `state.ts` | `BrushRenderState` の生成・branch 分解・merge・pending クローン |
| `tip.ts` | `generateBrushTip` / `BrushTipRegistry` |
| `stamp.ts` | stamp 描画（`walkEmissions` + dab 配置） |
| `mixing.ts` | stamp 混色チップ生成と color buffer 更新 |
| `spray.ts` | spray 描画（`walkEmissions` + 粒子バースト） |

`@yuneco/headless-paint/core` からの公開名は `brush/index.ts` 経由で提供する。公開対象は `renderBrushStroke`、`generateBrushTip`、`createBrushTipRegistry`、`mulberry32`、`hashSeed`、`walkEmissions` と、ブラシ関連型・プリセット定数。

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
  sourceLayer?: Layer,
): BrushRenderState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 描画先レイヤー |
| `points` | `readonly StrokePoint[]` | ○ | 描画ポイント列（展開済みの単一ストローク） |
| `style` | `StrokeStyle` | ○ | 描画スタイル（`brush` フィールドでブラシ種別を判定） |
| `overlapCount` | `number` | - | 先頭のオーバーラップ点数。`round-pen` では `drawVariableWidthPath` にパススルー。`stamp` では `interpolateStrokePoints` に渡され、overlap 区間は Catmull-Rom の文脈点として使われるが出力からは除外される |
| `state` | `BrushRenderState` | - | ブラシレンダリング状態。`stamp` / `spray` では `tipCanvas` と `branches[].accumulatedDistance` / `emissionCount`、混色有効時の `branches[].mixing` を含む。`round-pen` では無視される |
| `sourceLayer` | `Layer` | - | 混色有効時に背景転写元として参照するレイヤー。省略時は `layer` を参照する |

**戻り値**: `BrushRenderState` — 更新されたレンダリング状態。`stamp` / `spray` では対象 branch の `accumulatedDistance` と `emissionCount` が更新される。`round-pen` では `{ seed: 0, tipCanvas: null, branches: [{ accumulatedDistance: 0, emissionCount: 0 }] }` を返す。

**動作**:
1. `style.brush.type` を判定
2. `"round-pen"`: `drawVariableWidthPath` を呼び出し（従来方式）
3. `"stamp"`: スタンプ方式で描画:
   - ポイント列を Catmull-Rom 補間
   - branch の `accumulatedDistance` から `spacing` 間隔でパスを走査
   - 各スタンプ位置で `tipCanvas` を `drawImage` で配置
   - `brush.pressureDynamics.size` でスタンプサイズを決める
   - `brush.pressureDynamics.flow` でスタンプごとの flow を筆圧変化させる
   - 混色有効時は、一定距離ごとに描画先 footprint を分岐ごとの `mixing.colorBuffer` へ `pickup` の強さで転写し、元色を `restore` の強さで重ねた後、`tipCanvas` の alpha を適用して描画
   - jitter パラメータは emission 通し番号ベース PRNG で決定
4. `"spray"`: 散布方式で描画:
   - ポイント列を Catmull-Rom 補間
   - branch の `accumulatedDistance` から `spacing` 間隔で emission を発生させる
   - 各 emission で散布領域内に複数の粒子を確率配置する
   - `brush.pressureDynamics.size` で散布径、`flow` で粒子不透明度、`density` で粒子数を筆圧変化させる

---

## walkEmissions

Catmull-Rom 補間済み点列を距離 spacing で走査し、stamp の dab と spray の粒子バーストに共通する emission 位置を列挙する。

```typescript
interface EmissionPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number | undefined;
  readonly distance: number;
  readonly emissionIndex: number;
}

function walkEmissions(
  interpolated: readonly StrokePoint[],
  spacingPx: number,
  startState: {
    readonly accumulatedDistance: number;
    readonly emissionCount: number;
  },
  overlapCount: number,
  emit: (point: EmissionPoint) => void,
): {
  readonly accumulatedDistance: number;
  readonly emissionCount: number;
}
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `interpolated` | `readonly StrokePoint[]` | ○ | `interpolateStrokePoints` 済みの点列 |
| `spacingPx` | `number` | ○ | emission 間隔 px |
| `startState` | `{ accumulatedDistance, emissionCount }` | ○ | branch ごとの開始状態 |
| `overlapCount` | `number` | ○ | 先頭のオーバーラップ点数。ストローク開始 emission と spacing 位相を既存差分描画に合わせる |
| `emit` | `(point: EmissionPoint) => void` | ○ | emission ごとに呼ばれる callback |

**戻り値**: 更新後の branch state。`accumulatedDistance` は次回チャンクの spacing 位相に、`emissionCount` は次回 emission の序数に使う。

**設計意図**:
- emission は「距離 scheduler が発生させる描画単位」。stamp では dab 1個、spray では散布領域1回分の粒子バーストを意味する。
- ストローク開始 emission（`distance=0`）と `nextStampDist` 相当の位相計算は `walkEmissions` に集約する。
- 将来の時間 emission は同じ `scheduler.ts` に `walkTimeEmissions()` として追加し、距離 emission と序数空間を共有する。

### 筆圧の反映先

`brush.pressureDynamics` で、ブラシごとに筆圧の反映先を指定する。

```typescript
const pencil: StampBrushConfig = {
  type: "stamp",
  tip: { type: "image", imageId: "pencil-grain" },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.2, flow: 0.45 },
  pressureDynamics: { size: 1, flow: 0 },
};

const airbrush: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.05, flow: 0.1 },
  pressureDynamics: { size: 0, flow: 1 },
};

const sprayAirbrush: SprayBrushConfig = {
  type: "spray",
  particle: { type: "circle", hardness: 1.0 },
  dynamics: { ...DEFAULT_SPRAY_DYNAMICS, density: 5, particleSize: 2 },
  pressureDynamics: { size: 0.2, flow: 1, density: 0.5 },
};
```

`round-pen` は `pressureDynamics.size` のみを使う。`pressureDynamics.flow` は設定値として保持できるが描画には反映しない。UIでは `round-pen` 選択時に flow 筆圧コントロールを表示しない。

`spray` は `SprayPressureDynamics` を使い、`size` は散布径、`flow` は粒子不透明度、`density` は粒子数へ反映する。`DEFAULT_SPRAY_PRESSURE_DYNAMICS.density` は `0` で、密度筆圧はプリセット側で明示的に有効化する。

### 混色

`StampBrushConfig.mixing` を指定すると、スタンプブラシは一定距離ごとに描画先レイヤーの色を拾う。

```typescript
const acrylic: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.75 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.12, flow: 0.8 },
  pressureDynamics: { size: 0.3, flow: 0.4 },
  mixing: {
    ...DEFAULT_BRUSH_MIXING,
    enabled: true,
    pickup: 0.35,
    restore: 0.08,
    updateDistancePx: 8,
  },
};
```

混色は平均色を `getImageData` で計算する方式ではない。ブラウザごとの差が大きいピクセル走査を避けるため、初期実装では Canvas2D の `drawImage` / `globalAlpha` / `globalCompositeOperation` で、分岐ごとのブラシ色バッファへ背景 footprint を転写する。

動作:

1. 初回 dab 配置時に `tipCanvas` と同じ最大サイズの `colorBuffer` を分岐ごとに作成し、`style.color` で初期化する
2. 一定距離ごとに描画先 footprint を `pickup` の強さで `colorBuffer` へ転写する
3. 同じ混色更新タイミングで `style.color` を `restore` の強さで `colorBuffer` へ重ね、透明領域へ移動したときに元色へ戻す
4. `colorBuffer` に `tipCanvas` の alpha を適用し、dab として描画する。混色更新を行わない stamp では直近の mixed dab を再利用する

この方式では、大きいブラシが赤/青の境界をまたいだときに tip 全体を単一の紫へ平均化せず、`colorBuffer` 内に赤寄り・青寄りの局所差を保持できる。Expand 使用時は分岐ごとに `colorBuffer` を持つため、分岐ごとに異なる背景色を拾う。混色状態はスタンプごとではなく `mixing.updateDistancePx` を下限とする距離ベースで更新されるため、ブラシサイズに依存せず pickup / restore / mask の頻度を制御できる。実際の更新間隔は `max(stampSpacing, mixing.updateDistancePx)` で、スタンプ配置より高頻度にはならない。

### Spray の描画モデル

spray ブラシは `lineWidth` を散布領域の直径として扱い、`walkEmissions` が発生させる emission ごとに複数の粒子を描画する。粒子チップは `SprayBrushConfig.particle` からストローク開始時に生成し、`BrushRenderState.tipCanvas` として全 emission で共有する。

emission 1回の処理:

1. 散布半径を `R = calculateRadius(pressure, lineWidth, pressureDynamics.size, pressureCurve)` で求める。
2. 基準粒子数 `n0 = density * Math.PI * R * R / 1000` を求める。
3. 筆圧密度係数 `k = lerp(1, evaluateParametricCurve(p, pressureCurve), pressureDynamics.density)` をかけ、`n = n0 * k` とする。
4. `n` の小数部は emission PRNG で確率的に丸める。例えば `12.25` は 25% の確率で 13、75% の確率で 12 になり、パラメータ変化に対して粒子数が滑らかに変化する。
5. 整数化後の粒子数は `SPRAY_MAX_PARTICLES_PER_EMISSION = 512` で上限クランプする。
6. 粒子ごとに半径・角度・粒子径・不透明度を emission PRNG から固定順で決め、`tipCanvas` を `drawImage` する。

半径方向の分布は `radialDistribution` を密度プロファイル `d(x)` として扱う。`x=0` は中央、`x=1` は辺縁、`y` は相対密度。円環面積の重みを含めるため、半径 pdf は次の形になる。

```typescript
pdf(x) ∝ d(x) * x;
const r = R * inverseCdf(u, radialDistribution);
const theta = 2 * Math.PI * v;
```

`inverseCdf` は密度プロファイルを数値積分して正規化し、128 entry の逆CDF LUT から線形補間で求める。LUT はカーブ値をキーにした小さなキャッシュで共有するため、同じ設定では再計算されず、乱数列の決定論性には影響しない。

`DEFAULT_RADIAL_DISTRIBUTION` は全半径で `d(x)=1` の一様密度。これは `F^-1(u)=sqrt(u)` と一致し、円盤内の面積あたり密度が一様になる。全ゼロ密度は描画不能にせず、一様円盤へフォールバックする。

粒子ごとの乱数消費順は固定で、`u`（半径）, `v`（角度）, `sizeU1`, `sizeU2`, `sizeU3`（粒径）, `z`（不透明度）の順に消費する。`sizeJitterMode` が粒径に使う乱数個数に関係なく、粒径用には常に3個消費する。

`sizeJitterMode` は `particleSizeJitter` の分布を切り替える実験的フィールド。最終的には1つの挙動へ固定する予定。

| mode | 粒径 |
|---|---|
| `"uniform"` | `size * (1 - jitter * sizeU1)` |
| `"power"` | `size * (1 - jitter * sizeU1 ** gamma)`、`gamma = lerp(1, 0.4, jitter)` |
| `"lognormal"` | `size * clamp(2 ** (sigma * g), 0.25, 4)`、`sigma = 2 * jitter`, `g = sizeU1 + sizeU2 + sizeU3 - 1.5` |
| `"bimodal"` | 確率 `0.7 * jitter` で `size * lerp(0.2, 0.5, sizeU2)`、それ以外は `size` |

`"lognormal"` は最大4倍の粒子を描けるため、ストローク開始時と replay 時に粒子チップを `particleSize * 4` で生成し、描画時に目的サイズへ縮小する。

spray は mixing 非対応。`SprayBrushConfig` は `mixing` を持たず、pickup 用の `sourceLayer` / `colorBuffer` / `mixedCanvas` を使わない。

### 決定論と Expand

stamp / spray の乱数は emission 序数で決定する。Expand 有効時は branch ごとに独立した実効 seed を使う。

```typescript
const branchSeed = hashSeed(state.seed, branchIndex);
const emissionSeed = hashSeed(branchSeed, emissionIndex);
const rng = mulberry32(emissionSeed);
```

`emissionIndex` は branch ごとに 0 から数える。これにより、branch ごとに jitter / 粒子配置の相関を避けながら、incremental 描画と replay の結果を一致させる。branch ごとに `accumulatedDistance` と `emissionCount` を持つため、非 mixing の stamp / spray でも branch 間で開始 emission と spacing 位相が揃う。

**使用例**:
```typescript
import { renderBrushStroke } from "@yuneco/headless-paint/core";

// round-pen（従来互換）
const state = renderBrushStroke(layer, points, style, overlapCount);

// stamp ブラシ（circle tip）
const initialStampState: BrushRenderState = {
  seed: brushSeed,
  tipCanvas: generateBrushTip(brush.tip, size, color),
  branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
};

// stamp ブラシ（image tip — registry 必須）
const initialImageStampState: BrushRenderState = {
  seed: brushSeed,
  tipCanvas: generateBrushTip(brush.tip, size, color, registry),
  branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
};
const nextState = renderBrushStroke(layer, points, style, 0, initialImageStampState);
// nextState.branches[0] を次の呼び出しに渡す
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
| `size` | `number` | ○ | チップのピクセルサイズ。stamp では最大 dab 径、spray では最大粒子径 |
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

**パイプラインへの受け渡し**: `BrushTipRegistry` は `useStrokeSession` / `usePaintEngine` の config に `registry` として渡す。これにより、ストローク開始時とリプレイ（Undo/Redo）時に image tip の解決が可能になる。

```typescript
import { createBrushTipRegistry } from "@yuneco/headless-paint/core";

const registry = createBrushTipRegistry();

// テクスチャを登録
const bitmap = await createImageBitmap(canvas);
registry.set("my-texture", bitmap);

// usePaintEngine に渡す
const engine = usePaintEngine({ ..., registry });
```

---

## PRNG ユーティリティ

stamp の jitter と spray の粒子配置を決定論的に生成するための疑似乱数関数。

### mulberry32

32bit シードから疑似乱数列を生成する。

```typescript
function mulberry32(seed: number): () => number
```

**引数**: `seed` — 32bit 整数シード
**戻り値**: 呼び出すたびに [0, 1) の疑似乱数を返す関数

### hashSeed

グローバルシードと index から、branch または emission 固有のシードを生成する。

```typescript
function hashSeed(globalSeed: number, index: number): number
```

**引数**:
| 名前 | 型 | 説明 |
|------|-----|------|
| `globalSeed` | `number` | ストロークまたは branch のシード |
| `index` | `number` | branch index または emission index |

**戻り値**: `number` — スタンプ固有の 32bit シード

**設計意図**:
emission 通し番号ベースの PRNG により、incremental 描画（チャンク分割）と replay（一括描画）で同一の jitter / 粒子配置を保証する。累積距離ベースでは Catmull-Rom のチャンク境界クランプにより距離が微小に乖離し、長ストロークで PRNG シードがズレる問題があったため、通し番号を採用した。

**使用例**:
```typescript
// ストローク開始時にグローバルシードを生成
const globalSeed = Math.random() * 0xffffffff | 0;

// 各 emission で通し番号ベースの乱数を生成
const branchSeed = hashSeed(globalSeed, branchIndex);
const localSeed = hashSeed(branchSeed, emissionIndex);
const rng = mulberry32(localSeed);
const opacityVariation = rng() * opacityJitter;
const sizeVariation = rng() * sizeJitter;
```

---

## プリセットブラシ

エクスポートされた標準ブラシプリセット定数。`@yuneco/headless-paint/core` および `@yuneco/headless-paint/react` から import できる。

```typescript
import { ROUND_PEN, AIRBRUSH, SPRAY_AIRBRUSH, PENCIL, MARKER } from "@yuneco/headless-paint/core";
```

```typescript
const AIRBRUSH: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.05, flow: 0.1 },
  pressureDynamics: { size: 0, flow: 1 },
};

const SPRAY_AIRBRUSH: SprayBrushConfig = {
  type: "spray",
  particle: { type: "circle", hardness: 1.0 },
  dynamics: {
    ...DEFAULT_SPRAY_DYNAMICS,
    spacing: 0.1,
    density: 5,
    particleSize: 2,
    particleSizeJitter: 0.35,
    sizeJitterMode: "uniform",
    opacityJitter: 0.3,
    flow: 0.35,
    radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
  },
  pressureDynamics: { size: 0.2, flow: 1, density: 0.5 },
};

const PENCIL: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.95 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.1, sizeJitter: 0.05, scatter: 0.02 },
  pressureDynamics: { size: 1, flow: 0 },
};

const MARKER: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.7 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.15, flow: 0.8 },
  pressureDynamics: { size: 0.2, flow: 0.5 },
};

```

| プリセット | チップ | 特徴 |
|-----------|--------|------|
| AIRBRUSH | ソフト円 (hardness=0.0) | stamp 方式の密間隔・低フロー。滑らかな噴射効果 |
| SPRAY_AIRBRUSH | ハード小粒子 (hardness=1.0) | spray 方式。散布領域内に小粒子を確率配置する粒子感エアブラシ |
| PENCIL | ほぼハード円 (hardness=0.95) | 微小なサイズ・位置のゆらぎ |
| MARKER | やや柔らか (hardness=0.7) | 中間フロー。マーカー的な塗り |

> **Note**: エンジンが提供するプリセットは circle tip のみ。image tip を使うプリセット（鉛筆グレイン、散布ブラシ等）はアプリケーション側で `BrushTipRegistry` にテクスチャを登録して定義する。
