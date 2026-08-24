# 型定義

## Point

2次元座標を表す基本型。

```typescript
interface Point {
  readonly x: number;
  readonly y: number;
}
```

**使用例**:
```typescript
const point: Point = { x: 100, y: 200 };
```

## Color

RGBA色を表す型。各成分は 0-255 の整数値。

```typescript
interface Color {
  readonly r: number;  // 赤 (0-255)
  readonly g: number;  // 緑 (0-255)
  readonly b: number;  // 青 (0-255)
  readonly a: number;  // アルファ (0=透明, 255=不透明)
}
```

**使用例**:
```typescript
const red: Color = { r: 255, g: 0, b: 0, a: 255 };
const semiTransparentBlue: Color = { r: 0, g: 0, b: 255, a: 128 };
```

## StrokePoint

Point を拡張し、筆圧情報を含む型。ペンタブレット入力などで使用。

```typescript
interface StrokePoint extends Point {
  readonly pressure?: number;  // 筆圧 (オプション)
  readonly timestamp?: number; // 入力時刻 ms。時間ベース emission に使用
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `pressure` | `number` | 筆圧。未指定時は描画側で `0.5` として扱う |
| `timestamp` | `number` | 入力時刻 ms。stamp / spray の時間ベース emission（吹きつけ）に使用する。未指定の点列では従来通り距離ベース emission のみ発生する |

**使用例**:
```typescript
const strokePoint: StrokePoint = {
  x: 50,
  y: 50,
  pressure: 0.8,
  timestamp: performance.now(),
};
```

## LayerMeta

レイヤーのメタデータを表す型。

```typescript
interface LayerMeta {
  readonly name: string;        // レイヤー名
  readonly visible: boolean;    // 表示/非表示
  readonly opacity: number;     // 不透明度 (0.0-1.0)
  readonly alphaLocked: boolean; // 通常描画を既存 alpha に制限する
  readonly compositeOperation?: GlobalCompositeOperation;  // 合成モード
}
```

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `name` | `string` | `"Layer"` | レイヤー名 |
| `visible` | `boolean` | `true` | 表示/非表示 |
| `opacity` | `number` | `1` | 不透明度（0.0〜1.0） |
| `alphaLocked` | `boolean` | `false` | 通常描画を既存の非透明領域に制限する。描画後の alpha は描画前と同じになる |
| `compositeOperation` | `GlobalCompositeOperation` | `undefined` | レイヤー合成時の合成モード。`undefined` は `"source-over"`（通常合成）。消しゴムのpendingレイヤープレビューでは `"destination-out"` を設定する |

**alpha lock の動作**:
- `alphaLocked: true` の通常描画は、既存 alpha があるピクセルにだけ反映される。透明領域には新規描画されない。
- 通常描画では既存 alpha を保持し、RGB だけを更新する。
- `compositeOperation: "destination-out"` の消しゴム描画は alpha lock の制約対象外で、従来通り alpha を削る。
- pending レイヤー自体は alpha lock を知らない。live preview は `renderLayers` の pending overlay 合成時に committed レイヤーの alpha を使ってマスクされる。
- alpha lock は `appendToCommittedLayer` による stroke rendering と、その pending preview に適用される。`setPixel` などの低レベル pixel 操作は `LayerMeta` を参照しない。

**使用例**:
```typescript
const meta: LayerMeta = {
  name: "Background",
  visible: true,
  opacity: 0.8,
  alphaLocked: false,
};

// 消しゴムプレビュー用に合成モードを設定
pendingLayer.meta.compositeOperation = "destination-out";
```

## Layer

ペイントレイヤーの本体。すべてのプロパティは readonly。

```typescript
interface Layer {
  readonly id: string;                              // 一意な識別子（createLayer で自動付与）
  readonly width: number;                           // 幅（ピクセル）
  readonly height: number;                          // 高さ（ピクセル）
  readonly canvas: OffscreenCanvas;                 // キャンバス
  readonly ctx: OffscreenCanvasRenderingContext2D;  // 2Dコンテキスト
  readonly meta: LayerMeta;                         // メタデータ
}
```

**注意**: Layer は `createLayer()` 関数で作成する。直接コンストラクトしない。

---

## レイヤー複製・統合時の LayerMeta

`cloneLayer()` は source の `LayerMeta` を複製し、`options.meta` が指定された場合はその値を上書きする。アプリが複製名を採番する場合は `meta.name` を渡す。

`mergeLayerDown()` は source / target の `opacity` と `compositeOperation` を target pixels に焼き込んだ上で、target meta を次の既定値に正規化する。

```typescript
const mergedMeta: LayerMeta = {
  name: target.meta.name,
  visible: target.meta.visible,
  opacity: 1,
  alphaLocked: target.meta.alphaLocked,
  compositeOperation: "source-over",
};
```

`options.resultMeta` が指定された場合は、この既定値に上書き適用する。`visible` は統合対象 pixels を選別しないため、非表示レイヤーの pixel buffer も決定的に統合される。`alphaLocked` は統合後の描画制約として target 側の設定を引き継ぎ、merge 処理自体の pixel burning は gate しない。

---

## PendingOverlay

pending レイヤーのプレ合成情報。`renderLayers` / `composeLayers` に渡すことで、committed + pending の合成を正しく行う。

```typescript
interface PendingOverlay {
  /** pending レイヤー */
  readonly layer: Layer;
  /** グループ化する committed レイヤーの ID */
  readonly targetLayerId: string;
  /** プレ合成用ワークレイヤー（呼び出し側で事前確保） */
  readonly workLayer: Layer;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `layer` | `Layer` | pending（未確定ポイント）の描画レイヤー |
| `targetLayerId` | `string` | プレ合成のグループ化対象となる committed レイヤーの ID |
| `workLayer` | `Layer` | プレ合成用の一時レイヤー。呼び出し側で `createLayer()` により事前確保する |

**プレ合成が必要な条件**（いずれかに該当する場合）:
- レイヤーの `opacity < 1`
- レイヤーの `compositeOperation` が `"source-over"` 以外（ブレンドモード設定時）
- pending の `compositeOperation` が `"source-over"` 以外（消しゴム使用時）
- target レイヤーの `alphaLocked` が `true` かつ pending が通常描画のとき（committed alpha による preview マスク）

上記の条件をすべて満たさない場合（通常ペン描画）はプレ合成がスキップされ、パフォーマンスへの影響はない。

**使用例**:
```typescript
const workLayer = createLayer(width, height, { name: "__work" });
const pendingOverlay: PendingOverlay = {
  layer: pendingLayer,
  targetLayerId: activeLayerId,
  workLayer,
};
renderLayers(layers, ctx, transform, { background, pendingOverlay });
```

---

## ExpandMode

対称展開モードの種類。

```typescript
type ExpandMode = "none" | "axial" | "radial" | "kaleidoscope";
```

| 値 | 説明 |
|---|---|
| `"none"` | 展開なし（1点→1点） |
| `"axial"` | 線対称（軸対称）展開 |
| `"radial"` | 点対称（回転対称）展開 |
| `"kaleidoscope"` | 万華鏡（回転 + 反射）展開 |

---

## ExpandLevel

1レベル分の対称展開設定。

```typescript
interface ExpandLevel {
  readonly mode: ExpandMode;
  readonly offset: Point;     // root: 絶対座標, child: 親からの相対座標
  readonly angle: number;     // root: 座標系回転角度, child: autoAngle に加算される自前角度
  readonly divisions: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `mode` | `ExpandMode` | 展開モード |
| `offset` | `Point` | root: 絶対座標（展開の中心点）、child: 親からの相対座標 |
| `angle` | `number` | root: 座標系の回転角度（ラジアン）、child: auto-angle に加算される自前角度 |
| `divisions` | `number` | 分割数（radial/kaleidoscope で使用、2以上） |

**使用例**:
```typescript
const rootLevel: ExpandLevel = {
  mode: "radial",
  offset: { x: 500, y: 500 },
  angle: 0,
  divisions: 6,
};

const childLevel: ExpandLevel = {
  mode: "kaleidoscope",
  offset: { x: 0, y: -80 },
  angle: 0,
  divisions: 4,
};
```

---

## ExpandConfig

多段対称展開の設定。levels 配列の各要素が1段の展開を定義する。

```typescript
interface ExpandConfig {
  readonly levels: readonly ExpandLevel[];
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `levels` | `readonly ExpandLevel[]` | 展開レベルの配列。1要素で従来の単一レベル展開と同等 |

**使用例**:
```typescript
// 単一レベル
const config: ExpandConfig = {
  levels: [
    { mode: "radial", offset: { x: 500, y: 500 }, angle: 0, divisions: 6 },
  ],
};

// 多段展開
const multiConfig: ExpandConfig = {
  levels: [
    { mode: "radial", offset: { x: 400, y: 300 }, angle: 0, divisions: 3 },
    { mode: "kaleidoscope", offset: { x: 0, y: -80 }, angle: 0, divisions: 4 },
  ],
};
```

---

## CompiledExpand

コンパイル済み展開設定。`compileExpand()` で生成。

```typescript
interface CompiledExpand {
  readonly config: ExpandConfig;
  readonly matrices: readonly Float32Array[];
  readonly outputCount: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `config` | `ExpandConfig` | 元の設定 |
| `matrices` | `readonly Float32Array[]` | 事前計算された変換行列（mat3形式） |
| `outputCount` | `number` | 1入力あたりの出力数 |

---

## BackgroundSettings

背景色の設定。ピクセルデータを持たず、色と表示/非表示のみを管理する。

```typescript
interface BackgroundSettings {
  readonly color: Color;   // 背景色
  readonly visible: boolean; // 表示/非表示
}
```

**使用例**:
```typescript
const bg: BackgroundSettings = {
  color: { r: 255, g: 255, b: 255, a: 255 },
  visible: true,
};
```

**関連定数**:

```typescript
const DEFAULT_BACKGROUND_COLOR: Color = { r: 255, g: 255, b: 255, a: 255 };
```

---

## ParametricCurve / PressureCurve

入力値(0-1)→出力値(0-1)のマッピングを制御する cubic-bezier カーブの制御点。筆圧変換で使う。

```typescript
interface ParametricCurve {
  readonly y1: number;  // 第1制御点のy座標 (0-1)
  readonly y2: number;  // 第2制御点のy座標 (0-1)
}

type PressureCurve = ParametricCurve;
```

端点 `(0,0)→(1,1)` は固定。制御点の x 座標は `1/3`, `2/3` で固定され、y 座標のみ調整可能。

| フィールド | 型 | 説明 |
|---|---|---|
| `y1` | `number` | 第1制御点のy座標（0-1） |
| `y2` | `number` | 第2制御点のy座標（0-1） |

**関連定数**:

```typescript
const DEFAULT_PRESSURE_CURVE: PressureCurve = { y1: 1/3, y2: 2/3 };
```

デフォルト値 `{ y1: 1/3, y2: 2/3 }` は数学的に線形（output = input）。

`PressureCurve` は筆圧用途を示すためのエイリアスとして残る。評価関数は用途に依存しない `evaluateParametricCurve(value, curve)` を使い、旧 `applyPressureCurve` 名の互換エイリアスは持たない。

**カーブの例**:
- `{ y1: 1/3, y2: 2/3 }` — 線形（デフォルト）
- `{ y1: 1, y2: 1 }` — 柔らかい（軽いタッチでも太くなる）
- `{ y1: 0, y2: 1/3 }` — 硬い（強く押さないと太くならない）

---

## DensityProfileCurve

spray ブラシの半径方向密度プロファイル。x は `0=中央`, `1=辺縁`、y は相対密度を表す。端点の x は固定で、端点 y と2つの制御点を持つ cubic-bezier カーブ。

```typescript
interface DensityProfileCurve {
  readonly startY: number;
  readonly control1: Point;
  readonly control2: Point;
  readonly endY: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `startY` | `number` | 中央（x=0）の相対密度 |
| `control1` | `Point` | 第1制御点。`x`/`y` ともに 0-1 |
| `control2` | `Point` | 第2制御点。`x`/`y` ともに 0-1 |
| `endY` | `number` | 辺縁（x=1）の相対密度 |

**関連定数**:

```typescript
const DEFAULT_RADIAL_DISTRIBUTION: DensityProfileCurve = {
  startY: 1,
  control1: { x: 1 / 3, y: 1 },
  control2: { x: 2 / 3, y: 1 },
  endY: 1,
};
```

デフォルトは全半径で密度 `1` の一様密度カーブ。一様密度では半径サンプリングが一様円盤分布と一致する。

---

## StrokeStyle

ストローク描画のスタイル設定。

```typescript
interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureCurve: PressureCurve;
  readonly compositeOperation: GlobalCompositeOperation;
  readonly brush: BrushConfig;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `color` | `Color` | 描画色 |
| `lineWidth` | `number` | 線の基準太さ |
| `pressureCurve` | `PressureCurve` | 筆圧カーブ（`DEFAULT_PRESSURE_CURVE` で線形） |
| `compositeOperation` | `GlobalCompositeOperation` | Canvas合成モード。通常は `"source-over"`。消しゴムでは `"destination-out"` を指定 |
| `brush` | `BrushConfig` | ブラシ設定。筆圧をサイズ/flowへどう反映するかは `brush.pressureDynamics` で指定 |

全フィールドが required。暗黙のデフォルト値に依存せず、常に明示的に指定する。

**筆圧カーブの動作**:
- `brush.pressureDynamics` の計算前に入力筆圧をカーブで変換する
- `DEFAULT_PRESSURE_CURVE`（`{ y1: 1/3, y2: 2/3 }`）は線形（変換なし相当）

**合成モードの動作**:
- `"source-over"`: 通常の加算描画
- `"destination-out"`: 消しゴムモード（描画した箇所を透明にする）
- その他の `GlobalCompositeOperation` 値も将来的にサポート可能

---

## PressureDynamics

筆圧をブラシの動的パラメータへ反映する強さ。ブラシごとに設定する。

```typescript
interface PressureDynamics {
  readonly size: number;
  readonly flow: number;
  readonly smoothingMs?: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `size` | `number` | 筆圧を描画サイズへ反映する強さ。`0` は均一サイズ、`1` は筆圧比例 |
| `flow` | `number` | 筆圧をスタンプブラシの flow へ反映する強さ。`0` は均一 flow、`1` は筆圧比例 |
| `smoothingMs` | `number` | stampでsize / flowへ反映する前の因果的な筆圧平滑化時定数（ms）。省略または`0`以下で無効 |

**関連定数**:

```typescript
const DEFAULT_PRESSURE_DYNAMICS: PressureDynamics = {
  size: 1,
  flow: 0,
};
```

**動作**:

- `size` は `round-pen` と `stamp` の両方で使う
- `flow` は `stamp` のみで使う。`round-pen` では型として値を保持しても描画には反映しない
- `0〜1` の中間値は、均一値と筆圧比例値の線形補間
- 入力筆圧が `undefined` の場合は `0.5` を使う
- `pressureCurve` がある場合は、`size` と `flow` の両方に同じ変換済み筆圧を使う
- `stamp`の`smoothingMs`は未来点を待たず、emission timestampと分岐状態だけで筆圧を平滑化する。入力座標や生の筆圧記録は変更しない

**設計意図**:

`pressureSensitivity` はサイズ専用のグローバル設定だった。`PressureDynamics` はブラシごとの設定として、鉛筆は `size`、エアブラシは `flow`、アクリルは両方、という使い分けを可能にする。

---

## BrushTipConfig

チップ形状の設定。判別共用体。

```typescript
/** 手続き的円形チップ（hardness でエッジの柔らかさ制御） */
interface CircleTipConfig {
  readonly type: "circle";
  readonly hardness: number;
}

/** 画像ベースチップ（imageId で BrushTipRegistry から解決） */
interface ImageTipConfig {
  readonly type: "image";
  readonly imageId: string;
}

type BrushTipConfig = CircleTipConfig | ImageTipConfig;
```

**CircleTipConfig**:

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"circle"` | チップ種別 |
| `hardness` | `number` | エッジの硬さ（0.0=ガウシアンフォールオフ、1.0=ハード円） |

**ImageTipConfig**:

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"image"` | チップ種別 |
| `imageId` | `string` | BrushTipRegistry に登録された画像の識別子 |

**使用例**:
```typescript
const softCircle: CircleTipConfig = { type: "circle", hardness: 0.0 };
const hardCircle: CircleTipConfig = { type: "circle", hardness: 1.0 };
const imageTip: ImageTipConfig = { type: "image", imageId: "pastel-grain" };
```

---

## BrushDynamics

スタンプブラシの動的パラメータ。スタンプごとの変動を制御する。

```typescript
interface BrushDynamics {
  readonly spacing: number;
  readonly spacingSizeCoupling: number;
  readonly opacityJitter: number;
  readonly sizeJitter: number;
  readonly rotationJitter: number;
  readonly scatter: number;
  readonly flow: number;
  readonly emissionsPerSecond?: number;
}
```

`emissionsPerSecond` 以外は required。`DEFAULT_BRUSH_DYNAMICS` からの spread で差分のみ指定できる。

| フィールド | 型 | 説明 |
|---|---|---|
| `spacing` | `number` | ブラシ直径に対するスタンプ間隔の比率（0.25 = 直径の25%間隔） |
| `spacingSizeCoupling` | `number` | 距離spacingを筆圧反映後のtip径へ追従させる割合。`0`は基準lineWidth固定、`1`は実効tip径へ完全追従 |
| `opacityJitter` | `number` | 不透明度のランダム変動 [0, 1] |
| `sizeJitter` | `number` | サイズのランダム変動 [0, 1] |
| `rotationJitter` | `number` | 回転のランダム変動 [0, PI] ラジアン |
| `scatter` | `number` | 散布距離（直径比率） |
| `flow` | `number` | 1スタンプあたりの塗料量 [0, 1] |
| `emissionsPerSecond` | `number` | 時間ベース emission のレート。正の有限数で吹きつけ有効、未指定または `0` 以下でOFF（従来の距離ベースのみ）。`round-pen` では使わない |

**関連定数**:

```typescript
const DEFAULT_BRUSH_DYNAMICS: BrushDynamics = {
  spacing: 0.25,
  spacingSizeCoupling: 0,
  opacityJitter: 0,
  sizeJitter: 0,
  rotationJitter: 0,
  scatter: 0,
  flow: 1.0,
};
```

**使用例**:
```typescript
// エアブラシ的な設定（密間隔・低フロー）
const airbrushDynamics: BrushDynamics = {
  ...DEFAULT_BRUSH_DYNAMICS,
  spacing: 0.05,
  flow: 0.1,
  emissionsPerSecond: 30,
};

// パステル的な設定（散布・回転あり）
const pastelDynamics: BrushDynamics = {
  ...DEFAULT_BRUSH_DYNAMICS,
  spacing: 0.2,
  rotationJitter: Math.PI,
  scatter: 0.1,
  opacityJitter: 0.2,
};
```

---

## SprayDynamics

spray ブラシの動的パラメータ。`lineWidth` は散布領域の直径を表し、粒子径は `particleSize` で独立に指定する。

```typescript
interface SprayDynamics {
  readonly spacing: number;
  readonly density: number;
  readonly particleSize: number;
  readonly particleSizeJitter: number;
  readonly sizeJitterMode: SpraySizeJitterMode;
  readonly opacityJitter: number;
  readonly flow: number;
  readonly radialDistribution: DensityProfileCurve;
  readonly emissionsPerSecond?: number;
}

type SpraySizeJitterMode = "lognormal" | "bimodal";
```

`emissionsPerSecond` 以外は required。`DEFAULT_SPRAY_DYNAMICS` からの spread で差分のみ指定できる。

| フィールド | 型 | 説明 |
|---|---|---|
| `spacing` | `number` | 散布直径に対する emission 間隔の比率（0.1 = 直径の10%間隔） |
| `density` | `number` | 基準粒子密度。emission 1回あたり、1000px² に配置する粒子数 |
| `particleSize` | `number` | 粒子チップの最大径 px。散布径とは独立した絶対値 |
| `particleSizeJitter` | `number` | 粒子径の縮小方向ランダム変動 [0, 1] |
| `sizeJitterMode` | `SpraySizeJitterMode` | 粒子径ジッタの分布モード。対数正規近似または二峰分布を選択する |
| `opacityJitter` | `number` | 粒子不透明度の縮小方向ランダム変動 [0, 1] |
| `flow` | `number` | 粒子ごとの基準塗料量 [0, 1] |
| `radialDistribution` | `DensityProfileCurve` | 半径方向の密度プロファイル。x は中央→辺縁、y は相対密度 |
| `emissionsPerSecond` | `number` | 時間ベース emission のレート。正の有限数で吹きつけ有効、未指定または `0` 以下でOFF（従来の距離ベースのみ） |

**関連定数**:

```typescript
const SPRAY_MAX_PARTICLES_PER_EMISSION = 512;

const DEFAULT_SPRAY_DYNAMICS: SprayDynamics = {
  spacing: 0.1,
  density: 5,
  particleSize: 2,
  particleSizeJitter: 0,
  sizeJitterMode: "bimodal",
  opacityJitter: 0,
  flow: 0.35,
  radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
};
```

**描画上の意味**:
- emission 1回の基準粒子数は `density * Math.PI * R * R / 1000` で、散布半径 `R` の面積に比例する。
- `radialDistribution` は相対密度 `d(x)` として評価され、半径 pdf は `pdf(x) ∝ d(x) * x` になる。デフォルトの一様密度では一様円盤、中央高・辺縁低のカーブでは中心が厚くなる。
- `sizeJitterMode` は `particleSizeJitter` の乱数分布を切り替えるフィールド。`lognormal` は 0.25-4 倍の対数正規近似、`bimodal` は基準粒と微小粒の二峰分布。
- 1 emission あたりの粒子数は `SPRAY_MAX_PARTICLES_PER_EMISSION` で上限クランプされる。
- `emissionsPerSecond` が正の有限数なら、入力座標が静止していても `timestamp` の進行に応じて emission が発生する。

---

## SprayPressureDynamics

筆圧を spray ブラシの動的パラメータへ反映する強さ。`PressureDynamics` に density 軸を加えた spray 専用型。

```typescript
interface SprayPressureDynamics {
  readonly size: number;
  readonly flow: number;
  readonly density: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `size` | `number` | 筆圧を散布径へ反映する強さ。`0` は均一サイズ、`1` は筆圧比例 |
| `flow` | `number` | 筆圧を粒子不透明度へ反映する強さ。`0` は均一 flow、`1` は筆圧比例 |
| `density` | `number` | 筆圧を粒子密度へ反映する強さ。`0` は均一密度、`1` は筆圧比例 |

**関連定数**:

```typescript
const DEFAULT_SPRAY_PRESSURE_DYNAMICS: SprayPressureDynamics = {
  size: 1,
  flow: 0,
  density: 0,
};
```

`density` のデフォルトは `0`。`DEFAULT_PRESSURE_DYNAMICS.flow` と同じく、標準設定では均一値を保ち、筆圧連動が必要なプリセット側で明示的に有効化する。

---

## BrushConfig

ブラシの設定。判別共用体でブラシ種別を切り替える。

```typescript
/** 現在の circle+trapezoid 方式（デフォルト） */
interface RoundPenBrushConfig {
  readonly type: "round-pen";
  readonly pressureDynamics: PressureDynamics;
}

/** スタンプベースブラシ（汎用拡張型） */
interface StampBrushConfig {
  readonly type: "stamp";
  readonly tip: BrushTipConfig;
  readonly dynamics: BrushDynamics;
  readonly pressureDynamics: PressureDynamics;
  readonly mixing?: BrushMixing;
}

/** 散布ブラシ。lineWidth は散布領域の直径を意味する */
interface SprayBrushConfig {
  readonly type: "spray";
  readonly particle: BrushTipConfig;
  readonly dynamics: SprayDynamics;
  readonly pressureDynamics: SprayPressureDynamics;
}

interface BristleSurfaceGrain {
  readonly scalePx: number;
  readonly amount: number;
  readonly hardness: number;
  readonly seed: number;
}

interface BristleDynamics {
  readonly bristleCount: number;
  readonly bristleFill: number;
  readonly bristleWidthVariation: number;
  readonly bristleSpacingVariation: number;
  readonly geometryStepPx: number;
  readonly transverseMaskCellPx: number;
  readonly dropoutLengthPx: number;
  readonly dropoutWidthPx: number;
  readonly depositHardness: number;
  readonly edgeTextureAmount: number;
  readonly edgeTextureLengthPx: number;
  readonly cuspAngleThresholdDeg: number;
  readonly cuspDetectionSpanRatio: number;
  readonly lagLengthRatio: number;
  readonly surfaceGrain: BristleSurfaceGrain;
}

interface BristlePressureDynamics {
  readonly coverage: number;
}

interface BristleBrushConfig {
  readonly type: "bristle";
  readonly dynamics: BristleDynamics;
  readonly pressureDynamics: BristlePressureDynamics;
  readonly mixing?: BrushMixing;
}

type BrushConfig =
  | RoundPenBrushConfig
  | StampBrushConfig
  | SprayBrushConfig
  | BristleBrushConfig;
```

**StampBrushConfig**:

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"stamp"` | ブラシ種別 |
| `tip` | `BrushTipConfig` | チップ形状の設定 |
| `dynamics` | `BrushDynamics` | 動的パラメータ |
| `pressureDynamics` | `PressureDynamics` | 筆圧をサイズ/flowへ反映する強さ |
| `mixing` | `BrushMixing` | 混色設定。未指定または `enabled: false` で混色なし |

**SprayBrushConfig**:

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"spray"` | ブラシ種別 |
| `particle` | `BrushTipConfig` | 粒子チップ形状の設定。`circle` / `image` を stamp と同じ仕組みで解決する |
| `dynamics` | `SprayDynamics` | 散布間隔・密度・粒子径・半径方向分布などの動的パラメータ |
| `pressureDynamics` | `SprayPressureDynamics` | 筆圧を散布径/flow/密度へ反映する強さ |

spray ブラシは混色非対応。`mixing` フィールドは持たず、pickup 経路を通らない。

**BristleBrushConfig**:

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"bristle"` | 連続掃引する荒いハケ方式 |
| `dynamics` | `BristleDynamics` | 毛束断面、面掠れ、紙目、折返し追従の設定 |
| `pressureDynamics` | `BristlePressureDynamics` | 筆圧を着彩率へ反映する強さ。ブラシ幅は変えない |
| `mixing` | `BrushMixing` | 任意の共通連続色場。毛束ごとの色reservoirではない |

`bristleCount` は概念上の細い毛束数、`bristleFill` は平均毛束幅、2つのvariationは幅と配置の不均一さを表す。`geometryStepPx` は曲線を掃引する間隔でありstamp間隔ではない。`transverseMaskCellPx`、`dropoutLengthPx`、`dropoutWidthPx` は毛束数から独立した面掠れ場の解像度と相関長を定める。既定の`transverseMaskCellPx: 0.82`はLab COMBの横断mask解像度（約0.82px/cell）と一致する。

`depositHardness` と `edgeTexture*` は着彩/無着彩境界を定める。面掠れは符号付きpaint fieldのまま
swept quadへ補間し、最終pixelでalphaへ変換する。これにより低筆圧時にも薄いalphaを全面へ
積まず、不透明な着彩片の面積だけを減らす。`surfaceGrain` はdocument座標へ固定した
Fine tooth（細かな紙目）を表す。接触判定はswept quad内のpixel-local pressureと紙目の高さを使い、
描画chunkの平均筆圧には丸めない。初回に接触しなかった谷にも固定の再接触transferを適用するため、
同じ場所を繰り返すと不透明な着彩片の面積が徐々に増える。専用の反復強度パラメータや
顔料厚layerは持たない。`cusp*` と `lagLengthRatio` は急な折返しで毛束の横断方向が不自然に回転するのを抑える。

初期版は不透明またはほぼ不透明なpaintを対象とする。掃引chunk間の重なりはこの契約の下で継ぎ目を防ぐために使い、半透明paintの厳密な重なり濃度は保証しない。pending描画は常にno-opで、確定描画だけを表示する。

```typescript
const DEFAULT_BRISTLE_DYNAMICS: BristleDynamics = {
  bristleCount: 57,
  bristleFill: 1.8,
  bristleWidthVariation: 0.62,
  bristleSpacingVariation: 0.72,
  geometryStepPx: 1,
  transverseMaskCellPx: 0.82,
  dropoutLengthPx: 58,
  dropoutWidthPx: 1,
  depositHardness: 1,
  edgeTextureAmount: 0.12,
  edgeTextureLengthPx: 7,
  cuspAngleThresholdDeg: 65,
  cuspDetectionSpanRatio: 0.14,
  lagLengthRatio: 0.3,
  surfaceGrain: { scalePx: 4, amount: 1, hardness: 0.75, seed: 1 },
};

const DEFAULT_BRISTLE_PRESSURE_DYNAMICS: BristlePressureDynamics = {
  coverage: 1,
};
```

**RoundPenBrushConfig**:

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"round-pen"` | ブラシ種別 |
| `pressureDynamics` | `PressureDynamics` | `size` のみ描画に使う。`flow` は無視される |

`round-pen` は連続パス描画（circle + trapezoid fill）のため、スタンプごとの flow という概念を持たない。UIでは `round-pen` 選択時に `pressureDynamics.flow` を表示しない。

### BrushMixing

stamp / bristleで共有する混色設定。一定距離ごとに描画先レイヤーのfootprintを進行方向へ揃えたbrush-local連続RGBA色場へ取り込み、元の描画色への復元と色場内拡散を制御する。

```typescript
interface BrushMixing {
  readonly enabled: boolean;
  readonly pickupRatePerPx: number;
  readonly restoreRatePerPx: number;
  readonly diffusionRatePerPx: number;
  readonly updateDistancePx: number;
  readonly checkpointDistancePx: number;
  readonly fieldColumns: number;
  readonly fieldRows: number;
}

const BRUSH_MIXING_MIN_FIELD_DIMENSION = 2;
const BRUSH_MIXING_MAX_FIELD_DIMENSION = 64;
const BRUSH_MIXING_MAX_CHECKPOINT_DISTANCE_PX = 256;
```

| フィールド | 型 | 説明 |
|---|---|---|
| `enabled` | `boolean` | 混色を有効にする |
| `pickupRatePerPx` | `number` | 下地色を拾う距離rate。距離dの係数は`1-exp(-rate*d)` |
| `restoreRatePerPx` | `number` | 元の描画色へ戻す距離rate。距離dの係数は`1-exp(-rate*d)` |
| `diffusionRatePerPx` | `number` | 色場内の隣接拡散pass量 / px |
| `updateDistancePx` | `number` | 色場を更新する最小移動距離 |
| `checkpointDistancePx` | `number` | 描画済みtargetから局所sampling tileを更新する距離 |
| `fieldColumns` | `number` | tip-local色場の進行方向解像度 |
| `fieldRows` | `number` | tip-local色場の横断方向解像度 |

ratesは0以上、距離は正の有限数、field解像度は2〜64の整数、checkpoint距離は256px以下を有効範囲とする。永続化境界では範囲外を暗黙に丸めずrejectする。`pickupRatePerPx <= 0`ではstroke中に色場が元色から変化しないため、restore / diffusionの値にかかわらず混色stage全体をno-opとする。

**関連定数**:

```typescript
const DEFAULT_BRUSH_MIXING: BrushMixing = {
  enabled: false,
  pickupRatePerPx: 0.007,
  restoreRatePerPx: 0.004,
  diffusionRatePerPx: 0.05,
  updateDistancePx: 15,
  checkpointDistancePx: 36,
  fieldColumns: 18,
  fieldRows: 8,
};
```

**関連定数**:

```typescript
const ROUND_PEN: RoundPenBrushConfig = {
  type: "round-pen",
  pressureDynamics: DEFAULT_PRESSURE_DYNAMICS,
};

const AIRBRUSH: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.05,
    flow: 0.1,
    emissionsPerSecond: 30,
  },
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
    sizeJitterMode: "bimodal",
    opacityJitter: 0.3,
    flow: 0.35,
    radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
    emissionsPerSecond: 30,
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

| 定数 | チップ | 特徴 |
|------|--------|------|
| `ROUND_PEN` | — | 従来の circle+trapezoid 方式（デフォルト） |
| `AIRBRUSH` | ソフト円 (hardness=0.0) | 密間隔・低フロー。`emissionsPerSecond: 30` で静止中も噴射する |
| `SPRAY_AIRBRUSH` | ハード小粒子 (hardness=1.0) | `emissionsPerSecond: 30` で静止中も小粒子を確率配置する粒子感エアブラシ |
| `PENCIL` | ほぼハード円 (hardness=0.95) | 微小なサイズ・位置のゆらぎ |
| `MARKER` | やや柔らか (hardness=0.7) | 中間フロー。マーカー的な塗り |

**使用例**:
```typescript
// エアブラシ
const airbrush: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.05,
    flow: 0.1,
    emissionsPerSecond: 30,
  },
  pressureDynamics: { size: 0, flow: 1 },
};

// 粒子感エアブラシ
const sprayAirbrush: SprayBrushConfig = {
  type: "spray",
  particle: { type: "circle", hardness: 1.0 },
  dynamics: {
    ...DEFAULT_SPRAY_DYNAMICS,
    density: 5,
    particleSize: 2,
    particleSizeJitter: 0.35,
    sizeJitterMode: "bimodal",
    opacityJitter: 0.3,
    flow: 0.35,
    emissionsPerSecond: 30,
  },
  pressureDynamics: { size: 0.2, flow: 1, density: 0.5 },
};

// 鉛筆
const pencil: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.95 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.1, sizeJitter: 0.05, scatter: 0.02 },
  pressureDynamics: { size: 1, flow: 0 },
};

// round-pen
const style: StrokeStyle = {
  color: { r: 0, g: 0, b: 0, a: 255 },
  lineWidth: 8,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  compositeOperation: "source-over",
  brush: ROUND_PEN,
};
```

---

## ContentBounds

レイヤー内容の非透明ピクセル境界矩形。`getContentBounds()` が返す。

```typescript
interface ContentBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `x` | `number` | 境界矩形の左端 x 座標 |
| `y` | `number` | 境界矩形の上端 y 座標 |
| `width` | `number` | 境界矩形の幅 |
| `height` | `number` | 境界矩形の高さ |

**使用例**:
```typescript
const bounds = getContentBounds(layer);
if (bounds) {
  console.log(`Content at (${bounds.x}, ${bounds.y}), size ${bounds.width}x${bounds.height}`);
}
```

---

## LayerTransformPreview

レイヤー変換プレビュー。`PendingOverlay` と同様の一時的レンダリング状態。`renderLayers` の `RenderOptions` 経由で渡す。

```typescript
interface LayerTransformPreview {
  readonly layerId: string;
  readonly matrix: Float32Array;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `layerId` | `string` | 変換対象のレイヤー ID |
| `matrix` | `Float32Array` | 適用するアフィン変換行列（gl-matrix の `mat3` と互換） |

**使用例**:
```typescript
import { renderLayers } from "@yuneco/headless-paint/core";

renderLayers(layers, ctx, transform, {
  layerTransformPreview: { layerId: "layer_1", matrix: translationMatrix },
});
```

---

## BrushRenderState

ブラシレンダリングの状態。committed→pending 間の状態受け渡しに使用する。ストローク共有リソースと、Expand 分岐ごとの進行状態を分けて保持する。

```typescript
interface BrushMixingState {
  readonly field: Float32Array;
  readonly fieldCanvas: OffscreenCanvas;
  readonly fieldPixels: ImageData;
  readonly renderCanvas: OffscreenCanvas;
  readonly checkpointCanvas?: OffscreenCanvas;
  readonly checkpointPixels?: ImageData;
  readonly checkpointOriginX?: number;
  readonly checkpointOriginY?: number;
  readonly lastUpdateDistance?: number;
  readonly lastCheckpointDistance?: number;
}

interface BrushBranchRenderState {
  readonly accumulatedDistance: number;
  readonly emissionCount: number;
  readonly distanceEmissionProgress?: number;
  readonly lastTimestamp?: number;
  readonly nextTimeEmissionAt?: number;
  readonly pressure?: BrushPressureState;
  readonly mixing?: BrushMixingState;
  readonly bristle?: BristleBranchRenderState;
}

interface BrushPressureState {
  readonly value: number;
  readonly timestamp: number;
}

interface BrushRenderState {
  readonly seed: number;
  readonly tipCanvas: OffscreenCanvas | null;
  readonly branches: readonly BrushBranchRenderState[];
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `seed` | `number` | PRNG のグローバルシード。ストロークごとに一意。Undo/Redo で同一結果を保証するため `StrokeCommand.brushSeed` に保存される |
| `tipCanvas` | `OffscreenCanvas \| null` | 事前生成されたチップ画像。stamp では dab、spray では粒子チップとして全 emission で再利用する。bristleは内部の決定的profile cacheを使うため`null` |
| `branches` | `readonly BrushBranchRenderState[]` | Expand 分岐ごとの状態。非 Expand でも長さ 1 の配列を持つ |

**BrushBranchRenderState**:

| フィールド | 型 | 説明 |
|---|---|---|
| `accumulatedDistance` | `number` | 分岐ごとの emission 配置累積距離。committed→pending 間で引き継ぎ、ギャップや二重配置を防ぐ |
| `emissionCount` | `number` | 分岐ごとの emission 通し番号。stamp の dab と spray の粒子バーストで共通に使う |
| `distanceEmissionProgress` | `number` | 可変spacing時の次回距離emissionまでの正規化進捗（0以上1未満）。未使用時は省略 |
| `lastTimestamp` | `number` | 時間ベース emission で、この分岐が最後に処理した入力時刻。overlap 再入力区間で二重配置しないために使う |
| `nextTimeEmissionAt` | `number` | 時間ベース emission で、次に emission を配置する予定時刻 |
| `pressure` | `BrushPressureState` | stampの因果的な筆圧平滑化状態。有効時のみ保持する |
| `mixing` | `BrushMixingState` | stamp / bristle + mixing 有効時のみ保持する混色状態 |
| `bristle` | `BristleBranchRenderState` | bristleの直前掃引断面、進入方向、折返し時の短い毛束lagを保持する状態 |

**BrushMixingState**:

| フィールド | 型 | 説明 |
|---|---|---|
| `field` | `Float32Array` | 連続RGBA色場の正本。更新ごとに新しい配列を返す |
| `fieldCanvas` / `fieldPixels` | Canvas / ImageData | 小さな数値色場をCanvasへuploadするbranch所有cache |
| `renderCanvas` | `OffscreenCanvas` | 色場をtip alphaでmaskした再利用可能なdab source |
| `checkpointCanvas` | `OffscreenCanvas` | 描画済みtargetから切り出した有限範囲のsampling tile |
| `checkpointPixels` | `ImageData` | checkpoint更新時に一度だけreadbackしたCPU sampling source |
| `checkpointOriginX/Y` | `number` | checkpoint tileのdocument座標原点 |
| `lastUpdateDistance` | `number` | 最後に色場を更新したstroke距離 |
| `lastCheckpointDistance` | `number` | 最後にcheckpoint tileを更新したstroke距離 |

**設計意図**:

- `branches` は常に存在し、Expand の出力 branch 数と一致する。非 Expand は長さ 1。
- branch ごとに独立した `accumulatedDistance` / `emissionCount` / `distanceEmissionProgress` / `lastTimestamp` / `nextTimeEmissionAt` を持つため、stamp / spray とも branch 間で spacing 位相と時間 emission の位相が揃う。
- branch の実効 seed は `hashSeed(seed, branchIndex)` で導出する。emission 序数は branch ごとに 0 から数え、各 emission の局所 seed は `hashSeed(branchSeed, emissionIndex)` で導出する。
- 時間ベース emission も距離ベース emission と同じ `emissionCount` を消費するため、incremental 描画と replay で PRNG 列が一致する。
- 混色有効時はExpand分岐ごとに拾う背景が異なるため、`mixing`に分岐別の色場と有限checkpointを保持する。stampとbristleは同じ色場モデルを使い、sprayは混色非対応。
- `field`は更新ごとに新しい配列を返す数値状態。Canvas / ImageDataはbranch所有のmutable cacheであり、分岐・pendingへ共有せず`cloneBrushRenderState`でdeep cloneする。進行方向付きの18×8 samplingは`checkpointPixels`からCPUで行い、WebKitのGPU→CPU同期をmaterial更新ごとに発生させない。
- bristleの面掠れは毛束ごとの絵の具reservoirではない。初回接触で未着彩と判定されたcellへ半透明の着彩floorは加えない。面掠れで着彩可能と判定された領域では、document-space grainの谷に確率的な再接触を与え、同じ場所への反復で不透明な着彩片の面積を段階的に増やす。追加のpigment layerは持たない。

**使用例**:
```typescript
// ストローク開始時に初期状態を作成
const initialState: BrushRenderState = {
  seed: Math.random() * 0xffffffff | 0,
  tipCanvas: generateBrushTip(brush.tip, size, color),
  branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
};

// committed 描画後に状態を引き継ぎ
const nextState = renderBrushStroke(layer, points, style, 0, initialState);
// nextState.branches[branchIndex] を pending 描画に使う
```
