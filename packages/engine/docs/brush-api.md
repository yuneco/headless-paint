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
  ├── "spray"     → renderSprayBrushStroke（散布方式）
  └── "bristle"   → renderBristleBrushStroke（連続掃引する荒いハケ方式）
```

### チップ生成の責務分離

チップ画像の生成は呼び出し側（`useStrokeSession` 等）の責務。`renderBrushStroke` は事前生成された `tipCanvas` を `BrushRenderState` 経由で受け取る。stamp では dab の元画像、spray では粒子チップとして使う。混色有効時は低解像度のtip-local色場を拡大し、`tipCanvas` をalpha maskとして適用する。

### モジュール構成

ブラシ実装は `packages/engine/src/brush/` 配下に分割される。

| ファイル | 責務 |
|---|---|
| `index.ts` | `renderBrushStroke` の dispatch と公開 re-export |
| `prng.ts` | `mulberry32` / `hashSeed` |
| `scheduler.ts` | 距離ベース + 時間ベース emission 走査（stamp / spray 共有） |
| `state.ts` | `BrushRenderState` の生成・branch 分解・merge・pending クローン |
| `tip.ts` | `generateBrushTip` / `BrushTipRegistry` |
| `stamp.ts` | stamp 描画（`walkEmissions` + dab 配置） |
| `material-field.ts` | 距離正規化したPickup / Restore / Diffusionの純粋な数値計算 |
| `mixing.ts` | 色場のCanvas転送、進行方向付きsampling、有限checkpoint tile |
| `spray.ts` | spray 描画（`walkEmissions` + 粒子バースト） |
| `bristle-profile.ts` | seedから決定的な1D毛束断面atlasを生成する純粋計算とcache |
| `bristle-mask.ts` | stroke-spaceの符号付き面掠れ場をswept quadへsoftware rasterizeし、document-space紙目と局所maskへ解決する |
| `bristle.ts` | 連続掃引、cusp split、短い毛束lag、混色stage、局所合成 |

`@yuneco/headless-paint/core` からの公開名は `brush/index.ts` 経由で提供する。公開対象は `renderBrushStroke`、`isBrushMixingActive`、`generateBrushTip`、`createBrushTipRegistry`、`mulberry32`、`hashSeed`、`walkEmissions`、`timeSpacingMsFromRate` と、ブラシ関連型・プリセット定数。

---

## isBrushMixingActive

```typescript
function isBrushMixingActive(mixing: BrushMixing | undefined): boolean
```

`enabled`だけでなく、色場が実際に下地を取得できる設定かを含めて混色stageの有効性を判定する。
`mixing`が未指定、`enabled: false`、または`pickupRatePerPx <= 0`なら`false`を返す。engine外の
stroke runtimeもこの関数を使い、snapshot作成とpending抑止の条件をrenderer本体と一致させる。

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
  accelerator?: BrushAccelerator | null,
): BrushRenderState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 描画先レイヤー |
| `points` | `readonly StrokePoint[]` | ○ | 描画ポイント列（展開済みの単一ストローク） |
| `style` | `StrokeStyle` | ○ | 描画スタイル（`brush` フィールドでブラシ種別を判定） |
| `overlapCount` | `number` | - | 先頭のオーバーラップ点数。`round-pen` では `drawVariableWidthPath` にパススルー。`stamp` では `interpolateStrokePoints` に渡され、overlap 区間は Catmull-Rom の文脈点として使われるが出力からは除外される |
| `state` | `BrushRenderState` | - | ブラシレンダリング状態。`stamp` / `spray` / `bristle` の共通scheduler位相、混色状態、bristleの直前断面と短いlag stateをbranchごとに保持する。`round-pen` では無視される |
| `sourceLayer` | `Layer` | 条件付き | stamp / bristleの混色有効時は必須。`layer`と異なるstroke-start snapshotを渡す。非混色では省略可 |
| `accelerator` | `BrushAccelerator \| null` | - | GPU加速器（[gpu-acceleration.md](./gpu-acceleration.md)）。省略 / `null` はCPU経路。混色stampの適格条件を満たす場合のみGPU経路になり、GPU経路の結果はCPU経路と原則一致する。同一backend内では決定的で、CPU/GPU間の許容差は [gpu-acceleration.md](./gpu-acceleration.md) を参照 |

**戻り値**: `BrushRenderState` — 更新されたレンダリング状態。`stamp` / `spray` では対象 branch の `accumulatedDistance` と `emissionCount` が更新される。`round-pen` では `{ seed: 0, tipCanvas: null, branches: [{ accumulatedDistance: 0, emissionCount: 0 }] }` を返す。

**動作**:
1. `style.brush.type` を判定
2. `"round-pen"`: `drawVariableWidthPath` を呼び出し（従来方式）
3. `"stamp"`: スタンプ方式で描画:
   - ポイント列を Catmull-Rom 補間
   - branch の `accumulatedDistance` と時間 state から、距離 + 時間 emission を発生順に走査

混色有効時に`sourceLayer`がない、または`layer.canvas`と同一の場合は例外にする。現在dabをsampling sourceへ再帰的に混ぜる曖昧な低レベル呼び出しは補完しない。通常のstroke実行経路は開始時にsnapshotを作成して渡す。

`pickupRatePerPx <= 0`は混色stage全体を無効化する。色場はstroke開始時に元色一色で初期化され、stroke間へ保持されないため、下地を取得しない状態でrestore / diffusionだけを実行しても出力は変化しない。`pickup = 0`ではsampling、色場upload、checkpoint、混色用の描画区間分割を行わない。
   - 各スタンプ位置で `tipCanvas` を `drawImage` で配置
   - `brush.pressureDynamics.size` でスタンプサイズを決める
   - `brush.dynamics.spacingSizeCoupling` が正の場合、距離spacingを筆圧反映後のtip径へ追従させる
   - `brush.pressureDynamics.flow` でスタンプごとの flow を筆圧変化させる
   - 混色有効時は、保持色を現在dabへ先にdepositし、確定checkpointから進行方向付きで下地を取得して次位置用の色場を更新する
   - jitter パラメータは emission 通し番号ベース PRNG で決定
   - `brush.dynamics.emissionsPerSecond` が正の有限数なら、`StrokePoint.timestamp` の進行に応じて静止中も emission を追加する
4. `"spray"`: 散布方式で描画:
   - ポイント列を Catmull-Rom 補間
   - branch の `accumulatedDistance` と時間 state から、距離 + 時間 emission を発生順に走査
   - 各 emission で散布領域内に複数の粒子を確率配置する
   - `brush.pressureDynamics.size` で散布径、`flow` で粒子不透明度、`density` で粒子数を筆圧変化させる
   - `brush.dynamics.emissionsPerSecond` が正の有限数なら、`StrokePoint.timestamp` の進行に応じて静止中も粒子バーストを追加する
5. `"bristle"`: 荒いハケ方式で描画:
   - Catmull-Rom補間後の中心線を`geometryStepPx`間隔で走査し、seed固定の1D毛束断面を連続quadへ掃引する
   - 毛束数とは独立したstroke-spaceの面掠れ（dropout mask）を合成する。CPU/GPUともにquad内で距離・横断位置・筆圧を線形補間し、各pixelで `broad value noise(distance / dropoutLengthPx, crossPx / dropoutWidthPx) − threshold` を評価する。threshold は `0.5 + (0.5 − effectivePressure) × 0.9`（低筆圧係数 0.9 は内部定数）、effectivePressure は `pressureDynamics.coverage` で筆圧を 0.5 へ寄せた値。符号付き距離を `depositHardness` で最終pixelのalphaへ変換し、重複quadは`max(alpha)`で結合する。筆圧はブラシ幅ではなく着彩率へ作用する。GPU経路（[gpu-acceleration.md](./gpu-acceleration.md)）も同じ式をshader内で評価する
   - document座標へ固定したsurface grain（紙目）を面掠れと同じsoftware rasterへ統合し、pixel-local pressureで接触を判定する
   - 急な折返しはcuspとして分割し、短いbristle lag（毛束の遅れ）で横断方向を追従させる
   - 同じ場所への反復接触は、紙目の谷に対する確率的な再接触として不透明な着彩片の面積を段階的に増やす。初回の未着彩cellへ半透明の着彩floorは加えず、顔料厚レイヤーも追加しない
   - 混色時は共通の連続色場を毛束断面全体へ適用してからalpha maskを掛ける。毛束単位へ色を固定しない
   - pendingはengine境界でno-opとし、確定済みchunkだけを表示する

面掠れを先に8-bit alpha atlasへ変換して区間ごとにCanvas合成してはならない。線形補間で生じた薄いalphaが区間境界の`source-over`で蓄積し、低筆圧部が「疎な不透明片」ではなく「薄い全面着彩」へ変わるためである。bristle rendererは全canvasを再生せず、新しく確定した中心線の周辺だけを局所canvasへ描いて合成する。chunk境界には不透明paint向けの小さな重なりを持たせる。半透明paintでは重なり濃度が見える可能性があるため、初期versionの対象外とする。

---

## walkEmissions

Catmull-Rom 補間済み点列を距離 spacing と任意の時間 spacing で走査し、stamp の dab と spray の粒子バーストに共通する emission 位置を列挙する。

```typescript
interface EmissionPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number | undefined;
  readonly timestamp: number | undefined;
  readonly directionX: number;
  readonly directionY: number;
  readonly distance: number;
  readonly emissionIndex: number;
}

function walkEmissions(
  interpolated: readonly StrokePoint[],
  spacingPx: number,
  startState: {
    readonly accumulatedDistance: number;
    readonly emissionCount: number;
    readonly distanceEmissionProgress?: number;
    readonly lastTimestamp?: number;
    readonly nextTimeEmissionAt?: number;
  },
  overlapCount: number,
  emit: (point: EmissionPoint) => void,
  timeSpacingMs?: number,
  spacingAt?: (point: StrokePoint) => number,
): {
  readonly accumulatedDistance: number;
  readonly emissionCount: number;
  readonly distanceEmissionProgress?: number;
  readonly lastTimestamp?: number;
  readonly nextTimeEmissionAt?: number;
}
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `interpolated` | `readonly StrokePoint[]` | ○ | `interpolateStrokePoints` 済みの点列 |
| `spacingPx` | `number` | ○ | emission 間隔 px |
| `startState` | `{ accumulatedDistance, emissionCount, distanceEmissionProgress?, lastTimestamp?, nextTimeEmissionAt? }` | ○ | branch ごとの開始状態。可変spacing時は正規化進捗、時間ベース emission 有効時は最後に処理した時刻と次回予定時刻も含む |
| `overlapCount` | `number` | ○ | 先頭のオーバーラップ点数。ストローク開始 emission と spacing 位相を既存差分描画に合わせる |
| `emit` | `(point: EmissionPoint) => void` | ○ | emission ごとに呼ばれる callback |
| `timeSpacingMs` | `number` | - | 時間ベース emission の間隔 ms。未指定または `0` 以下の場合は距離ベースのみ |
| `spacingAt` | `(point: StrokePoint) => number` | - | 各点の局所spacing px。指定時はspacing密度を積分し、`distanceEmissionProgress`で差分描画間の位相を保持する |

**戻り値**: 更新後の branch state。固定spacingでは`accumulatedDistance`、可変spacingでは`distanceEmissionProgress`を次回チャンクの距離emission位相に使う。`emissionCount` は次回 emission の序数、`lastTimestamp` / `nextTimeEmissionAt` は時間ベース emission の位相に使う。

**設計意図**:
- emission は scheduler が発生させる描画単位。stamp では dab 1個、spray では散布領域1回分の粒子バーストを意味する。
- ストローク開始 emission（`distance=0`）と `nextStampDist` 相当の位相計算は `walkEmissions` に集約する。
- 距離 emission と時間 emission は、同一セグメント内の発生位置順に merge される。両方とも両端の `timestamp` を位置比率で補間して保持する。時間 emission の位置は時刻比率から求め、同じ比率で座標・筆圧を補間する。
- 両方が同じ位置で発生可能な場合は距離 emission を先に処理し、次に時間 emission を処理する。どちらも単一の `emissionIndex` / `emissionCount` 空間を消費する。
- `timeSpacingMs` が有効でも、点列に `timestamp` がない、片側だけ欠落している、または timestamp が非単調なセグメントでは時間 emission を発生させない。距離 emission は従来通り発生する。
- `lastTimestamp` 以前の overlap 再入力区間は時間 emission の対象外にし、committed→pending 境界や incremental 再描画で二重配置しない。
- engine は現在時刻を読まない。時間 emission は `StrokePoint.timestamp` と branch state だけで決まる。
- 可変spacingは局所spacingの逆数（1pxあたりのemission進捗）を点間で積分する。これにより筆圧でtipが細くなっても点線化しにくく、incremental / replayで位相が一致する。局所spacingは安全上0.5pxを下限とし、1回の`walkEmissions`で実描画callbackを4096回までに制限する。

### timeSpacingMsFromRate

`BrushDynamics.emissionsPerSecond` / `SprayDynamics.emissionsPerSecond` を `walkEmissions` に渡す時間間隔へ変換する。

```typescript
function timeSpacingMsFromRate(
  emissionsPerSecond: number | undefined,
): number | undefined
```

| 引数 | 説明 |
|---|---|
| `emissionsPerSecond` | 1秒あたりの時間ベース emission 数。正の有限数のみ有効 |

**戻り値**: `1000 / emissionsPerSecond`。未指定、非有限値、`0` 以下は `undefined` を返し、吹きつけOFFを表す。

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
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.05,
    flow: 0.1,
    emissionsPerSecond: 30,
  },
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

`stamp`では`pressureDynamics.smoothingMs`を指定すると、入力点を失わずにsize / flowへ使う筆圧だけを過去情報で平滑化する。省略または`0`以下では無効。状態はExpand分岐ごとに保持し、incrementalとreplayで同じ結果になる。

### 混色

`StampBrushConfig.mixing` または `BristleBrushConfig.mixing` を指定すると、ブラシは一定距離ごとに描画先レイヤーの色を拾う。両方式は同じbrush-local連続RGBA色場を共有し、bristleでも毛束ごとに色を固定しない。

```typescript
const acrylic: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.75 },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.12,
    spacingSizeCoupling: 1,
    flow: 0.8,
  },
  pressureDynamics: { size: 0.3, flow: 0.4, smoothingMs: 50 },
  mixing: {
    ...DEFAULT_BRUSH_MIXING,
    enabled: true,
    pickupRatePerPx: 0.007,
    restoreRatePerPx: 0.004,
    diffusionRatePerPx: 0.05,
    updateDistancePx: 15,
    checkpointDistancePx: 36,
    fieldColumns: 18,
    fieldRows: 8,
  },
};
```

動作:

1. `fieldColumns × fieldRows`の連続RGBA色場を`style.color`で初期化する
2. 保持中の色場へtip alphaを適用し、現在dabを先にdepositする
3. `updateDistancePx`ごとに、前回の確定checkpoint pixelsをCPU上で進行方向へ回転して小さな色場へsampleする
4. 距離`d`に対し`1 - exp(-rate * d)`でPickup / Restoreを適用し、`diffusionRatePerPx * d` passだけ隣接色を拡散する
5. `checkpointDistancePx`ごとに、描画済みtargetの局所tileだけを次のsampling sourceとして更新する

現在dabをsampleより先にdepositするため、接触前方へ色が漏れない。checkpoint更新はdeposit後だが、そのcheckpointを使うのは次のmaterial更新からであり、同じdabを即座に再pickupしない。最初のmaterial更新だけは`updateDistancePx`を接触距離として使い、stroke開始直後のpickupを初期化する。tileは最大tip footprintとcheckpoint距離を覆う有限サイズで、全レイヤーを距離ごとにコピーしない。Expandでは分岐ごとに色場とcheckpointを持つ。時間emissionで距離が進まない間はmaterial更新しない。

GPU→CPUの`getImageData`はcheckpoint更新時の有限tileに限定する。その間の色場更新はcached pixelsからCPU samplingし、18×8のreadbackを毎回発生させない。`putImageData`は低解像度色場のtip転写時だけ使う。mutableなtip全体をdabごとに更新する旧方式は残さない。WebKitではJS計時だけでなく長時間stroke後のUI応答と実機安定性を別途確認する。

### Spray の描画モデル

spray ブラシは `lineWidth` を散布領域の直径として扱い、`walkEmissions` が発生させる emission ごとに複数の粒子を描画する。粒子チップは `SprayBrushConfig.particle` からストローク開始時に生成し、`BrushRenderState.tipCanvas` として全 emission で共有する。`SprayDynamics.emissionsPerSecond` が正の有限数なら、入力座標が止まっていても `StrokePoint.timestamp` の進行に応じて emission が発生する。

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

`sizeJitterMode` は `particleSizeJitter` の分布を切り替えるフィールド。粒径のばらつきを対数正規近似または二峰分布から選択する。

| mode | 粒径 |
|---|---|
| `"lognormal"` | `size * clamp(2 ** (sigma * g), 0.25, 4)`、`sigma = 2 * jitter`, `g = sizeU1 + sizeU2 + sizeU3 - 1.5` |
| `"bimodal"` | 確率 `0.7 * jitter` で `size * lerp(0.2, 0.5, sizeU2)`、それ以外は `size` |

`"lognormal"` は最大4倍の粒子を描けるため、ストローク開始時と replay 時に粒子チップを `particleSize * 4` で生成し、描画時に目的サイズへ縮小する。

spray は mixing 非対応。`SprayBrushConfig` は `mixing` を持たず、stroke-start `sourceLayer`やtip-local色場を参照しない。

### 決定論と Expand

stamp / spray の乱数は emission 序数で決定する。Expand 有効時は branch ごとに独立した実効 seed を使う。

```typescript
const branchSeed = hashSeed(state.seed, branchIndex);
const emissionSeed = hashSeed(branchSeed, emissionIndex);
const rng = mulberry32(emissionSeed);
```

`emissionIndex` は branch ごとに 0 から数える。距離 emission と時間 emission は同じ `emissionIndex` 空間を消費するため、時間ベース emission が混ざっても incremental 描画と replay の PRNG 列が一致する。branch ごとに `accumulatedDistance` / `emissionCount` / `lastTimestamp` / `nextTimeEmissionAt` を持つため、非 mixing の stamp / spray でも branch 間で開始 emission、spacing 位相、時間 emission 位相が揃う。

Expand 有効時は `expandStrokePoints` が各分岐へ `timestamp` をそのまま渡す。各分岐の時間 state は独立して進むため、同じ入力時刻列から展開された branch でも emission の二重配置防止と PRNG 消費は branch 単位で完結する。

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

| プリセット | チップ | 特徴 |
|-----------|--------|------|
| AIRBRUSH | ソフト円 (hardness=0.0) | stamp 方式の密間隔・低フロー。`emissionsPerSecond: 30` で静止中も噴射する |
| SPRAY_AIRBRUSH | ハード小粒子 (hardness=1.0) | spray 方式。`emissionsPerSecond: 30` で静止中も小粒子を確率配置する粒子感エアブラシ |
| PENCIL | ほぼハード円 (hardness=0.95) | 微小なサイズ・位置のゆらぎ |
| MARKER | やや柔らか (hardness=0.7) | 中間フロー。マーカー的な塗り |

> **Note**: エンジンが提供するプリセットは circle tip のみ。image tip を使うプリセット（鉛筆グレイン、散布ブラシ等）はアプリケーション側で `BrushTipRegistry` にテクスチャを登録して定義する。
