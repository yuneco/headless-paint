# Rough bristle の GPU 化（GPU accelerator 第2フェーズ）

作成: 2026-08-31 / ブランチ: `feature/acrylic-v2-production`（main マージ前にまとめてリリース）

前提: `plans/2026-08-30-02-00_gpu-brush-accelerator-formal.md`（Acrylic 正式化、マージ済み PR #1）、`packages/engine/docs/gpu-acceleration.md`。

## 0. 目的と非目標

- 目的: Rough bristle（`type: "bristle"`）を既存の WebGL2 accelerator に乗せ、WebKit（Safari / iPad）での batch wall を下げる。mixing ON の Rough も同時に GPU 経路にする（現状は CPU `getImageData` 依存で重い）
- 非目標: CPU 経路の見た目変更（fused raster 実験は外観差で棄却済み `fa2d7dc`）、Chromium 向け GPU、spray / 非混色 stamp、WebGPU
- 採否: [improvement-threshold-policy] に従う。複雑性が増すので **WebKit の Rough batch wall p95 −20% 未満なら不採用**（目標は −50%）

## 1. アクリルとハケは「どこまで同じか」（レビュー用の現状分析）

概念: 「アクリル = 毛束1・かすれなし・mask 恒等のハケ」。実態を層ごとに見ると:

| 層 | Acrylic (stamp+mixing) | Rough (bristle) | 揃っている? |
|---|---|---|---|
| 入力 → 点列補間 | centripetal 補間 + distance/time scheduler | 同じ補間、distance emission のみ（1px） | ◯ 共通コード |
| batch 境界 | pointer batch ごと | 32ms または 1.5×lineWidth ごとに決定的 flush | △ 方針が違う（ハケは入力境界非依存にした経緯あり） |
| **mask 生成** | tip texture を dab 位置に点置き（point sprite） | 掃引 quad（sweep）に符号付き dropout field + 紙目 + 反復接触を評価し MAX 蓄積 | **× 別物**。ここが両ブラシの本質的差分 |
| **材料（色）** | `mixing.ts` の連続 RGBA field（pickup/restore/diffusion、checkpoint） | **同じ `mixing.ts`** をそのまま使用 | ◯ コード共通（型 `BrushMixing` も同一） |
| 合成 | premultiplied `mask × material` を accum へ source-over | ink（profile atlas を sweep）に mask を destination-in、色（または field）を source-in → layer へ source-over | ◯ 結果の形は同じ（mask × material → accum） |
| layer への書き戻し | GPU: batch ごとに dirty rect pack + ImageBitmap 1 枚 | CPU: run ごとに OffscreenCanvas 確保 + `drawImage` 1 回 | GPU 化で ◯ に揃う |
| 常駐 / snapshot / cancel / context loss / 決定性 | GPU surface 契約 | 未対応（CPU のみ） | GPU 化で ◯ に揃う（契約は brush 非依存） |

結論:

- 「材料 → accum → layer」より後ろは**概念どおり共通**で、GPU 実装もそのまま共有できる（accum・field strip・snapshot・commit packing・residency・routing・context loss。コード量で GPU 側の約 7 割）
- **mask 生成だけは CPU でも GPU でも別実装のまま**になる。アクリルは「tip 画像を置く」、ハケは「掃引面を field で削る」で、同じ数式の特殊ケースにはなっていない。CPU 側をひとつにするには stamp を sweep 化するか bristle を dab 化する必要があり、どちらも外観が変わる（過去の fused 実験で 4% の被覆差 → 棄却）。**CPU 側の統合はやらない**
- 性能面: 共有部分（commit / snapshot / 常駐）は同じ数値になる。差が出るのは mask pass の重さで、ハケは chunk あたり field 評価 + 掃引 quad 描画が乗る。現状 Rough は WebKit で Call p50/p95 4/16ms（mixing OFF）。Acrylic の実績（8/11 → 2/2ms）から、ハケも p95 一桁 ms が目標
- mixing ON の Rough は現在 CPU checkpoint の `getImageData` を踏む。GPU 化後は Acrylic と同じく readback ゼロになり、**初めて実用的な速度になる**（ここは統合の実利が最も大きい）

## 2. 設計（GPU 側の plug-in）

### 2.1 経路振り分け

`incremental-stroke.ts` の `gpuStrokeEligible` を「stamp+mixing」から「stamp+mixing または bristle」に拡張する。bristle は mixing OFF でも GPU 適格（field は恒等色で初期化）。他条件（source-over・alphaLocked なし・branch 数・surface 取得）は共通。bristle の 32ms / 1.5B flush は維持し、flush ごとに `commitToLayer` を呼ぶ。

### 2.2 GpuStrokeSurface への追加（内部 IF、公開しない）

```ts
// chunk = bristle の 1 run（updateDistancePx で区切られた点列）
interface GpuBristleChunk {
  readonly segments: readonly GpuSweepSegment[]; // 掃引 quad（from/to, 幅, overlap, frame）
  readonly maskField: Float32Array;              // createBristleMaskField の出力（samples × bands）
  readonly maskFieldColumns: number;
  readonly maskFieldRows: number;
  readonly profileAtlas: OffscreenCanvas;         // getBristleProfileAtlas
  readonly grain: GpuGrainParams;                 // tooth tile texture + seed + hardness/amount
  readonly bboxRect: Rect;
}
surface.pushBristleChunk(chunk: GpuBristleChunk): void;
```

パス構成（chunk ごと）:

1. **mask pass**: chunk-local の RGBA8 texture（bbox サイズ、再利用）へ掃引 quad を描画。fragment は `maskField` texture を bilinear サンプル → `activationFromDistance(depositHardness)` → 紙目（tooth tile texture, document 空間）と反復接触（`hashSeed` を uint 演算で移植）→ `gl.blendEquation(MAX)` で蓄積
2. **ink pass**: profile atlas texture を segment ごとに source-over で同じサイズの ink texture へ（drawSweep 相当。overlap / frame fallback は CPU と同じ式）
3. **composite pass**: `ink.a × mask.a × material(field bilinear または style.color)` を accum へ source-over。ここから先は Acrylic と同じ（dirty rect → commit packing）

`maskField` の生成（`createBristleMaskField`）は **CPU に残す**。9k cell 程度で軽く（Chromium 内訳 23%）、CPU と同じ Float32 を GPU が bilinear するので parity が取りやすい。GPU に移すのは重い部分（raster 28% + layerDraw 43% + canvas 確保）。

### 2.3 決定性と parity

- 同一 backend 内: live / replay / undo / redo は byte 一致（既存契約）
- CPU vs GPU: Tier B（既存定義）。mask は scanline vs GPU raster の被覆差が出るので byte 一致は狙わない。紙目・反復接触の hash は整数演算を移植し一致させる
- parity fixture に `rough bristle`（mixing OFF / ON、Expand あり）を追加

### 2.4 残す CPU 経路

CPU 実装は変更しない（Chromium / Node / context loss の再実行に使う）。

## 3. 作業 Phase

### Phase 0: contract-check spike（1〜2 日、専用 branch `experiment/bristle-gpu`）

mask pass + ink pass を最小実装し、WebKit で Rough batch wall を計測。**Go 条件: p95 −20% 以上、目標 −50%**。parity は Tier B 見込みが立つこと。未達なら Hold に戻し理由を記録して終了。

### Phase 1: API 設計・ドキュメント

- `gpu-acceleration.md`: 適格条件に bristle を追加、描画モデルに mask / ink / composite pass、bristle の maskField を CPU 生成する理由、parity の扱い
- `brush-api.md`: bristle の `accelerator` 転送
- 公開 API 追加なし（`BrushAccelerator` / options / react `gpuBackend` は不変）

### Phase 2: 利用イメージレビュー

アプリ側は変更不要（`usePaintEngine({ gpuBackend })` のまま Rough も GPU）。デバッグパネルの Engine 表示はそのまま。レビュー対象は本ファイル §1・§2。

### Phase 3: 実装（codex 委譲）

1. surface に `pushBristleChunk` + 3 pass、shader-sources に bristle 用 shader、gl-resources に mask/ink texture・tooth tile texture
2. `bristle.ts` の `renderSweepRun` を GPU surface があれば chunk を push する分岐に（CPU 経路は現状維持）
3. `incremental-stroke.ts` の eligibility と bristle flush → commit
4. テスト: gpu-stroke-surface（bristle chunk / MAX 蓄積 / cancel）、parity（rough OFF / ON / Expand）、gpu-residency（bristle undo/redo）
5. `tools/bench` に Rough runner（`work.local/benchmark-rough-production-capture.mjs` を移植）

### Phase 4: アーキテクトレビュー + 実機

Mac WebKit / STP / iPad で計測、stall・undo/redo・ジェスチャの再確認（Acrylic と同じ手順）。

## 4. ペンディング / リスク

- GLSL の hash 移植で CPU と bit 一致しない場合、反復接触の点分布が変わる → parity が Tier B を超えるなら hash 結果を CPU で事前計算し texture で渡す案に切替
- chunk-local texture のサイズは lineWidth と chunk 長で変動 → 最大サイズで確保し realloc しない（Acrylic と同方針）
- Rough の 32ms flush と GPU commit の相性（commit 回数が減るので有利な見込み。要計測）

## 5. Phase 0 計測記録

環境: Mac WebKit（Playwright）、`tools/bench/benchmark-rough-capture.mjs endpoints`、Rough 60px、mixing OFF、REPEATS=4、コミット `144d260`（GPU 化前）。

| backend | Call p50 / p95 / max (ms) | batch wall p95 / max | undo1 / undo9 (ms) |
|---|---|---|---|
| cpu（ベースライン） | 4-5 / 17-23 / 73 | 14-20 / 73 | 118 / 195 |

注: runner の undo 計測で `NotFoundError` が複数出るが timing は取れている（runner 側の locator 問題、要確認）。

### 5.1 spike 途中経過（2026-08-31、コミット `b4faa1a`）

- 初回計測で GPU と CPU が同値だった原因: mixing OFF の bristle は sampling layer を作らないため常駐ミス時に `beginStroke` へ source canvas が渡らず `false` → 毎 batch CPU 経路 + `residencyInvalidated`。`b4faa1a` で layer 自身を upload 元にして解消（undo 後 warmUp も bristle を対象に）
- 計測ランナー `benchmark-rough-capture.mjs` の stageSnapshot は以前から空（Call / batch wall / undo は有効）。stage 内訳は `tools/bench/results/probe6.mjs`（pen PointerEvent を直接 dispatch）で取得
- **mixing OFF（Mac WebKit、1 stroke 150 点 / 30 chunk）**: CPU appendCommitted 74ms（maskField 22 / maskRaster 28 / maskUpload 9）→ GPU 110ms（maskField 23 / gpuBristleInk 57 / gpuCommit 36）。ランナーの p95 は 14-18 vs 15-20ms で横ばい。Chromium attribution では 3 pass 合計 ≈8ms/31 chunk なので WebKit の「ink 57ms」は GPU 同期待ちの付け替え（疑い: chunk ごとに寸法が変わる maskField texture の `texImage2D` 再確保）。ただし commit 床 1.2ms × chunk と CPU 側 maskField 23ms が残るため、**mixing OFF の Mac では最良でも CPU と同等**の見込み
- **mixing ON（同条件）**: CPU 377ms（maskUpload 149 + checkpointReadback 149 = WebKit 同期）→ GPU 242ms（−36%）。GPU 側の残りは `gpuFieldUpdate` 164ms/182 回（run ごとの field 更新、0.9ms/回）

### 5.2 GL オーバーヘッド削減後（コミット `d298dc5`）

probe6（1 stroke 150 点、WebKit）:

| 条件 | CPU | GPU | 備考 |
|---|---|---|---|
| mixing OFF（31 chunk） | appendCommitted 77ms（maskField 26 / maskRaster 33 / maskUpload 7） | appendCommitted 45 + gpuCommit 67 = 112ms（3 pass 合計 4ms、maskField 25） | commit 2.2ms/flush = 3 pass の GPU 実行待ち + ImageBitmap |
| mixing ON（210 run / 31 flush） | 423ms（maskUpload 170 + checkpointReadback 177） | 73 + gpuCommit 193 = 266ms（**−37%**、gpuFieldUpdate 164→6ms） | commit 6.2ms/flush = 1 flush に ≈27 render pass（7 run × 3 + field 6）の実行待ち |

ランナー（`benchmark-rough-capture.mjs`、mixing OFF、REPEATS=4）: Call p95 CPU 16-22 → GPU 13-22ms、batch wall p95 14-21 → 12-17ms、undo1 115 → 128ms。**mixing OFF は Mac では誤差域**。

所見: CPU 側の仕事は消えたが、WebKit(Metal) では render pass 1 本あたり ≈0.2-0.3ms の GPU 側固定費があり、chunk × 3 pass の設計だと pass 本数が支配的。次の一手は mask / ink を同一 FBO に置いて pass を 3→2 にする（mixing ON で効く）。mixing OFF は 1 flush = 1 chunk なので pass 統合の余地が小さく、Mac では CPU 同等が上限。iPad（CPU raster が遅い）で逆転する可能性は未計測。

### 5.3 mask+ink 同一 pass 化後（コミット `0792080`、spike 到達点）

probe6（1 stroke 150 点、WebKit）:

| 条件 | CPU | GPU | 差 |
|---|---|---|---|
| mixing OFF（31 chunk） | 85ms | 53 + gpuCommit 41 = 94ms | 同等 |
| mixing ON（210 run） | 411ms | 89 + gpuCommit 153 = 242ms | **−41%** |

ランナー（mixing OFF、REPEATS=4）: Call p95 CPU 16-22 → GPU 13-19ms、batch wall p95 14-21 → 12-16ms（−15% 前後、誤差域）、undo1 115 → 130ms。

### 5.4 spike の判定材料

- **mixing ON の Rough**: Go 条件（−20%）を満たす（−41%）。目標 −50% には未達。残る支配項は flush ごとの render pass 数（run × 2 + field 更新）で、field 更新を挟まない run の mask/ink を 1 pass にまとめる queue 化（surface 側）で更に削れる見込み
- **mixing OFF の Rough**: Mac では CPU 同等（CPU raster が速く、GPU 側は pass 固定費 + commit 床で相殺）。Go 条件未達。ただし iPad は CPU raster が相対的に遅いため逆転しうる（未計測。次の実機確認で判断）
- undo が GPU で +15ms（rebuild replay の GPU 再 upload）。Acrylic と同じ性質で許容範囲だが要観察
- 見た目の parity: §5.5 に記録

### 5.5 見た目の parity（CPU vs GPU、WebKit）

- mask 単体（`bristle-pass.test.ts`、同一 chunk を CPU raster と GPU mask pass で描画）: 被覆率差 0.0065pt、alpha MAE 0.00018、|Δ|>0.1 0.013%。残差は三角形の edge rule
- アプリ経路（ランナー fixture、layer の最終画素をスクショ比較、`tools/bench/results/imgdiff.mjs`）: |Δ|>25/255 の画素 0.67%（ink 画素の 2.1%）。定圧ストローク 0.4%、自己交差ループ 3.4%（点描分布の差）。拡大目視でかすれ・紙目の位置は一致
- 一度「GPU がベタ塗り」に見えたのは描画途中（プレビュー状態）のスクショだった。誤報

### 5.6 spike の結論（Mac、2026-08-31）

| 条件 | 結果 | Go 条件（−20%） |
|---|---|---|
| Rough mixing ON | stroke 411 → 242ms（−41%）、readback ゼロ | **達成** |
| Rough mixing OFF | CPU 同等（p95 −15% 前後、誤差域） | 未達（Mac）。iPad は未計測 |

- 見た目は Tier B 相当で一致
- 残る改善余地: flush 内で field 更新を挟まない run の mask/ink をまとめて 1 pass にする surface 側 queue 化（mixing ON でさらに削減の見込み）。iPad での mixing OFF 逆転の確認
- ペンディング: mixing ON の composite における field UV の契約（現状は chunk bbox 全体への bilinear 近似。CPU は segment ごとの atlas 変換）。正式化時に定義が必要

### 5.7 表現調整の探索（ユーザー方針 2026-08-31）

表現優先で作ってきた Rough の要素のうち価値の薄い部分は CPU 側含め削る/調整して良い。毛束表現は最終パラメータで大部分潰れており候補。官能評価は S 字 + 実ストローク（comb-06 fixture）で行う。順番: A) replay の中間 commit 廃止 → B) field 反映粒度の flush 化 + run の pass 統合 → C) 毛束 dropout field の簡略化（A/B 画像で官能判定）。

- **A 結果（`cd81832`）**: replay/rebuild を final commit 化。undo 5本（mixing ON, webgl2）2058 → 1872ms（−9%）。ImageBitmap は消えたが GPU pass 実行は replay でも同数走り最終同期で待つため、undo の支配項も pass 数。B が本丸と判明。参考: 同条件 CPU undo 2356ms（GPU は −21%）

### 5.8 B: field 反映粒度 perFlush の結果（`68e9936`、実験フラグ `?gpuBristleField=perFlush`）

性能（WebKit、mixing ON、1 stroke 150 点）:

| 指標 | perRun | perFlush |
|---|---|---|
| stroke（appendCommitted + gpuCommit） | 266ms | **99ms（−63%）** |
| undo 5 本合計 | 1959ms | **931ms（−52%）** |
| pass 数 / flush | ≈20 | 3〜4 |

見た目（下地の赤帯 3 本 + 混色ストローク、comb-06 fixture）: perFlush は **pickup が明らかに弱い**。粒度低下に加え、flush 集約が「最新 checkpoint × 最後の geometry × 合計距離」で拾うため、flush 途中に横切った下地色を取り込めていない疑い。表現として許容不可の見込み → 集約方法の改善（run ごとの geometry で checkpoint を積分しつつ pass はまとめる）が次の課題。ユーザー判定待ち。

### 5.9 pickup 積分修正後（`80266d5`）

- perFlush: stroke 185ms（perRun 289ms 比 −36%）、undo 5 本 1063ms（−46%）、pass 3〜4/flush + run ごとの checkpoint texture copy
- 見た目: pickup 量は perRun 相当に回復。残差は **flush 単位の色の段差**（composite が flush 開始時点の field を一律参照するため、色が ~90px ごとに階段状に変わる。perRun は滑らか）
- 次の一手: composite で field の flush 前後 2 状態を run 位置で補間（pass 数不変のまま段差を平滑化）

### 5.10 B 最終形（`10eced7`+`b9342ac`: composite で mix(F0,F1,距離重み) 補間）

- 決定性差し戻し 1 回: beginStroke の texture swap 偶奇で F0 参照が live/replay で異なった（`b9342ac` で修正、回帰テスト追加、552 tests green）
- 性能（WebKit、mixing ON、1 stroke 150 点）: perRun 270ms → **perFlush 102ms（−62%）**。undo 5 本 1976 → **1079ms（−45%）**（undo 残差は再 upload とベース replay コスト）
- 見た目: pickup 量 perRun 相当 + 段差解消（§5.11 の画像参照）。全画面画素差は ink の 15%（点描分布と補間の残差）→ ユーザー官能判定待ち

### 5.11 決定: mixing 意味論を perFlush で CPU/GPU 統一（ユーザー決定 2026-08-31）

- perFlush の見た目はキャプチャ判定で許容（「悪くない」）。Bristle はアプリ未使用のため表現変更は問題なし
- CPU bristle mixing も perFlush 意味論へ移植（速くなる方向の統一。checkpoint getImageData / field 転写が flush 単位に減り CPU 411ms → 150ms 前後の見込み）。stamp（Acrylic）は変更しない
- GPU default を perFlush 化（`?gpuBristleField=perRun` は比較用に残す）
- cross-backend（CPU vs GPU）は Tier B を parity テストで保証。過去ドキュメントの replay 結果が微変する点はリリースノート事項

### 5.12 CPU/GPU 統一の結果（`2fce9bd`〜`91f5441`、C の戻り点）

mixing ON、1 stroke 150 点、WebKit / Chromium:

| 経路 | 統一前 | 統一後 | 備考 |
|---|---|---|---|
| WebKit GPU（Safari 実経路） | 270ms | **109ms** | default perFlush |
| Chromium CPU（Chromium 実経路） | 98ms | 104ms | 同等（誤差域） |
| WebKit CPU（context loss 復旧のみ） | 411ms | 635ms | **残課題**: JS 仕事は同等（Chromium 比較で確認）だが WebKit の Canvas2D 同期回数が増加。実利用面は僅少のため保留 |

- cross-backend Tier B: alpha MAE 0 / RGB MAE 0.0013 / |Δ|>0.1 0.08% で全閾値内。見た目も目視一致
- checkpoint 二重カウント（61→90）は修正済み
- **C 棄却時の戻り点 = `91f5441`**（557 tests green）。C は子ブランチ `experiment/bristle-mask-simplify` で実施
