# Acrylic / Rough bristle renderer acceleration investigation

## Status

- Created: 2026-08-25 00:29 JST
- Revised: 2026-08-25（Claude + codex review round 1 を反映。GPU一択の計画から「候補群を安く切り分ける実験計画」へ再構成）
- Branch at creation: `feature/acrylic-v2-production`
- HEAD at creation: `9ccff0c docs: close acrylic width regression`
- State: **E0〜E2完了、E1b（C4）棄却（2026-08-25）。Section 15/16に結果。次はユーザー採用判断（GPU spikeへ進むか）**
- Scope: Acrylic v2 / Rough bristle **renderer自体**の高速化。CPU最適化・WASM・WebGL2・WebGPUを候補として、有効性を素早く安く切り分ける
- Out of scope（ユーザー決定 2026-08-25）: Undo checkpoint戦略、遅延を目立たなくするUI/非同期化など「重さを隠す」方向の検討
- Work branch: `experiment/brush-acceleration`（`feature/acrylic-v2-production@9ccff0c`から分岐）。実験はすべてこのbranchで行い、自由にcommitを積んでよい
- Process exception（ユーザー承認 2026-08-25）: 作業branch上の検証に限り、Doc-First逸脱を含め既存のプロセス・ドキュメンテーション・レビューの正式手続きの省略・逸脱を許容する。目的は早く安く検証を回すことであり、効果がないかもしれない検証を丁寧に回す無駄を避ける。採用判断後の正式実装（F1〜F4）は通常プロセスへ戻す
- 改善判定の基本姿勢（ユーザー方針 2026-08-25）: **5%・10%は誤差として基本棄却**。実装のシンプルさ・保守性も守るべき価値であり、デメリットが一切ない改善でない限り小さな積み上げは採用しない。本計画の候補はいずれもcode/resource lifecycleを増やすため、明確な改善（目安20%以上）を要求する

このファイルはセッションクリア後の再開資料を兼ねる。再開時は本書と「References」のファイルを先に読み、Section 8のE0aから開始する。

## 0. Revision summary (2026-08-25)

codex review round 1（`plans/notes/2026-08-25-gpu-plan-codex-round1.md`）を受けて以下を変更した。

1. **主判断を「stage timerの比率」から「下流処理を維持したnull-stage stubのend-to-end差」へ**。Canvas2Dは遅延実行されるため、API呼び出し時間はキュー精算位置に帰属し得る
2. **Rough GPU候補はmask単体ではなくmask+ink融合の最終premultiplied RGBAをlayerへ1回転送する形を本命に**。mask単体GPU化は既存`drawSweep`と局所Canvas2D合成を残したままGPU→2D境界を追加するため、誤ったno-goを出し得る
3. **CPU候補を追加**: C14（Acrylic stroke開始時のfull-document sampling copy除去）、C15（Fine tooth不変hashのhoist）、C4（Rough ink/mask融合CPU raster）、C18（convex quad raster）、C16（document-aligned tile分割）
4. **WASM SIMD（C6）を条件付き候補に追加**。Node/headlessでも同一経路で動くためbackend二重化を生まない利点があるが、toolchain導入costが高いためkernel microbenchmark先行
5. **WebGPUはSafari 26で正式提供**。RoughはWebGL2の通常render pass + RGBA8 MAX blendで表現できるためWebGL2 first、Acrylic resident tileはWebGPU優先比較とする。GPU shader着手前に**standalone bridge benchmark**（GPU canvas→Canvas2D転送cost）を必須gate化
6. C9（Acrylic CPU shadow）、C10（async readback）、C13（OBB/composite skip）は実コード照合で却下

## 1. Background

Productionへ統合したAcrylic v2とRough bristleは、既存のPen / Airbrush等より1入力点あたりの処理が重い。1 strokeのライブ描画は概ね許容できるが、Undoでcheckpointから最大9 commandを同期replayすると待ちが積み上がる。本計画はrenderer単価を下げることに集中する。

### 1.1 Rough bristle（mixing OFF既定）の実コスト構造

コード読解結果（file:lineはHEAD `9ccff0c`時点）:

- **このpathに`getImageData`は存在しない**。costは純CPU raster + Canvas2D command量
- chunk単位: 32ms経過または移動距離`1.5 × lineWidth`でflush（`packages/stroke/src/incremental-stroke.ts:172-192`）。60px presetでは通常chunkは約90px。単発jumpで長くなり得るが、代表分布はE0aで実測する
- chunkごとに:
  - `createBristleMaskField`: bands = max(30, ceil(size/0.82)) × samples（≈chunk px）。cellごとにvalueNoise2dを2〜3回（≈24 hash呼び出し）。Float32Arrayをchunkごとに新規確保（`bristle-mask.ts:149-198`）
  - `rasterizeTriangle` ×2/segment: pixelごとにbilinear field sample + activation + `hasSurfaceContact`（hash chain 2本 + `Math.exp` 2回）+ `samplePressure`をpixelごとに再計算。overlapで約2回訪問（`bristle-mask.ts:224-360`）
  - `drawSweep`: emission（geometryStepPx=1 → 弧長1pxごと）ごとに`setTransform` + 2px幅profile atlasの`drawImage`（`bristle.ts:395-443`）
  - `new OffscreenCanvas` ×2 + `createImageData` + `putImageData` + 全bbox `source-in`/`destination-in` composite + layerへ`drawImage` 1回（`bristle.ts:343-372`、`bristle-mask.ts:73-84,145`）
  - bboxはAABB。斜め長chunkは面積浪費
- Fine tooth height tileは既にseed/scale単位でcache済み（`bristle-mask.ts:385-412`）。`CONTEXT_CACHE`（`bristle-mask.ts:30`）はcanvasが毎回新規のため一度もhitしない
- profile atlasは2px幅、すなわちinkは実質1D横断profile。ink合成をmask rasterと同じpixel loopへ融合できる余地がある

### 1.2 Acrylic（stamp + mixing）の実コスト構造

- 唯一の同期点はcheckpoint tile（size 40で約133²）の`getImageData`、既定36pxごと（`mixing.ts:207-233`）。material update（15pxごと）はcached pixelsに対するCPU計算のみ
- dabごと: `save/translate/rotate/drawImage(renderCanvas)` + `updateMixingAfterDeposit`。material updateごとにFloat32Array(576) ×2確保、18×8 `putImageData`、tipへ`drawImage` ×2 + `destination-in`
- **mixing stroke開始時にlayer全体と同サイズのsampling layerを作り全pixelをcopy**（`incremental-stroke.ts:256-268`）。しかし`sourceLayer`は`checkpointPixels`未取得時の初回captureにしか使われない（`mixing.ts:145-147`）。replayはcommandごとにrendererを作り直すため（`replay.ts:28-45`）、Undo 9 strokeではこの全画面copyを最大9回払う
- 既存対策: 2026-08-23にmaterial updateごとのreadbackを除去済み（p95 24→11ms）。`willReadFrequently`はp95 11→30msへ悪化したため**却下済み**（`plans/2026-08-23-acrylic-webkit-source-backlog.md`）

### 1.3 Incremental / replay / Undo構造

- pending pathはbristle / mixing stampで即returnするため、両brushは committed pathのみ（`incremental-render.ts:103,137-142`）
- Expand（対称展開）はbranch数だけ全costを乗算し、branchごとにmixing field / checkpoint tileを持つ
- replay commandはpixel依存で逐次。並列化不可
- 現行Rough benchmarkはUndo完了時間を測らず固定100ms待ち（`work.local/benchmark-rough-production.mjs:69-76`）。E0aで専用のUndo 1/9 wall timerが必要

## 2. Confirmed product constraints

1. Canvas2D / OffscreenCanvasを使うNode.js・Worker headless実行を維持する。
2. 関数型API、明示的state、readonly型を維持する。
3. engine公開`Layer`は現在`OffscreenCanvasRenderingContext2D`を前提とする。最初のPoCで公開Layer backendを置換しない。
4. Safari 18.2未満はサポート外だが、Safari 18.2は対象。WebGPUを必須化できない。ただし**未対応環境で既存CPU経路へ確実にfallbackできるなら、大きな効果が見込める場合にWebGPU採用の余地は十分ある**（ユーザー決定 2026-08-25。Safari 26でWebGPU正式提供）。
5. Acrylic / Rough bristleの表現品質はProduction統合済みのCPU版をreferenceとする。性能のために官能品質を暗黙に落とさない。
6. Rough bristle初期版は不透明またはほぼ不透明なpaintが対象。
7. Rough bristle既定はmixing OFF。混色ありのハケ高速化は非混色gate通過後に扱う。
8. backend差はbrush presetや保存commandへ永続化しない。実行環境のcapabilityと明示的な内部runtime設定で選ぶ。
9. GPU/contextが使えない、context lossが起きた、またはheadless Nodeの場合はCPU Canvas2D referenceへfallbackする。
10. パラメタ/アルゴリズム調整（LOD等）は候補になり得るが、品質評価に目視が必要なため、自走検証（byte-identical / parity metric）できる候補より優先度を下げる（ユーザー決定 2026-08-25）。

## 3. Technology decision at planning time

### 3.1 候補技術の位置づけ

| 技術 | 位置づけ | 理由 |
|---|---|---|
| CPU/TS最適化 | 最初に実施 | backend二重化なし、Node/replayにも効く、byte-identicalで自走検証可能 |
| WASM SIMD（Rust） | 条件付き | Node/browser同一経路でfallback不要だが、build/asset/同期初期化の導入costが高い。SIMD `exp`が無くbyte-identicalは非現実的。kernel microbenchmarkで2.5×以上を先に確認 |
| WebGL2 | Rough GPU first | Roughは通常のrender pass + RGBA8 target MAX blendで表現できる（`EXT_float_blend`不要）。Safari 17+でOffscreenCanvas WebGL可 |
| WebGPU | Acrylic resident tile優先比較 / Roughは条件付き | compute + storage + ping-pongが自然。RoughではWebGL2比でbridge込みend-to-end p95が20%以上良い場合、またはWebGL2でlate degradation/context問題が出る場合に選ぶ |

### 3.2 GPU residencyとbridge

GPU化の効果は「shaderで計算すること」ではなく、処理途中のdataをGPU側に残し、CPU readback / re-uploadを減らすことで得る。各dab・各chunkで`readPixels`、`getImageData`、`texImage2D`を往復する設計は不採用とする。

GPU canvas → Canvas2D layerへの転送（bridge）costは実装依存のため、shader着手前にstandalone microbenchmark（E2）で以下を比較する:

1. GPU OffscreenCanvasを直接`drawImage`
2. `transferToImageBitmap()` → `drawImage` → `close()`
3. `createImageBitmap()` → `drawImage` → `close()`
4. Canvas2D source control

## 4. Candidate assessment

判定はcodex review round 1で実コード照合済み。「自走検証」列はユーザー優先順位の根拠。

| ID | Candidate | 自走検証 | 判定 | 要点 |
|---|---|---|---|---|
| C1 | Stage計測harness（count / 同期blocking charged to call / end-of-run drain proxy） | ○ | 採用（修正） | 純CPU stageのみtimerが有効。Canvas API時間はqueue精算を含むため「stage cost」と断定しない |
| C2 | Null-stage upper bound stub | ○（perf） | 採用（修正） | stubは出力寸法・allocation・putImageData・下流compositeを維持する。toggle分離: constant field / contact常時true / 事前生成ImageDataを同経路upload / drawSweepのみ省略。改善率はGPU予測値ではなく**no-go判定専用** |
| C3 | CPU micro-opt群 | ○（byte-identical） | 分割して採用 | 1項目ずつ10% gate。「ship regardless」禁止。poolはscratch runtime所有にし`BrushRenderState`に混ぜない。`getImageData`は既存bufferを渡せないため「checkpoint ImageData reuse」は不可 |
| C4 | Rough ink+mask融合CPU raster（1D profile lookup） | △（parity metric） | 採用（修正） | mixing OFFの本命CPU候補。`drawSweep`のsegment overlap・frame fallback・source-over相当の結合規則を明示する。mixing ONのcolored 2D profileは対象外 |
| C5 | Field hash cost削減（octave lattice hash / band座標 / seed saltのcache、exact interpolation維持） | ○ | 条件付き | field null-stageのend-to-end効果が10%以上の場合のみ。全面memoizeは過大評価（chunk間再計算はoverlapのみ） |
| C6 | WASM SIMD（Rust `wasm32-unknown-unknown` 最小C ABI） | ○（near-parity） | 条件付き | まず独立microkernel（field sampling / activation / contact / RGBA書き込み）で**2.5×以上**、C2予測でend-to-end **20%以上** |
| C7 | **Rough WebGL2 GPU-resident pipeline**（mask+inkをGPU内で蓄積・合成し、layerへ1回drawImage） | △（parity metric + GPU fence） | 採用・GPU本命 | maskは`max(alpha)`（RGBA8 target MAX blend）、inkはsegmentごとの`source-over`と蓄積規則が異なる（`bristle-mask.ts:53-60`、`bristle.ts:358-366`）ため、**mask passとink passを分け最終passで合成**する。「fused」は1 passではなく「CPUへ戻さない」の意味。context/pipeline/bufferはruntime単位で再利用（commandごと生成禁止） |
| C8 | WebGPU版C7 | 同上 | 保留採用 | storage textureは重なりquadの`max`を自動解決しない。E2 bridge比較で20%以上優位なら選ぶ |
| C9 | Acrylic CPU shadow tileでcheckpoint readback除去 | × | **却下** | deposit sourceはCanvas2Dでfield拡大+tip mask+rotation+source-overを経る（`mixing.ts:317-339`、`stamp.ts:198-237`）。CPU shadowはCanvas2D resampling/compositingの再実装になる |
| C10 | Acrylic async readback / 粗いcheckpoint | × | **却下** | `getImageData`にasync版なし、`createImageBitmap`はpixel bufferを返さない。cadence実験はC12へ |
| C11 | Acrylic GPU-resident architecture spike | △ | 採用（修正） | 単一stroke-local tileでは往復・self-crossingで過去pixelを失う。full-layer texture / growable dirty rect / document tile atlasを比較。read-write hazardはping-pong |
| C12 | パラメタ/LOD調整（Rough geometry LOD、field解像度、Acrylic update/checkpoint cadence） | ×（目視・Tier B metric + 官能必須） | 採用・低優先 | `geometryStepPx`は`trialId`に入るため表現が変わる（`bristle-mask.ts:93-96`）。誤差制御型LOD（直線・低圧変化区間のみstep拡大）が妥当。`bands min 30`は60px presetでは無関係 |
| C13 | OBB bbox / composite skip | — | **却下** | colored profileのsource-in skipは実装済み（`bristle.ts:359-364`）。OBBは再sampleを要し見た目とpixel gridを変える。C16で置換 |
| C14 | **Acrylic stroke開始full-document copyをbounded initial checkpointへ置換** | ○（byte-identical目標） | 採用・CPU最優先 | `sourceLayer`は初回captureにのみ使用。最初のdeposit前にtarget layerからbounded tileを取得すればfull copy除去。**実装不変条件**: 現行の初回captureは`sourceLayer`（stroke開始前の画像）から読むため、Expand branchが逐次描画される（`incremental-render.ts:42-60`）状況でbranch 1を直前のtargetからcaptureするとbranch 0のdepositを拾ってしまう。よって**どのbranchも描画する前に、全branchの初回boundedTileを同一のtarget状態から先行取得してbranch stateへ格納**する。parity fixtureは初回tileが実際に重なるExpandを必須にする |
| C15 | Fine tooth不変hashのhoist（trial seedをsegmentごと1回、fixed contact hashを128×128 cache、同一式のinline化） | ○（byte-identical） | 採用 | C3派生、小さく確実。**`samplePressure`のspan増分補間は演算順が変わりcontact境界のbooleanが変化し得るためTier Aに含めない**（byte parity確認後にTier Aへ入れるか、C4/C18側Tier Bへ分離） |
| C16 | document-aligned sparse tile / sub-run raster | ○ | 条件付き | AABB全域のImageData確保/upload/compositeを削減。pixel gridを維持。command増加とのtrade-offをnull-stageで測る |
| C17 | GPU→Canvas2D bridge source比較 | ○ | 採用（E2） | Section 3.2の4方式 |
| C18 | convex quad専用CPU raster（2 triangle→1 scanline traversal） | ○（byte parity要確認） | 採用 | WASM導入前に試す |

却下済み・非候補: `willReadFrequently`（既検証で悪化）、`globalCompositeOperation: "lighter"`（加算であり`max(alpha)`ではない）、`lighten`（premultiplied blendでalpha max oracleにならない）、Canvas2D filter、Worker化（同期renderer契約の再設計が必要。Non-goal）。

## 5. Target architecture

### 5.1 Preserve the public Canvas2D contract

初期版では`Layer`、`renderBrushStroke`、`appendToCommittedLayer`等の公開signatureを変更しない。加速経路はengine内部のacceleratorとして追加する。

- runtime単位で固定する
- brush config / persisted commandへ保存しない
- Node / unsupported / context-lostはCPUへfallbackする
- testsはCPU referenceを常に利用可能にする
- 実験中のbackend selectorはdebug query、build-time switch、またはengine内部の一時的な注入点に限定する
- **selectorはUndo rebuild途中で変化させない**（rebuild単位で固定）
- context lossがstroke/rebuild途中で起きた場合は、途中からCPU継続ではなく**commandまたはrebuild全体をCPUで再実行**する（決定性を守りやすい）

### 5.2 Rough bristle GPU mapping（2段階）

**Stage A: bridge-only / constant output spike**（E2で代替。engine非変更のstandalone page）

**Stage B: mixing OFFのmask+ink fused final RGBA spike**（E3）

- Vertex data: swept quadの位置、中心線distance、横断座標、pressure、profile参照情報
- Fragment: bilinear signed field sampling、hardness、pixel-local pressure、document-space Fine tooth、repeated contact、**1D profileによるink alpha**、`drawSweep`のsegment overlap / frame fallback / source-over相当の結合
- Accumulation: RGBA8 targetのMAX blend（`EXT_float_blend`不要）
- Accumulation規則の分離: mask pass = MAX blend、ink pass = segment順`source-over`（frame fallback / overlap含む）、final pass = ink × mask合成。単一passでRGBA全体をMAXしない
- Output: premultiplied RGBAを持つGPU OffscreenCanvasから**layerへ直接1回**`drawImage`（CPU局所ink canvasへ戻さない）
- Resource: context / pipeline / atlas / buffer poolはruntime単位で再利用
- 禁止: chunkごとのCPU readback

### 5.3 Acrylic GPU-resident hypothesis

Acrylicは小さなmaterial fieldだけをGPU化しない。**GPUより前にC14でfull-document sampling copyを除去する**。

resident方式は3候補を比較する: full-layer texture / growable dirty rectangle / document tile atlas。

- 同一stroke内で直前にdepositした色を次のpickupが参照できる（read-write hazardはping-pong）
- 長いstroke、往復、self-crossing、tile外への再訪で過去pixelを失わない
- 毎dabのCanvas2D→GPU copyを避ける。初期Canvas2D→GPU copyと各visible batchのGPU→Canvas2D commitも測定対象
- mixing OFFは現在の軽いCanvas2D経路を維持し、GPU初期化costを払わない

## 6. Correctness and determinism policy

1. 同一backendのlive / incremental / replay / Undo / Redoはpixel完全一致。
2. Tier A（byte-identical必須）: C3、C14、C15、C18（parity要確認）。既存determinism / parity testでそのまま検証。
3. Tier B（near-parity metric + 官能gate）: C4、C6、C7、C8、C11、C12（cadence変更はmetric通過に加え官能差なしを要求）。固定fixtureで初期閾値:
   - bbox edge差: 1px以内
   - coverage相対差: 1%以内
   - normalized RGBA/alpha MAE: 0.015以内
   - `abs(delta) > 0.1` pixel率: union coverageの1%以内
   - visual diff image（`work.local/`のみ）
   - metricは官能承認の代替ではなく**自動no-go gate**
4. seed、document座標、canonical distance trial、chunk分割に依存しないidentityを維持する。
5. CPU referenceは削除しない。Node/headless fallbackとparity oracleを兼ねる。

## 7. Measurement design

### 7.1 何を測るか

- **stage count / 同期blocking charged to call**（純CPU stageは真のcost、Canvas APIはqueue精算を含み得ると明記）
- **end-of-run drain proxy**: Canvas2Dに標準fenceがないため、benchmark専用のtarget側小`getImageData`で精算を強制する。production frameごとには行わない
- GPU backendはbenchmark時のみfence / finish相当でGPU completionを測る
- pointer batch受理からvisible frameまでのwall time
- early / late p50・p95とlate / early比（2秒、10秒、30秒）
- frame budget超過率（16.7ms / 33.3ms）
- cold（新規page/contextで最低5回）/ warm（同一pageで最低30 stroke）
- **Undo 1 / 9**: history rebuild開始からvisible completionまで（固定sleep禁止）
- 代表chunkのemission数 / field cell数 / AABB面積分布
- full-layer sampling copy回数・総pixel数
- GPU resource初期化回数とreuse率
- context loss / fallback可否

### 7.2 A/B規律

- A/B/B/A等の交互順序で熱・順序を相殺
- 改善率の95% CIが0を跨がないことを要求
- instrumentation ON/OFFのp95差が3%以内であること（超えるならtimerを粗くする）
- 承認待ち・browser起動・dev server待ちは実走時間へ含めない。ページ内`performance.now()`で判定

### 7.3 Fixed fixtures and existing evidence

#### Rough bristle primary fixture

- File: `work.local/comb-06-input.json`（2026-08-15 iPad Pro + Apple Pencil、461点、65 batch、約1.92秒、Brush 60px）
- Existing final Production CPU WebKit Call / batch wall p50 / p95: `4 / 16ms`、cold max `69ms`
- References: `plans/2026-08-23-12-03_rough-bristle-repeated-contact.md`

#### Rough expression fixtures

- 固定S字pressure wave、反復交差 / zigzag / rapid loop（Lab COMB-02 / 03）
- Check: 低筆圧がalpha 0と不透明片の面積変化になること、Fine tooth、inner-curve continuity、chunk seam、repeated contact accumulation

#### Acrylic fixtures

- Scripts: `work.local/benchmark-acrylic-production.mjs`、`work.local/benchmark-acrylic-backlog.mjs`（Canvas prototypeを直接wrapしている点に注意）
- Long-stroke gate: mixing ON / OFF、early / late、spot pickup、赤青境界、同一stroke往復、**Expand対称展開**（C14 parity用）
- 代表Apple Pencil captureをJSON fixtureとして固定し、最小fixtureはtest fixtureへ移す

### 7.4 Platforms

1. Local Mac WebKit（第一性能gate。既存Production scriptはWebKit固定）
2. Local Chromium（gate通過候補のみ回帰確認）
3. iPad Pro Safari + Apple Pencil（最終官能・backlog・tab安定性）
4. Node/headless CPU fallback（build/test）

`work.local/benchmark-bristle-mask.mjs`はLab経路であり、Production計測には使わない。

## 8. Execution flow: cheap isolation first

### 8.1 Explicit deviation from Doc-First

本件はWebKit上で各高速化手法が実際に効くかを確かめる探索である。ユーザー指示に基づき次の順序へ意図的に変更する。

```text
E0a Production baseline + 計測妥当性確認
E0b Null-stage upper bounds（no-go早期判定）
E1a Tier A CPU候補（C14 / C15 / C3分割）を1項目ずつ
E1b Rough fused CPU raster（C4 / C18、条件付きC5 / C16）
E2  Standalone GPU bridge benchmark（WebGL2 / WebGPU × source方式 × size × early/late）
E3  Rough fused GPU final-RGBA spike（C7、条件付きC8 / C6）
E4  Acrylic cadence sweep（C12）と resident-tile spike（C11）
  -> 各段でユーザー採用判断
  -> 採用候補だけDoc-Firstで正式設計・再実装・レビュー
```

### 8.2 Experiment operating rules

1. **最初からProductionを測る**: Lab専用rendererは作らず、`packages/engine`と`apps/web`の実経路を一時的に変更する。
2. **CPU referenceを残す**: 同一build内で切り替え、同一入力を比較できるようにする。
3. **一時switchをpublic APIにしない**。
4. **差分を小さく保つ**: 1仮説1 commit。効果がない経路は容易にrevert。
5. **実験コードの美しさを優先しない**。ただし既存ブラシを壊す変更、CPU fallbackを失う変更、再現不能なglobal stateは避ける。
6. **表現と性能を同時に測る**: Tier Bはcross-backend diffと`apps/web`官能評価を常に対にする。
7. **GPU完了を測る**: 同期callbackだけで成功判定しない。
8. **無効な候補を早く捨てる**: null-stage上限で見込みがなければ実装しない。
9. **正式化は採用後**。
10. **実験終了時に残骸を分類する**: 採用、次段候補、破棄、measurement-only utilityの4区分を本計画へ記録する。

### 8.3 Experiment table with go / no-go

共通規則: **GoとNo-goの間はHold**（結果を記録し、後段の結果が出てから再判定）。E0aのNo-goは3%超（3%ちょうどはGo）。改善率10%未満は複雑性に見合わないため原則棄却（Status欄の方針）。

| # | 実験 | Go | No-go |
|---:|---|---|---|
| E0a | Production harness整備。Rough / Acrylicのstage count、sync charge、visible wall、end-drain、Undo 1/9、chunk分布を記録 | instrumentation ON/OFF差3%以内、fixture反復安定 | 計測自体がp95を3%以上変える場合はtimerを粗くする |
| E0b | C2 null-stage。Rough: field / contact / raster / drawSweep / composite。Acrylic: full-layer copy / checkpoint readback / field / update upload（各toggle独立、下流維持） | 高コスト候補のnull上限がwarm p95で30%以上、またはUndo 9で25%以上 | Rough mask+ink nullが20%未満ならC6/C7/C8停止。Acrylic checkpoint bypassが20%未満ならC11停止 |
| E1a-1 | C14 bounded initial checkpoint | byte完全一致（対称展開fixture含む）、Acrylic coldまたはUndo totalが20%以上改善 | 20%未満はHold、10%未満は棄却（記録のみ） |
| E1a-2 | C15 + C3を1項目ずつ（trial seed hoist、fixed hash cache、sample buffer、scratch pool） | byte完全一致かつwarm p95/Undo totalが20%以上改善。cold maxが20%以上改善するpoolも可 | 20%未満はHold、10%未満はrevert |
| E1b | C4 fused CPU raster + C18。C5はfield nullが10%以上の場合のみ。C16はAABB nullが有意な場合のみ | Tier B metric内、warm p95またはUndo 9が20%以上改善 | metric超過、または改善10%未満 |
| E2 | Standalone bridge benchmark（engine非変更）。代表size 128×128 / 256×128 / 256×256 / 512×128、WebGL2 / WebGPU、4 source方式、chunkごと非同期で最後だけdrainのproduction-like経路、2/10/30秒 | 代表sizeのbridge p95が2ms以下かつbaseline chunkの25%以下、late/early ≤1.2 | bridgeだけでbaselineの30%以上、30秒後に1.3倍以上悪化 → GPU候補停止 |
| E3 | C7 Rough WebGL2 fused final RGBA | warm p95 ≤12.5msまたはCPU比25%以上改善、Undo 9も25%以上改善、16.7ms超過率半減、Tier B metric内 | p95改善15%未満、late悪化、context instability、parity不収束 |
| E1c | C6 WASM microkernel（E1bの後、E2/E3に依存しない独立実験） | 着手条件: E0bのC2予測でend-to-end 20%以上。採用条件: kernel 2.5×以上かつ統合後end-to-end 20%以上 | kernel 2.5×未満で停止。統合しない |
| E3' | C8 WebGPU版 | 着手条件: E2でWebGL2より20%以上良い、またはWebGL2でlate degradation/context問題。採用条件: 実装後end-to-end p95がWebGL2比20%以上良い | 条件未達ならbackend追加停止 |
| E4a | Acrylic cadence sweep（C12: update / checkpoint distance、tile面積、回数、最大stallを記録） | p95 15%以上改善しTier B metric内、官能差なし | tile総転送量増加、spot pickup / 往復差 |
| E4b | C11 Acrylic resident spike（WebGPU優先、3方式比較） | warm/late p95とUndo 9が30%以上改善、late/early ≤1.2、feedback fixture合格 | residency維持不能、毎update Canvas往復、往復strokeで過去pixel喪失 |

Stop時は実験rendererを削除または実験commitへ隔離し、CPU productionを残す。正式なbackend abstractionは作らない。

### 8.4 E0a / E0b harness: 既存scriptの流用（新規統合runnerは作らない）

**Rough**: `work.local/benchmark-rough-production-capture.mjs`を主runnerにする。
- `endpoints`モードをprimary（実captureの65 native batch + coalesced点を再現）。`all-accepted`は感度確認のみ
- 既存のbatch wall + double RAFを維持し、runの最後に表示canvasの1×1 `getImageData`をdrain proxyとして追加
- engine内部の一時debug global（public APIにしない）で`baseline / instrumented / null-field / null-contact / null-raster / null-drawSweep`を切り替え、同一fixtureをA/B/B/Aで実行
- Undo計測は`benchmark-rough-production.mjs`のUndo/Redo操作だけ移植。2 stroke後のUndoでreplay 1、10 stroke後のUndoでreplay 9を作り、page内のclick開始から2 RAF + drainまでを測る

**Acrylic**: `work.local/benchmark-acrylic-backlog.mjs`をlong-stroke runnerにする。
- 既存Canvas prototype wrapperはsync charge計測として維持しつつON/OFF可能にし、3% overhead gateを検証
- 同一synthetic往復strokeで`baseline / null-full-copy / cached-checkpoint-pixels / null-field / null-upload`を切り替え
- null checkpointは`getImageData`だけをcached同寸ImageDataへ置換し、sampling・field update・uploadは残す
- raw `dispatchMs / frameMs / canvasPerf`にengine側stage count、full-copy pixel数、checkpoint回数を追加

### 8.5 Adoption gate: user decision

各段の後、次をまとめてユーザーが採用 / 保留 / 破棄を判断する。

- 同一fixture画像とdiff（Tier Bのみ）
- Mac WebKitのcold / warm / early / late p50・p95
- iPad Safariの官能評価とbacklog / tab安定性（Tier Bのみ）
- Undo 1 / 9の総時間
- 追加されたresource lifecycleと複雑性
- fallback時の挙動
- 既知の表現差・制約

### 8.6 Formal implementation track（採用判断後のみ）

#### F1: API / architecture docs

1. 実験で有効だった最小境界だけを正式設計する
2. backend capability、runtime ownership、resource disposal、context loss fallback（rebuild単位CPU再実行）を確定する
3. CPU referenceと加速backendのdeterminism / parity contractを確定する
4. browser-only acceleratorとNode/headless contractの境界を文書化する
5. 公開API変更が必要か再判断し、必要なsignature / readonly型 / exportだけを設計する
6. `packages/engine/docs/brush-api.md`と関連docsを更新する

#### F2: Usage review — explicit user gate

- `apps/web`からの正式な利用イメージ、通常利用時のbackend透明性
- Node/headless / context loss fallback、persisted commandへの影響
- parity許容値とperformance gate

#### F3: Production implementation and cleanup

1. 実験コードを正式設計へ整理する
2. debug switchや一時global stateを削除または明示的な開発機能へ隔離する
3. capability fallback / resource cleanup / context loss testを追加する
4. tests、benchmark、docsを正式仕様へ揃える

#### F4: Architecture and library review

1. `review-library-usage` skillでセルフレビュー
2. 実装→docs、docs→実装の双方向確認
3. public export / persisted schema / Node fallbackの不要な拡張がないことを確認
4. resource lifecycleとcontext lossを確認
5. `pnpm -r build` / `pnpm test`（browser mode含む）/ `pnpm lint`
6. 核心parity testとbenchmark resultの現物を確認
7. rootにdebug PNG / TXTがないことを確認
8. `plans/agents-note.md`へ採否、残件、実機riskを整理

## 9. Deliverables

### Experiment track

- stage countとnull-stage上限表（Rough / Acrylic）
- 代表chunk bbox / emission分布
- bridge matrix: backend × source方式 × size × early/late
- Undo 1/9の実測（開始・完了条件を明記）
- full-layer sampling copy回数・総pixel数（before/after C14）
- GPU resource初期化回数とreuse率
- CPU referenceを保った一時的なspike群と比較用parity harness
- `work.local/`の再利用可能なWebKit / Chromium benchmark scripts
- comparison screenshots / diff（`work.local/`のみ、commit対象外）
- 本計画の実装結果、採否、残件更新

### Formal track（採用時のみ）

- 更新済みengine docs、整理済みaccelerator + CPU fallback
- 自動parity / context loss / lifecycle tests
- `plans/agents-note.md`のarchitect handoff

## 10. Non-goals

- WebGPU必須化
- 全brushのGPU renderer化
- public `Layer`をGPU texture型へ全面置換
- Worker化を伴うasync public renderer
- CPUによるCanvas2D resampling / compositingの完全再実装（C9）
- Rough mixing ONの初期GPU fused renderer
- 物理的な顔料厚・impasto・照明、有限paint reservoir
- Undo checkpoint戦略の変更、遅延を隠すUI対策
- 共通Paper Surface resourceの新設
- Rough bristleの半透明paint完全対応
- 高速化を理由に入力点を追加で捨てること

## 11. Known risks

- stage timerがCanvas queue flush位置を誤帰属する
- WebKitは非同期GPU backlogがJS同期計測に現れにくい
- `drawImage(GPU canvas -> Canvas2D)`が内部copyを発生させ利益を相殺する可能性（E2で先に測る）
- `transferToImageBitmap`のallocation / `close()`漏れ
- GPU context / pipelineをreplay commandごとに再生成する危険（runtime単位再利用で回避）
- CPU/GPU selectorがUndo rebuild途中で変化する危険
- Acrylic resident tileがself-crossing / 往復で過去pixelを失う危険
- C14でExpand複数branch重なり領域の初回tile意味が変わる可能性
- WASMの同期初期化とpackage asset配布
- CPU / GPU raster差がreplay save/loadを跨ぐ場合の見た目差
- iPadのtile memory / large zoom-out dirty area
- GPU resource poolingが関数型stateとresource ownershipを曖昧にする危険

## 12. References required on resume

### Project instructions and skills

- `CLAUDE.md`
- `.claude/skills/planning-flow/SKILL.md`
- `.claude/skills/delegation/SKILL.md`
- `.claude/skills/review-library-usage/SKILL.md`

### Discussion records

- `plans/notes/2026-08-25-gpu-plan-claude-memo.md`（Claude側の初期候補メモ C1〜C13）
- `plans/notes/2026-08-25-gpu-plan-codex-round1.md`（codex review round 1の全文。候補判定の根拠file:lineはここ）
- `plans/notes/2026-08-25-gpu-plan-codex-round2.md`（round 2: C7蓄積規則、C14不変条件、Hold規則、harness流用案）

### Architecture docs

- `packages/engine/docs/README.md`
- `packages/engine/docs/brush-api.md`
- `packages/engine/docs/incremental-render-api.md`
- `packages/stroke/docs/history-api.md`
- `packages/stroke/docs/command-executor.md`
- `packages/stroke/docs/parity-testing.md`

### Current implementation

- `packages/engine/src/brush/bristle.ts`、`bristle-mask.ts`、`bristle-profile.ts`、`stamp.ts`、`mixing.ts`、`material-field.ts`、`state.ts`、`scheduler.ts`
- `packages/engine/src/stroke-interpolation.ts`、`packages/engine/src/layer.ts`
- `packages/stroke/src/incremental-stroke.ts`、`replay.ts`、`stroke-runtime.ts`

### Previous plans and measurements

- `plans/2026-08-22-acrylic-v2-production-integration.md`
- `plans/2026-08-23-12-03_rough-bristle-repeated-contact.md`
- `plans/2026-08-23-acrylic-webkit-source-backlog.md`（**必読**: `willReadFrequently`失敗、readback削減の経緯）
- `plans/2026-05-03-03-18_safari-mixing-brush-performance-plan.md`
- `plans/2026-08-24-acrylic-pressure-wave-regression.md`
- `plans/agents-note.md`
- `work.local/comb-06-input.json`
- `work.local/benchmark-rough-production-capture.mjs`、`benchmark-rough-production.mjs`
- `work.local/benchmark-acrylic-production.mjs`、`benchmark-acrylic-backlog.mjs`

### Official platform references

- WebKit, Safari 17: OffscreenCanvas 2D / WebGL — https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
- WebKit, Safari 26: WebGPU shipping on macOS / iOS / iPadOS / visionOS — https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- W3C WebGPU — https://www.w3.org/TR/webgpu/
- Khronos WebGL 2.0 — https://registry.khronos.org/webgl/specs/latest/2.0/

## 13. Resume checklist

1. `git status --short`でユーザー変更を確認し、勝手に上書きしない
2. branchが`feature/acrylic-v2-production`か、後継branchかを確認
3. 本書Section 0 / 4 / 8.3 / 8.4と「References」を読む
4. 461点fixtureが`work.local/comb-06-input.json`に存在することを確認
5. **E0a**: harness整備と計測妥当性（instrumentation overhead 3%以内、Undo 1/9 timer、chunk分布）
6. **E0b**: null-stage上限で高cost候補のno-goを先に出す
7. E1a（C14 → C15 / C3）を1項目ずつ、byte-identical + 10% gateで進める
8. E1b → E2（bridge benchmark必須）→ E3 → E4の順で、各段の仮説と測定結果を本計画へ追記する
9. 採用候補ができた時点で見た目・性能・複雑性をユーザーへ提示する
10. ユーザーの採用判断後にのみF1 Doc-Firstへ進む

## 14. Planning-time conclusion

- **Rough bristle**: GPU化の勝算は「CPU raster + drawSweep + compositeのnull-stage上限」と「GPU→Canvas2D bridge cost」の積で決まる。断定しない。GPU本実装候補はmask単体ではなく、mixing OFFのmask+ink fused final RGBA。その前にCPU側でC15 / C4 / C18を試し、backend二重化なしでどこまで下がるかを確認する。
- **Acrylic**: GPU化の前にC14でfull-document sampling copyを除去する（replay / Undoに直結）。resident化は単一tileではなくfull-layer / growable rect / tile atlasの比較で判断し、residencyを保てなければCPU最適化に留める。
- **WebGPU**: Safari versionではなく、WebGL2とのbridge / end-to-end比較（20%以上優位）で選ぶ。Acrylic residentはWebGPU優先比較。
- **WASM**: Node/browser同一経路の利点は大きいが、kernel 2.5×が出なければ導入しない。
- **Undo**: renderer高速化の効果はreplay単価×最大9として積み上がる。checkpoint戦略の見直しは本計画の対象外。

## 15. E0 results (2026-08-25, work branch `experiment/brush-acceleration`)

### 15.1 Harness
- `packages/engine/src/brush/perf-debug.ts`（`globalThis.__hpBrushPerf`）: stage counter + per-chunk series + null toggles（field / contact / raster / drawSweep / fullCopy / checkpoint / fieldAdvance / materialUpload / render / dabDraw / rotate）。`?perfDebug=1&nullStages=...`で接続
- `work.local/benchmark-rough-production-capture.mjs`（`ENGINE=chromium|webkit`, `PERF_VARIANT`, raw per-batch出力）、`work.local/benchmark-acrylic-backlog.mjs`（`PERF_VARIANT`、合成eventに単調timeStampを付与。**`40c76e8`の再提示拒否により旧scriptは全点が捨てられていた**）
- 計測妥当性: instrumented vs baselineでCall p50/p95・Undoに差なし（gate通過）。**WebKitの`performance.now()`は1ms粒度**のためstage内訳はChromiumで取り、WebKitはend-to-endのみ信用する
- Undo fixture（8 move合成stroke × 2/10本）は短すぎて代表性なし。Undo評価は実fixtureのreplay総和（renderer合計）で行う

### 15.2 Rough bristle（comb-06、60px、mixing OFF）
- chunk: 80個、emission p50 125 / max 175、field cell ≈9k、bbox ≈21k px²。**chunkあたり≈3.3ms（Chromium）で stroke を通じて一定**。batch wallの後半増加（5→20ms）はfixtureのbatch間隔が疎になり1 batchに5〜7 chunk入るためで、rendererの劣化ではない（`moveMany`合計≈252ms ≒ `processBatch`合計≈264ms）
- renderer合計 ≈ 250ms / 約10,000px stroke ≈ **26µs per px-arc**。実機60Hzの速いstroke（≈90px/frame）で≈2.3ms/frame → liveは軽い。**重さの本体はreplay（Undo 9 ≈ 9 × 250ms）**
- Chromium内訳（合計258ms）: maskField 23% / maskRaster 28% / drawSweep 4% + **layerDraw 43%**（≈120回/chunkの`drawImage`の遅延精算がchunk末の`drawImage(ink→layer)`に帰属。`null-drawsweep`でlayerDraw 110→9ms）/ maskUpload・composite・alloc ≈1%
- WebKit end-to-end（batch wall p95）: baseline 20 / null-field 16-18 / null-raster 17-19 / null-contact 18-19 / null-drawsweep 17-18 / null-render 2。単独stageで25%を超えるものはない
- 判断: **C4（ink融合CPU raster）が最有力**（drawSweep+精算≈45%を除去見込み）。C15/C5はfield 23%の一部。GPU fused（C7）はCPU側≈95%を除去できるが、80 chunk/strokeなのでbridgeが≈1ms/chunk未満でないと利益が薄い → E2必須。**C14はRoughに無関係、C13/C16は対象外（bbox関連costは≈1%）**

### 15.3 Acrylic（backlog fixture 1920 samples ≈ 34,500px、8 samples/frame）
- dispatch p50/p95 8/11ms、合計≈1.9s / 1920 samples ≈ **1ms/sample ≈ 55µs per px-arc**（Roughの2倍。lineWidth小のため27,404 dab、14 dab/sample）
- null-stage end-to-end（dispatch p50/p95、undo9）: **null-dabdraw 4/6（−50%）、undo9 −43%** / **null-upload 6/8（−25%）、undo9 −40%** / null-checkpoint 1/1 だが frame p95 12→18（**readbackを消してもGPU仕事はframeへ移るだけ**）/ null-fullcopy 差なし（4M px copy = 1ms）/ null-fieldadvance 差なし / null-rotate 差なし
- stage timer: checkpointReadback 997回・1700ms（=同期点に全queueが帰属）、CPU計算（sample/advance）合計36ms
- 判断: 本体は**Canvas2Dコマンド量**（dab `drawImage` 50% + material upload 25% + checkpoint tile draw/readback ≈15%）。CPU計算最適化（C3/C15相当）は無意味。**C14棄却**。CPU候補で20%を超えるのは「upload 3コマンド→CPU合成1 putImageData」（≤25%、要検証）と dab数削減（C12・目視）のみ。**GPU側でdabをinstanced描画＋fieldをGPU常駐（C11）が唯一の大幅改善候補**

### 15.4 Next
1. E1b: C4（Rough ink融合CPU raster、mixing OFF）→ Chromium stage合計・WebKit end-to-end・Tier B parity
2. E2: standalone bridge benchmark（Rough chunk代表size 150×150 / 250×150、Acrylic dab batch）
3. Acrylic upload短縮（C19: tip×fieldをCPUで合成し`putImageData`1回）は小実験として可
4. C14 / C13 / C16 / null-checkpoint系は棄却。plans/notes参照

## 16. E1b / E2 / Acrylic追加実験の結果 (2026-08-25)

### 16.1 E1b: C4 Rough fused ink CPU raster → **棄却**（commit `fa2d7dc`、revert `e5b1c0b`）
- Chromium: renderer合計 250→164ms（−34%）、wall p95 22.9→15.9。**WebKit: 221/230→201/218ms（−8%）**、wall p95 20→19。WebKit gate（20%）未達
- 表現差: legacyのinkはsegmentごとのatlas重ね塗りで毛束の隙間が埋まるが、fusedは1D profileそのままなので白い筋が残る（coverage差4%、|Δα|>0.1が11.5%）。表現を変えてまで採る価値なし

### 16.2 E2: GPU→Canvas2D bridge（`work.local/bridge-bench/`、`benchmark-bridge.mjs`）
- WebKit webgl2 direct `drawImage`: production-like warm p95 ≈1ms（1ms粒度下限）、sync 1〜2ms。ImageBitmap系 2ms。Chromium production-like 1.7〜2.3ms、sync 0.3〜1ms
- **WebGPUはPlaywright WebKit/Chromium headlessで無効**（`navigator.gpu`なし）。実機Safari/iPadでの再計測が必要
- Rough判断: chunk≈3.3msに対しGPU化後は geometry + bridge ≈1.5〜2.5ms → **改善25〜50%、Go条件「bridge ≤ baseline chunkの25%」未達**。backend分岐の複雑性に見合わない → **Hold**

### 16.3 Acrylic追加実験（WebKit、backlog fixture）
| 実験 | dispatch p50/p95 | 所見 |
|---|---|---|
| baseline | 8/11 | 同期合計≈1.7s/1920 samples |
| spacingScale 3（dab 27,404→9,135） | 7/11 | **dab数に比例しない** |
| checkpointScale 2/4/8（997→502/253/127回） | 7/10, 6/9, 3/8 | 回数を減らすと1回あたりが増え、総量は−7%/−26%/−62%。「同期点で溜まったGPU仕事を払う」だけ |
| updateScale 2/4（2,347→1,193/602回） | 6/9, 6/8 | update回数に≈25%依存 |
| layerSize 512/1024/2048 | 2/5, 4/7, 8/12 | **checkpoint単価1.75msはlayerサイズに無関係**（stroke長に比例して回数が変わるだけ） |
| bitmapDab（`transferToImageBitmap`をdab source） | 11/17、undo9 2倍 | **悪化・棄却** |
| null-dabdraw（再掲） | 4/6 | dabを1つでも描くと≈50%増える |
- `moveMany`（engine内）とdispatchが一致。表示側（React/PaintCanvas）の関与なし
- 解釈: 「dab数」「checkpoint数」「layerサイズ」に比例せず「update回数」に部分依存、「dab有無」に強く依存 → **material updateで書き換えたrenderCanvasを最初にdab sourceとして使う際のWebKit内部flush/snapshot**（updateごと≈0.4ms相当）が主因という仮説が最も整合する。2026-05の「Canvas間copy/キュー飽和」「source ring無効」の記録とも一致
- Canvas2D内で回避する手段は見つからず（ring・ImageBitmapとも無効）。残る手段は (a) `updateDistancePx`拡大（C12・目視、≈−25%上限）、(b) **GPU instanced dab + field texture常駐（C11）で「小canvasの書き換え→source利用」を根絶**

### 16.4 総括と採用判断のための材料
- **Rough**: CPU候補に20%超のものなし（C4 −8%）。GPU化は25〜50%見込みで複雑性に見合わずHold。WASMはfield+raster（WebKitで≈70%）を2.5×以上にできれば−45%だが、toolchain導入costが高くbyte-identical不可
- **Acrylic**: 本命はGPU（C11）。Canvas2D内で得られる大幅改善はない。パラメタ（updateDistancePx / spacing）は目視評価前提で最大−25%程度
- **Undo replay**: rendererの総和がそのままreplay単価（Rough ≈250ms、Acrylic ≈1s per 2秒stroke）。Acrylic GPU化が最もUndoに効く
- 次の判断（ユーザー）: (1) Acrylic GPU-resident spike（E4b、WebGL2 first。WebGPUは実機Safariで別途bridge確認）へ進むか、(2) Acrylicはパラメタ調整で妥協するか、(3) Roughは現状維持か

## 17. GPU spike方針（ユーザー決定 2026-08-29）

- 小改善に限界があると判明したため、**WebGL2を軸にGPU活用を模索**する。まず実験的にどの程度性能が出るかを評価し、Production経路に繋いで十分な描画検証ができる状態を目指す。制約・未対応（当座はExpand非対応、mixing ON stampのみ、context loss未対応、Node fallbackはCPU経路）は許容
- **Expandは当座の検証のみ省略**。最終的に性能改善が最も大きく効くのはExpandルート（branch数×dab数のinstancing）なので、正式設計では必須対象
- WebGPUの効果も評価する。測定はChromium優先、効果が出そうならWebKit系（Safari TP）でも確認。最後はiPad実測
- 自動測定にApple公式Safari MCP（`safaridriver --mcp`、Safari Technology Preview Release 251）を導入。`.mcp.json`に`safari-mcp-stp`として登録済み。stdioクライアント `work.local/safari-mcp-client.py`（`bridge` / `eval`モード）で計測を駆動できる。要件: STPの Developer › "Enable remote automation and external agents"（`safaridriver --enable`）
- G0 texture方式はfull-layer 1枚、pickupは1 checkpoint遅れの非同期readback、と**シンプルで性能が出る方式を優先**（数字が出なければ先に進まない）
