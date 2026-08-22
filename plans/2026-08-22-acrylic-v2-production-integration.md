# Acrylic v2 / Rough bristle production integration

## Status

- Implementation branch: `feature/acrylic-v2-production`
- Production base: `main@47e6db4`
- Lab reference: `experiment/acrylic-lab@4f5a1cd`
- Sensory result: Simple acrylic / MIX、Rough bristle / COMB、Organic sponge / TEXはいずれも候補として合格
- Production priority: Acrylic v2とRough bristleを先行し、Organic spongeは後回し

この計画はLabの比較実装を移植する計画ではない。Labで選んだ表現だけを、productionの`input → stroke → engine → react/web`境界へ再設計して組み込む。

## Product decision

### Ship scope

1. 現行Acrylic presetをAcrylic v2へ置換する
2. Rough bristleを新しいbrush type / presetとして追加する
3. 混色を使う既存brushはすべて新しいbrush-local color field方式へ揃える
4. Acrylic以外の既存非混色brushと共存し、既存挙動を意図せず変更しない
5. 最終官能評価はBrush Labではなく既存の`apps/web`デモへ統合した状態でまとめて行う

### Compatibility policy

- 旧混色rendererを残さない。runtimeに新旧分岐を作らない
- 旧Acrylicの履歴を以前と同じbitmapへreplayする互換性は保証しない
- 古いcommandは、通常の必須property補完で新型へ正規化できる場合だけ読み込む
- 意味保存のための専用legacy conversionは作らない。安全に補完できなければ明示的な読込エラーにする
- 新しいcommand、Undo / Redo、保存後replayの決定性は保証する
- Round pen、非混色Stamp、Spray、Expand、Alpha lockの回帰は防ぐ

## Non-goals

- 旧Acrylicのpixel parity
- 複数mixing backendを製品設定として公開すること
- Surface pull / canvas smear
- 有限paint reservoir、impasto、照明、厳密な流体・毛束物理
- 汎用node editor、任意のSpeed mapping
- Organic spongeの同時出荷
- Rough bristleの半透明paint対応。初期版は不透明またはほぼ不透明なpaintを契約とする

## Package boundaries

### `input`

- DOMやbrushを知らない正規化済み入力を扱う
- pressure / timestampを欠落させない
- 今回はtiltを必須にしない
- Causal filterを追加する場合も、material stateやbrush typeを参照しない汎用filterとして実装する

### `stroke`

- raw `InputPoint`、filter設定、style、seedをcommandへ保存する
- committed / pending ownershipとincremental lifecycleを管理する
- brush固有の色場・毛束・紙目計算を持たない
- stateful brushへbounded workを渡すscheduler契約は持てるが、brush内部stateの解釈はengineへ委譲する

### `engine`

- emission位相、mixing material state、brush geometry、Canvas合成を所有する
- 新しいmixingはStamp / Rough bristleが共有できるmaterial stageとする
- tip-local color fieldを毛束単位の色reservoirにしない。連続色面を生成した後にtip alpha / bristle maskを適用する
- surface grainはdocument resourceとして扱い、layerごとの顔料厚stateにしない

### `react` / `web`

- persistence境界で必須propertyをvalidate / default補完する
- brush presetとUIを公開する
- WebKit/iPadの官能・性能metricをproduction経路で評価できるようにする
- Lab専用algorithmや比較variantをimportしない

## Production API design

### Size-aware spacing

`BrushDynamics`へ次を追加する。

```ts
readonly spacingSizeCoupling: number;
```

- `0`: base line width基準。既存の離散Stamp / Scatter向け
- `1`: pressure適用後のeffective sizeへ完全追従。Acrylicなどcontinuous stamp向け
- 中間値は式の連続性のため許可するが、初期UIで公開しない
- schedulerは可変px間隔の丸めではなく、`∫ ds / localSpacing(s)`の無次元phaseをbranch stateへ保持する
- 最小spacingと1回のwalk当たりemission上限を設け、低pressureでの発散を防ぐ
- time emissionとdistance emissionは単一の`emissionIndex`順序を維持する

既存presetは`0`を補完する。Acrylic v2は`1`を使う。Pencilへの適用は回帰fixtureを通した後に別判断とし、今回のAcrylic置換へ抱き合わせない。

### Single mixing model

`BrushMixing`は新方式だけを表す。`model` discriminatorは持たない。

```ts
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
```

rateは更新1回あたりではなく距離あたりの指数rateとして定義する。距離`d`の適用係数は原則`1 - exp(-rate * d)`とし、`updateDistancePx`を性能調整しても見た目の強さをできるだけ維持する。

選択した方式:

1. brush-localの小さな連続RGB色場を持つ
2. 現在位置へ保持色をdepositする
3. 前回の確定Pickup checkpointから下地色を取得する
4. Pickup / Restore / Diffusionで次位置用の色場を更新する
5. 一定距離で確定済み描画を次checkpoint sourceへ反映する

同じdabを即座に再pickupしない。接触より前方へ色を漏らさない。Surface pullは行わない。

CPU fieldとDownsampled Canvasをproductionへ併存させない。実装途中では比較可能にしてよいが、WebKit/iPad gateで一方式を選び、公開APIへbackend選択を残さない。

### Mixing state ownership

`BrushBranchRenderState`のmixing stateは、小さなnumeric field、material更新距離、checkpoint source参照だけを持つ。旧`colorBuffer` / `mixedCanvas`とpending clone cacheは削除する。

混色presetはCausal input + pending OFFを標準とする。形状pendingとmaterial rollbackを同じ単位にしない。engine APIへpendingが渡された場合の契約は、stateを汚さない明示的no-opまたは軽量copyのどちらか一つに固定し、UIだけに依存した安全性にしない。

### Rough bristle

`BrushConfig`へ新しいdiscriminated union memberを追加する。

```ts
interface BristleBrushConfig {
  readonly type: "bristle";
  readonly dynamics: BristleDynamics;
  readonly pressureDynamics: BristlePressureDynamics;
  readonly mixing?: BrushMixing;
}
```

初期production rendererはLabの次の採用部分だけを再構成する。

- swept continuous bristle geometry
- coarse broad dropout mask
- document-space surface grain
- cusp split + short bristle lag
- packed repeated contact
- internal pending OFF
- bounded incremental work

per-bristle stamp、legacy per-hit software trial、比較variantは持ち込まない。開始側2px source-over overlapも一般解として移植せず、不透明paint契約の範囲でseam-safe ownershipまたはmax coverageを選ぶ。

## Implementation phases

### P0 — Contract and regression fixtures

- package docsへ新APIとownershipを先に記述する
- 現行Round pen / Stamp / Spray / Acrylicの固定fixtureを追加する
- live / replay / incremental / Expandの比較方法を固定する
- persistenceの破壊的変更方針とerror behaviorをテスト化する

Gate: APIの利用例をコードへ写せる具体性があり、旧rendererを残す必要がない。

### P1 — Size-aware emission

- schedulerをlocal spacing callbackまたはnormalized phase対応へ拡張する
- branch stateへspacing phaseを保存する
- pressure補間、incremental境界、time emission、PRNG indexをテストする
- 既存brush既定値はbase-size spacingのまま維持する

Gate: Acrylicの低pressureが点描化せず、既存非対象brush fixtureが変化しない。

### P2 — Single color-field mixer and Acrylic v2

- 新しいmaterial moduleを純粋なnumeric field更新とCanvas adapterへ分ける
- distance-normalized Pickup / Restore / Diffusionを実装する
- bounded Pickup checkpoint sourceを実装する
- Stamp rendererを共通material stageへ接続する
- 旧mixing.ts、旧Canvas color buffer、pending clone cacheを削除する
- Acrylic presetとBrushPanelを新設定へ更新する
- persistenceを新しい必須propertyへ更新する

初期官能値はLabの`Pickup 0.10 / Restore 0.06 / update 15px / checkpoint 30–40px`を距離rateへ変換した値から始める。確定presetはweb統合後に調整する。

Gate: 方向性、反復pickup、速度差、live/replay、長時間WebKit安定性を通す。

### P3 — Rough bristle renderer

- Bristle config / state / dispatcherを追加する
- continuous geometry、broad mask、surface resource、repeated contactを段階実装する
- mixing color fieldをgeometry前段へ接続する
- bounded scheduler / backlogをproduction stroke runtimeへ統合する
- Rough bristle presetを追加する

Gate: Lab referenceに対する構造的な官能一致、incremental/replay parity、iPad 30fps gate、backlog有限化。

### P4 — Web integration and combined sensory gate

- 既存`apps/web`のBrushPanelとpreset選択へAcrylic v2 / Rough bristleを組み込む
- 通常canvas、layer、zoom、Undo / Redo、保存読込をそのまま使って試せる状態にする
- debug-only metricは折り畳み表示にし、通常操作を妨げない
- Acrylic境界・spot・往復、Rough高速往復・交差・急折返しを同じアプリで確認できる補助sceneだけ追加する

Gate: ユーザーがwebデモだけでまとめて官能評価できる。

### P5 — Production validation and cleanup

- `pnpm -r build`
- `pnpm test`
- `pnpm lint`
- Playwright WebKit固定replay
- iPad Safariで長時間stroke、描画直後UI応答、memory / tab crashを確認
- 100 / 50 / 25% zoom、通常 / 高速、document / screen-fixed相当を確認
- Lab由来の未使用比較コード・backend・compatibility branchがproductionにないことを監査する

Gate: API、保守性、module boundary、dependency direction、docs、determinism、回帰がセルフレビューで説明可能。

## Performance and quality metrics

### Acrylic v2

- sustained Wall p50 / p95、early / late p95
- material update / checkpoint copy回数
- 描画直後UI応答
- live / replay bitmap差
- 方向反転時の色引き対称性
- 同一stroke往復時の原色再導入の有無

### Rough bristle

- Wall p50 / p95、16.7 / 33.3ms超過率
- document-space commit距離
- backlog p95 / max
- pointer-up drain
- Core / Surface / Repeat内訳
- incremental / full replay coverage差
- chunk seam、内周の弦、掠れ線分断

ローカルWebKitは16.7msを第一目標、iPadは33.3ms以内を出荷gate、16.7msを理想値とする。25% zoom高速操作は処理時間だけでなくPencil直下からpaintまでの距離を必ず見る。

## Self-review checklist

- public typeが実装都合のCanvas backendを露出していないか
- `input` / `stroke`がbrush内部modelを知っていないか
- state ownershipとcopy / mutation箇所が明示されているか
- incremental / replay / Expandで同じseed、phase、checkpoint順序になるか
- `updateDistancePx`変更で官能parameterが変質しないか
- 旧mixing runtime、旧pending clone、不要なcompatibility branchが残っていないか
- 非混色brushの既定値とfixtureが変わっていないか
- persistenceが補完不能な不正設定を黙って別挙動へ丸めていないか
- WebKitの非同期GPU負荷をJS計時だけで合格にしていないか

## Commit strategy

各phaseを独立commitにする。各commitには対応docs、テスト、判明した制約を含める。実験branchの巨大なLab commitはmerge / cherry-pickしない。
