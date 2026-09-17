# codex review round 1 (2026-08-25) — brush acceleration plan

Claude側の候補メモ(C1〜C13)と既存計画を実コードと突き合わせたcodexのレビュー全文。
# 総評

提案の方向性は良いですが、現状の E0'〜E4' は次の3点を修正すべきです。

1. **stage timer の比率ではなく、下流処理を維持した null-stage の end-to-end 差を主判断にする。** Canvas2D は遅延実行されるため、API 呼び出し時間は実処理位置ではなくキューの精算位置を示す場合があります。既存 benchmark もこの制約を持ちます（`work.local/benchmark-acrylic-backlog.mjs:13-39`）。
2. **C3 を一括で「byte-identical・ship regardless」と扱わない。** 無効な項目、既実装の項目、resource lifecycle を増やす項目が混在しています。
3. **Rough の GPU PoC は mask 単体ではなく、mixing OFF 限定で mask+ink を融合し、GPU canvas から layer へ1回だけ転送する形を本命にする。** mask だけ GPU 化すると、現在の `drawSweep` と局所 Canvas2D 合成を残したまま GPU→2D 境界だけ追加するため、誤った no-go を出し得ます（`packages/engine/src/brush/bristle.ts:343-372`）。

また、メモの「400px/chunk、約470k hash/chunk」は通常の Production batching の代表値ではありません。Rough は32msまたは移動距離 `brushSize * 1.5` で flush されるため、60px preset では通常約90pxまでです（`packages/stroke/src/incremental-stroke.ts:172-192`）。大きな単発 jump では400pxも起こり得ますが、固定 fixture の実分布を計測してから見積もるべきです。

---

# C1〜C13 の判定

| ID | 判定 | 批評 |
|---|---|---|
| **C1** | **修正して採用** | 純CPUの `createBristleMaskField`、triangle loop、material-field は stage timer が有効です。一方、`drawImage`、`putImageData`、checkpoint `getImageData` の時間は Canvas キューの精算を含み得るため、「その stage 自体のコスト」と断定せず、**call count / synchronous blocking charged to call / end-of-run drain proxy** に分けて記録してください。既存 Acrylic benchmark は Canvas prototype を直接 wrap しており（`work.local/benchmark-acrylic-backlog.mjs:13-39`）、Rough Production benchmark は WebKit 固定です（`work.local/benchmark-rough-production-capture.mjs:61-68`）。最初は WebKit、候補通過後に Chromium で十分です。 |
| **C2** | **修正して採用** | 非常に有効ですが、stub は出力寸法、allocation、`putImageData`、下流 composite を維持しないと上限値になりません。例えば mask を完全に skip すると、現在の `destination-in` と layer 転送まで消えます（`packages/engine/src/brush/bristle.ts:365-372`）。「constant field」「surface contact 常時 true」「事前生成 ImageData を同じ経路で upload」「drawSweep のみ省略」を別 toggle にしてください。GPU mask の上限は楽観値なので、改善が小さい場合の no-go には使えますが、改善率そのものを GPU 予測値にはできません。 |
| **C3** | **修正して採用** | 一括 candidate ではなく分割が必要です。mask/ink canvas と ImageData は確かに chunk ごとに生成されています（`packages/engine/src/brush/bristle.ts:343-357`、`packages/engine/src/brush/bristle-mask.ts:73-84`）。一方、Fine tooth height は既に seed/scale 単位で cache 済みです（`packages/engine/src/brush/bristle-mask.ts:385-412`）。`getImageData` は既存 buffer を渡せないため「checkpoint ImageData reuse」は不可能です。再利用できるのは `sampleRotatedCheckpoint` の出力や material scratch buffer です（`packages/engine/src/brush/mixing.ts:246-274`、`packages/engine/src/brush/material-field.ts:48-80`）。pooling は scratch runtime 所有にし、意味状態である `BrushRenderState` に混ぜない方がよいです。測定せず「ship regardless」は不可です。 |
| **C4** | **修正して採用** | mixing OFF の本命CPU候補です。ただし単純な `profile[v] * mask` では現行と一致しません。`drawSweep` は segment ごとに source-over し、曲率に応じて overlap を追加し、frame が path に近い場合は向きを差し替えています（`packages/engine/src/brush/bristle.ts:419-442`）。その後に一枚の mask を `destination-in` しています。融合実装は「各 quad の profile をどう結合するか」を明示し、mixing ON の colored 2D profile は対象外にしてください。byte-identical ではなく metric parity + 官能 gate です。 |
| **C5** | **修正して採用** | 「per-stroke texture に値を保存すれば field stage がほぼ0」は過大評価です。通常、各 emission 列は一度しか計算されず、chunk 間で再計算されるのは小さな overlap だけです。noise は distance/cross/seed だけでなく dynamics と brushSize にも依存し、pressure threshold は列ごとに変化します（`packages/engine/src/brush/bristle-mask.ts:149-198`）。有効なのは、実値の全面 memoize よりも、各 octave の lattice hash、band 側座標、seed salt を cache して exact interpolation を残す方式です。field null-stage が end-to-end で有意だった場合だけ進めてください。 |
| **C6** | **修正して条件付き採用** | 技術的には可能ですが、この repo には WASM build/init/package の経路がありません（`package.json:5-23`、`packages/engine/package.json:14-26`）。さらに raster は branch、gather、hash、2回の `exp` を含み（`packages/engine/src/brush/bristle-mask.ts:275-296`、`:320-360`）、SIMD向きの連続算術だけではありません。WASM には SIMD `exp` がないため、byte-identical は現実的ではありません。まず独立 microkernel で **stage 2.5倍以上、予測 end-to-end 20%以上**を確認してから統合すべきです。 |
| **C7** | **採用** | Rough mixing OFF の最有力 GPU 候補です。ただし既存計画 E1 の「mask canvas を返して既存 Canvas2D に接続」ではなく、C7 の名前どおり **mask+ink を最終 premultiplied RGBA まで融合**し、layer へ1回 `drawImage` する形にしてください。現在は mask生成、drawSweep、色付け、mask合成、layer転送があります（`packages/engine/src/brush/bristle.ts:347-372`）。WebGL2 の RGBA8 target なら MAX blend は利用でき、初期 PoC に float blend extension は不要です。 |
| **C8** | **修正して保留採用** | `Expected gain ≥ C7` は根拠がありません。WebGPU storage texture は overlapping quad の `max` を自動的に解決せず、同一pixelへの競合には render-pass MAX blend、pixel ownership、または別passが必要です。Rough は通常の raster pipeline で表現できるため WebGL2 の方が小さく試せます。WebGPU は bridge microbenchmark が WebGL2 より明確に良い場合、または Acrylic resident tile で compute/ping-pong が必要になった場合の候補にしてください。 |
| **C9** | **却下（記述どおりでは成立しない）** | 「deposit の pixels は CPU-known」という前提が不正確です。deposit source は Canvas2D で field を拡大し、tip mask を `destination-in` した `renderCanvas` です（`packages/engine/src/brush/mixing.ts:317-339`）。さらに rotation、scaling、opacity、source-over は Canvas2D が処理します（`packages/engine/src/brush/stamp.ts:198-237`）。下地pixelも初期 readbackなしにはCPUにありません。CPU shadow を行うなら、初期局所readback、Canvas resampling、premultiplied-alpha compositingを再実装する別rendererになり、quick candidate ではありません。 |
| **C10** | **却下** | `getImageData` には async 版がなく、`createImageBitmap` は CPU pixel buffer を返さないため、直後に `sampleRotatedCheckpoint` が必要な現在の経路を置換できません（`packages/engine/src/brush/mixing.ts:145-171`、`:184-204`）。checkpoint を粗くする実験自体は C12 に残せますが、距離を倍にすると tile も拡大し、readback面積が増えるため単純に転送量は減りません。CPU recent-deposit shadow は C9 と同じ再実装問題を持ちます。 |
| **C11** | **修正して採用** | Acrylic の長期候補として妥当です。ただし単一の「stroke-local tile」では、長いstroke、往復、過去位置への交差を保持できません。texture は固定サイズであり、移動窓では窓外へ戻った時の feedback を失います。full-layer texture、growable dirty rectangle、document tile atlas のいずれかを比較し、deposit/pickup の read-write hazard は ping-pong で処理してください。初期 Canvas2D→GPU copy と各 visible batch の GPU→Canvas2D commit も測定対象です。 |
| **C12** | **修正して採用** | 一括 parameter tuning ではなく、Rough geometry LOD、field resolution、Acrylic update cadence、checkpoint cadence を別実験にしてください。`geometryStepPx` は emission 数だけでなく repeated-contact の canonical `trialId` に入るため、表現そのものが変わります（`packages/engine/src/brush/bristle-mask.ts:93-96`）。`bands min 30` は60px presetでは約74 bandなので無関係です（`packages/engine/src/brush/bristle-mask.ts:156-160`）。直線・低圧変化区間だけstepを広げる誤差制御型LODの方が、単純な1→2変更より妥当です。 |
| **C13** | **却下して置換** | colored profile の source-in skip は既に実装済みです（`packages/engine/src/brush/bristle.ts:359-364`）。OBB は axis-aligned Canvas に収めるため中間canvasを回転して layer へ再sampleする必要があり、見た目とpixel gridを変えます。small-cost candidate ではありません。AABB浪費は、document-aligned tile 分割または空間的な sub-run 分割で減らす方が安全です。 |

---

# 追加すべき候補

## C14: stroke-start full-layer copy を bounded initial checkpoint に置換

**最優先で追加すべきCPU候補です。**

現在、mixing stroke の開始時に layer 全体と同サイズの sampling layer を作り、全pixelをコピーします（`packages/stroke/src/incremental-stroke.ts:61-63`、`:256-268`）。しかし `sourceLayer` が使われるのは最初の checkpoint 取得だけで、その後は target layer が使われます（`packages/engine/src/brush/mixing.ts:140-179`）。

最初のdeposit前に bounded checkpoint tile を確保できれば、出力を保ったまま full-document copy を除去できます。特に replay は command ごとに renderer を作り直すため（`packages/stroke/src/replay.ts:28-45`）、Undo 9 stroke ではこの全画面copyを最大9回払います。

**判定:** 採用。Rough mixing OFF には効かないが Acrylic live/replay の高優先候補。

## C15: Fine tooth の不変 hash を明示的に hoist/cache

height tile は既に cache されていますが、次は未最適化です。

- `hashSeed(strokeSeed ^ salt, trialId)` が pixel ごとに再計算される（`packages/engine/src/brush/bristle-mask.ts:348-359`）
- fixed contact の document hash も各 trial・各pixelで再計算される（`:338-344`）
- `samplePressure` が candidate pixel ごとに関数呼び出しされる（`:281-285`、`:363-374`）

trial seed は segment ごとに1回、fixed random tile は grain seed ごとに128×128 cacheできます。出力を完全一致させやすい、小さな C3 派生です。

## C16: document-aligned sparse tile / sub-run raster

長い斜線を1枚のAABBにせず、例えば128px単位のdocument tileまたは空間的sub-runに分けます。document座標のpixel gridを維持するため、OBBのような再sampleが不要です。

対象は raster loop自体より、AABB全域の ImageData allocation/upload と局所 Canvas composite です（`packages/engine/src/brush/bristle.ts:335-372`）。command増加とのtrade-offを null-stage で測定してください。

## C17: GPU→Canvas2D bridge source の比較

独立 microbenchmark に以下を追加します。

1. GPU OffscreenCanvas を直接 `drawImage`
2. `transferToImageBitmap()` → `drawImage` → `close()`
3. `createImageBitmap()` → `drawImage` → `close()`
4. Canvas2D source control

ImageBitmap は Acrylic の CPU readback代替にはなりませんが、Rough の GPU→2D bridge では実装依存のcopy削減候補です。

## C18: convex quad 専用 CPU raster

現在は各sweep quadを2 triangleに分けています（`packages/engine/src/brush/bristle-mask.ts:122-143`）。convex quad を1回のscanline traversalで処理すれば、row intersection setup、shared-edge処理、重複したfield/contact評価を減らせます。byte parity の確認は必要ですが、WASM導入前に試す価値があります。

---

# 質問1〜5への回答

## 1. 間違い・非現実的な候補と、ブラウザAPI候補

- **Worker OffscreenCanvas:** 技術的には可能ですが、現在の engine は同期的に layer を更新し、直ちに state を返します（`packages/stroke/src/incremental-stroke.ts:93-105`）。Worker化には非同期renderer契約、point/state転送、結果commitの再設計が必要で、quick optimization ではありません。
- **ImageBitmap:** GPU→Canvas2D bridge 候補としては測定価値あり。`getImageData` の代替にはなりません。
- **Canvas2D filter:** signed field、pixel-local contact、`max(alpha)` の置換には向きません。
- **`globalCompositeOperation = "lighter"`:** 加算であり `max(alpha)` ではありません。低筆圧の重複蓄積を再導入するため不適切です。現実装が max を必要とする理由は `bristle-mask.ts:53-60` に明記されています。
- **`lighten`:** premultiplied RGBA のblend modeであり、必要なalpha max oracleとして扱えません。
- **`willReadFrequently`:** 新候補にはしないでください。既に checkpoint canvas で WebKit p95が `11ms → 30ms` に悪化しています（`plans/2026-08-23-acrylic-webkit-source-backlog.md:21-22`）。
- **WebGL MAX:** 初期 PoC はRGBA8 targetを使えばよく、float blend extension riskを計画の主要懸念から外せます。

## 2. C6 WASM は現実的か、どの toolchain か

**技術的には現実的、製品統合は高コストです。**

現状は pnpm/Vite/TypeScript のみで、WASM build・asset load・Node/browser共通初期化がありません（`package.json:5-23`、`packages/engine/package.json:14-26`）。また公開rendererは同期APIなので、非同期 `fetch + instantiate` をどこで完了させるかが問題になります。

選ぶなら **Rust + `wasm32-unknown-unknown` + 最小C ABI** を推します。AssemblyScript は導入が軽い反面、SIMD制御、数値関数、長期保守でRustより利点が小さいです。ただし最初から engine に統合せず、次の kernel だけを microbenchmark してください。

- field sampling
- activation
- contact判定
- RGBA/alpha書き込み

Go条件は **kernel 2.5倍以上**かつ、C2から予測したend-to-end改善が **20%以上**。`Math.exp` 相当の差があるため byte-identical は要件にしない方が現実的です。

## 3. decision rule と閾値

構造は概ね正しいですが、次へ変更してください。

- `raster stage ≥60%` は参考値に留める
- 主判断は **同じ下流経路を残した null-stage の end-to-end差**
- Acrylic の「checkpoint readbackがp95の50%」は stage total とp95を混ぜるため使わない
- A/Bは交互順序で行い、改善率の95% CIが0を跨がないことを要求する

推奨閾値は後述の実験表にまとめます。

## 4. WebGL2 first / WebGPU first と bridge 実験

**Rough は WebGL2 first、Acrylic resident tile は WebGPU優先比較**が妥当です。

Rough は triangle raster + MAX blend であり、WebGL2のrender pipelineに自然に乗ります。WebGPU compute/storageの優位が小さく、MAX accumulationもstorage textureだけでは解決しません。

最安の bridge 実験は engine を変更しない standalone page です。

- 実fixtureから得た代表サイズを使う: 128×128、256×128、256×256、512×128程度
- WebGL2 / WebGPUで同じpremultiplied RGBA patternを描く
- GPU完了後に Canvas2D `drawImage`
- target側の小さな `getImageData` でbenchmark-only drain
- 直接canvas / transferToImageBitmap / createImageBitmapを比較
- production-likeな「各chunkで同期せず、最後だけdrain」も別測定
- 2秒、10秒、30秒で early/late を比較

WebGPUを選ぶ条件は、bridgeを含むend-to-end p95がWebGL2より **20%以上良い**か、WebGL2だけlate degradation/context問題が出る場合です。それ以外はWebGL2を選びます。

## 5. incremental / replay / Undo 構造による順位変化

順位は変わります。

1. replay は command ごとに `createIncrementalStrokeRenderer` を作成し、入力点を1点ずつ feedします（`packages/stroke/src/replay.ts:28-45`）。
2. Rough は内部で32msまたは距離閾値までbatchingされるため、live/replayとも chunk単位のcanvas allocationやraster costを繰り返します（`packages/stroke/src/incremental-stroke.ts:133-149`）。したがって C4/C7/pooling の効果はUndoで積み上がります。
3. Acrylic mixing は command ごとに full-document sampling copyを作るため、**C14 の順位がGPUより前へ上がります**（`packages/stroke/src/incremental-stroke.ts:256-268`）。
4. replay command はpixel依存で逐次実行されるため並列化できません（`packages/stroke/src/replay.ts:153-160`）。
5. GPU context、pipeline、atlas、buffer poolを renderer/command ごとに作ると Undo 9 で初期化を9回払います。runtime単位で再利用し、stroke stateとは分離してください。
6. 現行 Rough benchmark は Undo の完了時間を測らず、click後に固定100ms待って画像比較しているだけです（`work.local/benchmark-rough-production.mjs:69-76`）。E0で専用のUndo 1/9 wall timerが必要です。

---

# 最適な実験順序と go / no-go 閾値

## 共通計測条件

- WebKit primary、候補通過後に Chromium
- cold: 新規page/contextで最低5回
- warm: 同一pageで最低30 stroke
- A/B/B/A順などで熱・順序を相殺
- same-backend live/replay/redo はpixel完全一致
- CPU/GPU screening:
  - bbox edge差: 1px以内
  - coverage相対差: 1%以内
  - normalized RGBA/alpha MAE: 0.015以内
  - `abs(delta) > 0.1`: union coverageの1%以内
- 上記metricは官能承認の代替ではなく、自動 no-go gate

## 推奨順序

| 順序 | 実験 | Go | No-go |
|---:|---|---|---|
| **0** | Production fixture/harness修正。Rough/Acrylic stage count、sync charge、visible wall、end-drain、Undo 1/9を記録 | debug instrumentation ON/OFF差が3%以内、fixture反復安定 | 計測自体がp95を3%以上変える場合はtimerを粗くする |
| **1** | C2 null-stage。Roughは field/contact/raster/drawSweep/composite、Acrylicは full-layer copy/checkpoint readback/field/update uploadを分離 | 高コスト候補の null 上限が warm p95で30%以上、またはUndo 9で25%以上 | Rough mask nullが20%未満ならC6/C7/C8を停止。Acrylic checkpoint bypassが20%未満ならC9/C11を停止 |
| **2** | C14 bounded stroke-start checkpoint | byte完全一致、Acrylic coldまたはUndo totalが10%以上改善 | 5%未満なら正式化せず記録のみ |
| **3** | C15と小さなC3を1項目ずつ実施。trial seed hoist、fixed hash cache、sample buffer、必要ならcanvas pool | byte完全一致かつwarm p95/Undo totalが10%以上改善。cold maxが20%以上改善するpoolも可 | 複雑性を増やして5%未満ならrevert |
| **4** | C4 fused CPU raster + C18 quad raster。C5はfield null効果が10%以上の場合のみ | parity metric内、warm p95またはUndo 9が20%以上改善 | 官能前のmetric超過、または改善10%未満 |
| **5** | standalone GPU bridge benchmark。WebGL2/WebGPU、direct/ImageBitmapを比較 | representative sizeのbridge p95が2ms以下かつbaseline chunkの25%以下、late/early ≤1.2 | bridgeだけでbaselineの30%以上、30秒後に1.3倍以上悪化 |
| **6** | C7 Rough WebGL2 fused final RGBA | warm p95 ≤12.5msまたはCPU比25%以上改善、Undo 9も25%以上改善、16.7ms超過率が半減 | p95改善15%未満、late悪化、context instability、parity不収束 |
| **7** | C8またはC6 | WebGPUはWebGL2より20%以上良い場合。WASMはkernel 2.5倍・統合後20%以上 | 条件未達ならbackend追加を停止 |
| **8** | Acrylic cadence sweep。checkpoint distanceだけでなくtile面積、回数、最大stallを記録 | p95 15%以上改善しparity metric内、官能差なし | tile総転送量増加やspot pickup/往復差 |
| **9** | C11 Acrylic GPU-resident architecture spike | warm/late p95とUndo 9が30%以上改善、late/early ≤1.2、feedback fixture合格 | residency維持不能、毎update Canvas往復、tile移動で往復strokeが破綻 |

E1' の「C3をship regardless」は削除してください。byte-identicalでも resource poolやWASM asset ownershipを増やす変更は、測定効果がなければ採用価値がありません。

---

# 既存計画への具体的な修正指示

## Section 1: Background

- Rough の「GPU向き」という結論の前に、実 Production chunk の emission数、field cell数、AABB面積分布を E0 で測ると追記。
- 通常chunkが400pxという前提を削除し、32ms / `1.5 * brushSize` flushを記載。
- Acrylic に「mixing stroke開始時のfull-document sampling copy」を明記。checkpointだけでなく replay command単価へ効くことを記載。

## Section 3: Technology decision

- WebGL2 first の理由を Safari supportだけでなく、**Rough が通常の render pass + RGBA8 MAX blend で実装できるため**と変更。
- WebGPUは「C7より速い前提」を置かず、bridge benchmarkで20%以上優位なら選ぶとする。
- RGBA8 PoCでは `EXT_float_blend` を必要条件にしない。
- bridge sourceとして direct canvas / transferToImageBitmap / createImageBitmap を測ると追記。

## Section 4: Candidate assessment

- C1〜C18 の表に差し替え。
- 特に C14、C15、C16、C17 を追加。
- C9/C10/C13は現記述のままでは却下。
- C3を複数candidateへ分割。
- `willReadFrequently` は既検証で悪化した却下済み候補として明記。

## Section 5.2: Rough WebGL2 mapping

- 「maskだけを置換」を2段階に変更:
  1. bridge-only/constant output spike
  2. mixing OFF の mask+ink fused final RGBA spike
- 最終出力をCPU局所ink canvasへ戻すのではなく、可能ならGPU canvasからlayerへ直接1回描画。
- profileのsegment overlap、frame fallback、source-over相当をshader設計項目へ追加。
- context/pipeline/bufferはcommand単位でなくruntime単位に再利用。

## Section 5.3: Acrylic architecture

- stroke-local tile の方式を、full-layer / growable rectangle / document tile atlas の3候補に分解。
- self-crossing、長距離往復、tile外への再訪を correctness 条件へ追加。
- read/write hazard と ping-pong textureを明記。
- GPUより前のCPU候補として「最初のdeposit前にbounded checkpointを取得し、full-document source snapshotを削除」を追加。

## Section 6: Correctness

- same-backend live/replay/Undo/Redo は既存方針どおりbyte完全一致。
- CPU/GPU cross-backend gate に具体的な初期閾値を設定。
- C4/C6もGPUと同じnear-parity tierへ入れる。
- context loss がstroke/rebuild途中で起きた場合、途中からCPUへ継続するのか、commandまたはrebuildをCPUで再実行するのかを明記。後者の方が決定性を守りやすいです。

## Section 7: Measurement design

- stage timerを「純stage cost」ではなく「同期blockingがchargeされたcall」と表記。
- Canvas2DのGPU completionには標準fenceがないため、benchmark-only target readbackを **drain proxy** と明示。
- `benchmark-bristle-mask.mjs` はLab経路であること（`work.local/benchmark-bristle-mask.mjs:16-18`）、Production scriptsはWebKit固定であることを記載。
- Undo benchmarkを固定sleepではなく、history rebuild開始からvisible completionまで測るよう変更。
- stage shareだけでなくnull-stage end-to-end差をdecision inputへ追加。
- A/B順序、run数、CI、instrumentation overhead gateを追加。

## Section 8: Execution flow

現在の E0〜E3 を次へ置換してください。

```text
E0a Production baseline + measurement validation
E0b Null-stage upper bounds
E1a Bounded initial checkpoint / byte-identical CPU fixes
E1b Rough fused CPU / quad / field candidates
E2  Standalone WebGL2/WebGPU→Canvas2D bridge benchmark
E3  Rough fused GPU final-RGBA spike
E4  Acrylic cadence and resident-tile decisions
```

- E0' の両browser同時実行は、WebKit primary → 通過候補だけChromiumへ変更。
- `raster ≥60%` ruleを参考値へ降格。
- `null-mask <30%` は「下流処理を維持したstub」という条件を追加。
- Acrylicの `checkpoint readback ≥50% of p95` を、checkpoint bypass A/Bのend-to-end改善率へ変更。
- C3を「ship regardless」から「1項目ずつ10% gate」へ変更。
- bridge benchmarkをshader実装前に独立実施。
- E1はmask-onlyではなく fused final RGBA を本命に変更。

## Section 9: Deliverables

追加:

- stage countとnull-stage上限表
- representative chunk bbox/emission分布
- bridge matrix: backend × source方式 × size × early/late
- Undo 1/9 の実測開始・完了条件
- full-layer sampling copy回数・総pixel数
- GPU resource初期化回数とreuse率

## Section 10: Non-goals

追加:

- Worker化を伴うasync public renderer
- CPUによるCanvas2D resampling/compositing完全再実装
- Rough mixing ON の初期GPU fused renderer

C14 の bounded snapshot は renderer高速化そのものなので non-goal に入れないでください。

## Section 11: Known risks

追加:

- stage timerがCanvas queue flush位置を誤帰属する
- GPU context/pipelineをreplay commandごとに再生成する危険
- Acrylic resident tileがself-crossingで過去pixelを失う危険
- `transferToImageBitmap` のallocation/resource close漏れ
- OBB回転による追加resampling
- WASMの同期初期化とpackage asset配布
- CPU/GPU selectorがUndo rebuild途中で変化する危険

## Section 12 / 13: References・Resume checklist

- discussion memoをreferenceへ追加。
- `plans/2026-08-23-acrylic-webkit-source-backlog.md` の `willReadFrequently` 失敗を必読項目化。
- Resume checklist を「E0 baseline」ではなく「E0a計測妥当性 → E0b null-stage」から開始。
- GPU shader着手前にbridge benchmarkを必須gate化。

## Section 14: Planning-time conclusion

次のように弱めるべきです。

- Rough GPU化の勝算は「高い」と断定せず、**CPU rasterのnull-stage上限とGPU→Canvas2D bridgeの積で決まる**。
- Rough の最初の本実装候補は mask-only ではなく mixing OFF の fused mask+ink。
- Acrylic GPU化の前に bounded initial checkpoint でfull-document sampling copyを除去する。
- WebGPUはSafari versionではなく、WebGL2とのbridge/end-to-end比較で選ぶ。
