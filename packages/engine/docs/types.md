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
const point: Point = { x: 100, y: 200 };
```

## Color

RGBA色を表す型。各成分は 0-255 の整数値。

```typescript
interface Color {
  r: number;  // 赤 (0-255)
  g: number;  // 緑 (0-255)
  b: number;  // 青 (0-255)
  a: number;  // アルファ (0=透明, 255=不透明)
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
  pressure?: number;  // 筆圧 (オプション)
}
```

**使用例**:
```typescript
const strokePoint: StrokePoint = { x: 50, y: 50, pressure: 0.8 };
```

## LayerMeta

レイヤーのメタデータを表す型。

```typescript
interface LayerMeta {
  name: string;      // レイヤー名
  visible: boolean;  // 表示/非表示
  opacity: number;   // 不透明度 (0.0-1.0)
  compositeOperation?: GlobalCompositeOperation;  // 合成モード
}
```

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `name` | `string` | `"Layer"` | レイヤー名 |
| `visible` | `boolean` | `true` | 表示/非表示 |
| `opacity` | `number` | `1` | 不透明度（0.0〜1.0） |
| `compositeOperation` | `GlobalCompositeOperation` | `undefined` | レイヤー合成時の合成モード。`undefined` は `"source-over"`（通常合成）。消しゴムのpendingレイヤープレビューでは `"destination-out"` を設定する |

**使用例**:
```typescript
const meta: LayerMeta = {
  name: "Background",
  visible: true,
  opacity: 0.8,
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

## PressureCurve

入力筆圧(0-1)→出力筆圧(0-1)のマッピングを制御する cubic-bezier カーブの制御点。

```typescript
interface PressureCurve {
  readonly y1: number;  // 第1制御点のy座標 (0-1)
  readonly y2: number;  // 第2制御点のy座標 (0-1)
}
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

**カーブの例**:
- `{ y1: 1/3, y2: 2/3 }` — 線形（デフォルト）
- `{ y1: 1, y2: 1 }` — 柔らかい（軽いタッチでも太くなる）
- `{ y1: 0, y2: 1/3 }` — 硬い（強く押さないと太くならない）

---

## StrokeStyle

ストローク描画のスタイル設定。

```typescript
interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity: number;
  readonly pressureCurve: PressureCurve;
  readonly compositeOperation: GlobalCompositeOperation;
  readonly brush: BrushConfig;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `color` | `Color` | 描画色 |
| `lineWidth` | `number` | 線の基準太さ |
| `pressureSensitivity` | `number` | 筆圧感度（0.0=均一太さ、1.0=最大感度） |
| `pressureCurve` | `PressureCurve` | 筆圧カーブ（`DEFAULT_PRESSURE_CURVE` で線形） |
| `compositeOperation` | `GlobalCompositeOperation` | Canvas合成モード。通常は `"source-over"`。消しゴムでは `"destination-out"` を指定 |
| `brush` | `BrushConfig` | ブラシ設定。`{ type: "round-pen" }` で従来の circle+trapezoid 方式 |

全フィールドが required。暗黙のデフォルト値に依存せず、常に明示的に指定する。

**筆圧感度の動作**:
- `0`: 全ポイントが `lineWidth` で均一描画
- `1`: 筆圧に完全比例（`lineWidth * pressure` が直径）
- `0〜1`: 均一太さと筆圧太さの線形補間

**筆圧カーブの動作**:
- 筆圧感度の計算前に入力筆圧をカーブで変換する
- `DEFAULT_PRESSURE_CURVE`（`{ y1: 1/3, y2: 2/3 }`）は線形（変換なし相当）

**合成モードの動作**:
- `"source-over"`: 通常の加算描画
- `"destination-out"`: 消しゴムモード（描画した箇所を透明にする）
- その他の `GlobalCompositeOperation` 値も将来的にサポート可能

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
  readonly opacityJitter: number;
  readonly sizeJitter: number;
  readonly rotationJitter: number;
  readonly scatter: number;
  readonly flow: number;
}
```

全フィールドが required。`DEFAULT_BRUSH_DYNAMICS` からの spread で差分のみ指定できる。

| フィールド | 型 | 説明 |
|---|---|---|
| `spacing` | `number` | ブラシ直径に対するスタンプ間隔の比率（0.25 = 直径の25%間隔） |
| `opacityJitter` | `number` | 不透明度のランダム変動 [0, 1] |
| `sizeJitter` | `number` | サイズのランダム変動 [0, 1] |
| `rotationJitter` | `number` | 回転のランダム変動 [0, PI] ラジアン |
| `scatter` | `number` | 散布距離（直径比率） |
| `flow` | `number` | 1スタンプあたりの塗料量 [0, 1] |

**関連定数**:

```typescript
const DEFAULT_BRUSH_DYNAMICS: BrushDynamics = {
  spacing: 0.25,
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

## BrushConfig

ブラシの設定。判別共用体でブラシ種別を切り替える。

```typescript
/** 現在の circle+trapezoid 方式（デフォルト） */
interface RoundPenBrushConfig {
  readonly type: "round-pen";
}

/** スタンプベースブラシ（汎用拡張型） */
interface StampBrushConfig {
  readonly type: "stamp";
  readonly tip: BrushTipConfig;
  readonly dynamics: BrushDynamics;
}

type BrushConfig = RoundPenBrushConfig | StampBrushConfig;
```

**StampBrushConfig**:

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"stamp"` | ブラシ種別 |
| `tip` | `BrushTipConfig` | チップ形状の設定 |
| `dynamics` | `BrushDynamics` | 動的パラメータ |

**関連定数**:

```typescript
const ROUND_PEN: RoundPenBrushConfig = { type: "round-pen" };

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
```

| 定数 | チップ | 特徴 |
|------|--------|------|
| `ROUND_PEN` | — | 従来の circle+trapezoid 方式（デフォルト） |
| `AIRBRUSH` | ソフト円 (hardness=0.0) | 密間隔・低フロー。滑らかな噴射効果 |
| `PENCIL` | ほぼハード円 (hardness=0.95) | 微小なサイズ・位置のゆらぎ |
| `MARKER` | やや柔らか (hardness=0.7) | 中間フロー。マーカー的な塗り |

**使用例**:
```typescript
// エアブラシ
const airbrush: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.0 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.05, flow: 0.1 },
};

// 鉛筆
const pencil: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.95 },
  dynamics: { ...DEFAULT_BRUSH_DYNAMICS, spacing: 0.1, sizeJitter: 0.05, scatter: 0.02 },
};

// round-pen
const style: StrokeStyle = {
  color: { r: 0, g: 0, b: 0, a: 255 },
  lineWidth: 8,
  pressureSensitivity: 0,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  compositeOperation: "source-over",
  brush: ROUND_PEN,
};
```

---

## BrushRenderState

ブラシレンダリングの状態。committed→pending 間の状態受け渡しに使用する。

```typescript
interface BrushRenderState {
  readonly accumulatedDistance: number;
  readonly tipCanvas: OffscreenCanvas | null;
  readonly seed: number;
  readonly stampCount: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `accumulatedDistance` | `number` | スタンプ配置の累積距離。committed→pending 間で引き継ぎ、ギャップや二重配置を防ぐ |
| `tipCanvas` | `OffscreenCanvas \| null` | 事前生成されたチップ画像。ストローク開始時に生成し全スタンプで再利用する。`round-pen` では `null` |
| `seed` | `number` | PRNG のグローバルシード。ストロークごとに一意。Undo/Redo で同一結果を保証するため `StrokeCommand.brushSeed` に保存される |
| `stampCount` | `number` | 配置済みスタンプの通し番号。PRNG シードの入力に使用し、incremental/replay で同一の jitter を保証する |

**設計意図**: スタンプブラシの jitter はスタンプ通し番号ベース PRNG `hashSeed(seed, stampIndex)` で決定論的に生成される。通し番号は `accumulatedDistance` より安定しており、incremental 描画（チャンク分割）と replay（一括描画）で同一の jitter パターンを保証する。

**使用例**:
```typescript
// ストローク開始時に初期状態を作成
const initialState: BrushRenderState = {
  accumulatedDistance: 0,
  tipCanvas: generateBrushTip(brush.tip, size, color),
  seed: Math.random() * 0xffffffff | 0,
  stampCount: 0,
};

// committed 描画後に状態を引き継ぎ
const nextState = renderBrushStroke(layer, points, style, 0, initialState);
// nextState.accumulatedDistance, nextState.stampCount を pending 描画に使う
```
