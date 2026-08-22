# Acrylic v2 / Rough bristle production integration

## Status

- Implementation branch: `feature/acrylic-v2-production`
- Production base: `main@47e6db4`
- Lab reference: `experiment/acrylic-lab@4f5a1cd`
- Sensory result: Simple acrylic / MIX、Rough bristle / COMB、Organic sponge / TEXはいずれも候補として合格
- Production priority: Acrylic v2とRough bristleを先行し、Organic spongeは後回し
- Progress: P0〜P4実装・ローカル検収完了。P5のiPad実機総合官能gate待ち（2026-08-22）

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

`BrushBranchRenderState`のmixing stateは、小さなnumeric field、material更新距離、描画済みtargetから切り出す有限checkpoint tileだけを持つ。tileは最大tip footprintと次checkpointまでの移動距離を覆い、距離ごとの全canvas copyを行わない。旧`colorBuffer` / `mixedCanvas`とpending clone cacheは削除する。

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

公開する`BristleDynamics`は、毛束断面（count / fill / width variation / spacing variation）、連続掃引間隔、毛束数から独立した面掠れの横断cellと縦横相関長、境界hardness / texture、cusp検出 / lag、document-space grainに限定する。筆圧は`BristlePressureDynamics.coverage`で着彩率だけへ作用し、幅を変えない。初期版は不透明またはほぼ不透明なpaintだけを契約とし、半透明chunk overlapの厳密性は対象外とする。

初期production rendererはLabの次の採用部分だけを再構成する。

- swept continuous bristle geometry
- coarse broad dropout mask
- document-space surface grain
- cusp split + short bristle lag
- 着彩可能領域内の低alpha紙目をsource-over蓄積する軽量なrepeated contact
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

#### P2 implementation result (2026-08-22)

- 公開設定は上記8 propertyだけに固定し、backend discriminatorと旧mixing schemaは残さなかった
- `material-field.ts`をCanvas非依存の純粋な数値更新、`mixing.ts`をCanvas sampling / upload adapterとして分離した
- dabは現在の保持色を先にdepositし、その後に次dab用のPickup / Restore / Diffusionを更新する。進行方向より前方のcanvas色を変更しない
- 最初はstroke-start snapshot、以後は確定済みtargetから切り出す有限checkpoint tileを参照する。同一strokeの往復でも直前に塗った色を拾える
- mixing有効時のpendingはengineで明示的no-opとし、material rollbackや仮描画用clone cacheを持たない
- 低レベル`renderBrushStroke`はmixing時にtargetと別所有の`sourceLayer`を必須とし、同一canvasならerrorにする。production stroke runtimeはstroke開始時にsnapshotを生成する
- persistenceは新schemaの欠落・旧schema・範囲外値をerrorにする。既存非mixing stampの`spacingSizeCoupling`欠落だけは意味を保てるため`0`で補完する
- Acrylic初期値は`pickupRatePerPx=0.007`、`restoreRatePerPx=0.004`、`diffusionRatePerPx=0.05`、`updateDistancePx=15`、`checkpointDistancePx=36`、field `18x8`
- WebKit production demoの576点連続strokeを3回測定し、late / early処理時間比は`0.96 / 0.86 / 1.03`、描画後のpreset往復応答は`42–78ms`。同期入力ベンチの絶対値をFPSとしては扱わず、旧方式の時間軸劣化がないことだけをgateとした

### P3 — Rough bristle renderer

- Bristle config / state / dispatcherを追加する
- continuous geometry、broad mask、surface resource、repeated contactを段階実装する
- mixing color fieldをgeometry前段へ接続する
- bounded scheduler / backlogをproduction stroke runtimeへ統合する
- Rough bristle presetを追加する

Gate: Lab referenceに対する構造的な官能一致、incremental/replay parity、iPad 30fps gate、backlog有限化。

#### P3 implementation result (2026-08-22)

- `bristle-profile.ts`（決定的な細い毛束断面）、`bristle-mask.ts`（毛束数と独立したstroke-space面掠れ + document-space紙目）、`bristle.ts`（連続掃引・cusp split・短い毛束lag・共通混色）へ責務を分離した
- 筆圧はbrush幅を変えず面掠れのcoverageへ作用する。混色は毛束ごとのreservoirを持たず、stampと同じ連続RGBA色場を毛束alphaへ適用する
- 反復接触は追加pigment canvasを持たず、面掠れで着彩可能な領域の低alpha紙目をsource-overで蓄積する。初回の未着彩cellへfloorは加えず、Labの高コストなper-pixel packed stateは移植しなかった
- bristle pendingはengineで常にno-opとし、汎用input plugin `causal-adaptive`を製品デモのAcrylic / Rough bristleへ適用した。各入力を即時確定し、低速の微細な揺れだけを過去情報で抑える
- Live / replay、Undo、RedoをRough bristle + mixingでピクセル完全一致させた。保存形式は全bristle propertyを必須検証し、欠落・範囲外を黙って丸めない
- 50px、384点のローカルWebKit同期入力ベンチはsample p50 `12.1ms`、p95 `16.9ms`、後半/前半比 `0.95`だったが、これはLabの実入力fixtureと同じgateではなかった。さらにLab COMBは混色を含まず、production presetの混色ONと比較していたため、統合性能の根拠には使わない
- 初期版は不透明paint専用。chunkの小さな重なりで継ぎ目を防ぐため、半透明paintでは重なり濃度を保証しない。iPad 30fpsとズームアウト高速操作はP4/P5の統合官能gateで確認する

#### P3 performance re-audit (2026-08-22)

- Labでユーザーが採取した461 accepted points / 65 pointer batches / 約1918msのfixtureを比較基準に固定した
- Labのframe-budgeted COMBはWebKit p50 / p95 `12 / 15ms`。対象は毛束形状・面掠れ・紙目・反復接触で、色混ぜは含まない
- productionは代表pointer eventだけなら混色OFFでp95 `7ms`だが、coalesced実入力を捨てるため急曲線を直線で短絡し、見た目のgateを満たさない
- Rough bristleの既定値は混色OFFとする。`pickupRatePerPx <= 0`もmaterial stage全体のno-opとし、restore / diffusionだけで高コスト経路へ入らない。ハケ混色の追加最適化は非混色経路がLab同等になった後の別gateとする
- React入力境界からstroke runtimeまで`getCoalescedEvents()`の全採用点をbatchで渡す。bristle rendererはpointer event境界ではなく、入力時刻32msまたは累積移動距離1.5B（B=brush幅）で決定的にflushする。caller batchを変えてもlive/replayの出力pixelが一致するテストを追加した
- Lab Roughのtextureは外部画像ではなく、`scalePx=4 / amount=0.85 / hardness=0.82 / seed=1`のprocedural Fine tooth（2周波value noise）だった。同じ式をdocument座標固定のsurface grainとして移植したため追加ライセンスはない。TEX-03で収集した外部CC0画像はRoughのLab referenceではないためproductionへ混入させない
- Fine toothの高さ場はseed / scale単位で共有し、筆圧16段階では接触maskだけを再計算する。固定fixtureの最終WebKitはCall p50 / p95 `6 / 15ms`、batch wall p50 / p95 `5 / 15ms`、61 engine callsでLab p95と同等。max `78ms`は最初の毛束・紙目resource生成を含むcold spikeとして残る
- 固定fixtureの画像ではcoalesced input欠落時の急曲線短絡が消え、低接触部の細かな紙目欠け、高筆圧部のベタ着彩、交差の連続性を同時に維持した。最終的な色・zoomを含む官能判断はproduction webの実機gateへ渡す

#### P3 expression parity re-audit (2026-08-22)

- production webのApple Pencil比較で、Lab COMBより高筆圧域が均一面へ寄り、低筆圧域が「完全な欠け」ではなく薄い全面着彩へ寄る差を確認した。性能fixtureのp95一致だけでは表現一致を保証できない
- 比較入力の差を除くため、Labと同じ900×360 / 121点 / 8ms間隔の`S curve pressure wave`をproductionの評価panelから現在のbrush設定で履歴付き再生できるようにする。固定strokeでLab / productionのcoverage分布と見た目を比較する
- 重点監査箇所は、(1) Labのpixel単位pressure fieldに対するproductionのchunk平均pressure、(2) Labの0/1寄りmaskに対するproductionのrepeat floor、(3) committed chunk overlapによる欠けの再着彩、(4) transverse mask解像度とedge noise相関長、(5) packed repeated-contactを低コスト近似へ置換した影響とする
- パラメータ調整で一致するかを先に固定fixtureで確認し、上記の合成順・評価単位に起因する差はrendererのロジック不一致として扱う
- 固定S字の初回比較で、productionの面掠れ0 cellへ`repeatStrength * 0.06`、紙目谷へ`repeatStrength * 0.08`を無条件に加えるfloorが薄い全面着彩の直接原因と判明した。Labの反復接触はcoreの着彩可能領域内だけを後段蓄積しており意味が異なる。初回floorと専用`repeatStrength`をproduction APIから除き、着彩可能領域内の低alpha紙目は通常のsource-overで再接触時に蓄積する単純な仕様へ寄せる
- floor除去後も残った差はmaskの評価順序だった。Labは低解像度cellを符号付きpaint fieldのままswept quadへbilinear補間し、最終pixelでhardnessを適用して重複quadを`max(alpha)`結合する。productionは先に8-bit alpha atlasへ変換して各区間をCanvas `source-over`していたため、補間で生じた薄いalphaが区間境界へ蓄積していた。`bristle-mask.ts`をLabと同じsoftware raster順序へ変更し、固定S字のWebKit Call p50 / p95 `1 / 10ms`を確認した
- 極低筆圧の外形回帰は、Lab既定の`edgeTextureAmount: 0.12`を含み、`dropoutLengthPx`を十分に跨ぐ代表長ストロークで確認する。境界textureを無効化した短区間では確率場の上側tailが不足し、外形比較自体が代表条件にならない

### P4 — Web integration and combined sensory gate

- 既存`apps/web`のBrushPanelとpreset選択へAcrylic v2 / Rough bristleを組み込む
- 通常canvas、layer、zoom、Undo / Redo、保存読込をそのまま使って試せる状態にする
- debug-only metricは折り畳み表示にし、通常操作を妨げない
- Acrylic境界・spot・往復、Rough高速往復・交差・急折返しを同じアプリで確認できる補助sceneだけ追加する

Gate: ユーザーがwebデモだけでまとめて官能評価できる。

#### P4 implementation result (2026-08-22)

- 既存`apps/web`のAcrylicをv2設定へ置換し、Rough bristleを新presetとして追加した。Lab componentや比較backendへの依存はない
- mixing Stamp / Bristle選択時だけ、汎用`causal-adaptive` input pipelineへ切り替える。共通Smoothing設定は保持するが、この2系統ではpendingを使わず各入力を即時確定する
- Brush panelへ混色rate / update distance / checkpointの調整を統合し、追加fieldを手書き比較し続けない再帰的な設定同値比較へ置換した
- 左sidebarを独立scroll領域にし、Acrylicの境界・spot・往復とRoughのS字・8の字・高速zoom操作を案内する折り畳み評価panelを追加した
- 評価panelのCall p50 / p95 / maxは同期engine callback時間だけを最大240sampleで表示する。500msごととstroke終端だけpublishし、計測UI自身のReact再描画をstrokeごとに増やさない。Canvas合成や非同期GPU完了は含まないため実機官能gateの代替にはしない
- ローカルWebKitのRough 50px / 384点固定入力は、最終2runでsample p95 `16.1 / 16.2ms`、後半/前半比 `0.94 / 0.96`。Undoでcanvasが変化し、Redo後はdata URL完全一致、reload後もRough設定を復元した
- Acrylic 576点連続strokeの最終2runは後半/前半比 `0.80 / 0.61`、描画直後のPen→Acrylic切替は`56 / 52ms`。絶対値は同期Playwright入力のためFPS換算せず、時間経過で悪化しないことだけを確認した

Gate result: production webだけで両brushを描画・調整・Undo / Redo・設定再読込・同期callback計測できる。最終的な書き味、iPad GPU安定性、25% zoom高速操作はユーザー官能評価へ渡す。

### P5 — Production validation and cleanup

- `pnpm -r build`
- `pnpm test`
- `pnpm lint`
- Playwright WebKit固定replay
- iPad Safariで長時間stroke、描画直後UI応答、memory / tab crashを確認
- 100 / 50 / 25% zoom、通常 / 高速、document / screen-fixed相当を確認
- Lab由来の未使用比較コード・backend・compatibility branchがproductionにないことを監査する

Gate: API、保守性、module boundary、dependency direction、docs、determinism、回帰がセルフレビューで説明可能。

#### P5 local validation result (2026-08-22)

- `pnpm typecheck`: pass
- `pnpm -r build`: pass（7 workspace projects）
- `pnpm test`: 39 files / 466 tests pass
- `pnpm lint`: pass
- 新しい公開型はbrush-local material / bristle parameterだけを表し、Canvas backendやLab variantを露出していない
- `input`の`causal-adaptive`はbrushを知らず、`stroke`はmaterial / bristle内部stateを解釈せず、描画stateは`engine`へ閉じている
- 旧mixing backend、pending clone、backend選択、Lab importはproduction経路に残していない
- 既存Round pen / 非mixing Stamp / Sprayの回帰、mixing / Bristleのlive-replay、Undo-Redo、persistence errorは自動テストで確認した

残るP5 gateはiPad Safari実機での長時間stroke、描画直後UI、tab安定性、25〜100% zoomの官能評価。Rough bristleの半透明paintは既知のnon-goalであり、このgateへ含めない。

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
