# GPU Acceleration（BrushAccelerator）

## 概要

`BrushAccelerator` は、mixing 有効な stamp ブラシ（Acrylic 系）の描画を WebGL2 で行う engine 内部の加速器である。公開 `Layer` は Canvas2D のままで、加速器は stroke 中の中間状態（描画結果 accum・混色 field・pickup 用 checkpoint）を GPU に常駐させ、pointer batch ごとに結果を `layer.ctx` へ書き戻す（commit）。外部から見た契約（`Layer` / `StrokeCommand` / History / 永続化形式）は変わらない。

### 背景

WebKit（Safari / iPad）では Canvas2D と GPU プロセスの往復（`getImageData`、書き換えた小 canvas の `drawImage`）が 1 回 ≈1〜1.5ms の同期待ちになる。混色 stamp は checkpoint ごとに pickup のため画素を読み戻すため、この往復回数が live 描画と Undo replay の床になっていた。加速器は pickup を含む全工程を GPU 内で完結させ、CPU への readback をゼロにする。

実測（WebKit、2K、backlog fixture 1920 samples）: live dispatch p50/p95 8/12ms → 2/2ms、Undo replay（長 stroke 2 本）2710ms → 903ms。radial 8 では 28/45 → 3/4ms、19137 → 2422ms。4K では 16/19 → 1/2ms。Chromium は CPU 経路が元から速い（≈1ms）ため加速器は使わない。

### 責務分離

- **engine**: 加速器の生成・破棄、描画関数への注入 IF、常駐無効化の内部 hook
- **stroke**: `createIncrementalStrokeRenderer` / `createStrokeRuntime` の config で加速器を受け取り、stroke 単位で有効化・commit・終了を制御
- **react / apps**: 加速器の生成タイミングと backend 選択（UI・永続化）

## createBrushAccelerator

```typescript
function createBrushAccelerator(
  options?: BrushAcceleratorOptions,
): BrushAccelerator | null;

type BrushAcceleratorBackend = "auto" | "webgl2" | "cpu";

interface BrushAcceleratorOptions {
  /** 既定 "auto": WebKit 系ブラウザかつ WebGL2 が利用可能なときのみ有効。"cpu" は常に null */
  readonly backend?: BrushAcceleratorBackend;
  /** GPU 経路を使う Expand branch 数の上限。既定 64。超過する stroke は CPU 経路 */
  readonly maxBranches?: number;
  /** accum を stroke 間で常駐させる。既定 true */
  readonly resident?: boolean;
  /** デバッグ用。commit の書き戻し方式。既定 "bitmap"（pass ごとに ImageBitmap 1 枚を経由。blit 後に fence を置き、完了をポーリングしてから転写する）。"direct" は WebGL canvas を rect ごとに同期で直接 drawImage する */
  readonly commitMode?: "bitmap" | "direct";
}

interface BrushAccelerator {
  readonly backend: "webgl2";
  /** surface 確保と layer 内容の upload を先行して行う。ブラシ選択時に呼ぶと初回 stroke の初期化コストを隠せる */
  warmUp(layer: Layer): void;
  /** engine API 以外で layer.ctx に直接描いた後に呼ぶ。常駐している accum を無効化する */
  invalidate(layer: Layer): void;
  /** GL リソースを解放する。以降この加速器は使えない */
  dispose(): void;
}
```

- `null` を返す条件: `backend: "cpu"`、`"auto"` で WebKit 系でない、WebGL2 context が取得できない（Node / headless を含む）。呼び出し側は `null` をそのまま描画関数へ渡してよく、その場合は従来の CPU 経路になる
- `"auto"` の判定は User-Agent による（WebKit 系のみ）。Chromium で使いたい場合は `"webgl2"` を明示する。backend の指定値は engine / react / アプリ設定で共通に `"auto" | "webgl2" | "cpu"` を使う
- 加速器はグローバル singleton ではなく、明示的に生成して注入する runtime resource。通常はアプリで 1 つ生成し、全レイヤーで共有する

### resolveBrushAcceleratorBackend

生成せずに「どの backend になるか」と理由だけを得る。デバッグ UI の表示や、`createBrushAccelerator` の判定の一元化に使う。

```typescript
function resolveBrushAcceleratorBackend(
  options?: BrushAcceleratorOptions,
  env?: { readonly userAgent?: string; readonly webgl2Available?: () => boolean },
): BrushAcceleratorResolution;

interface BrushAcceleratorResolution {
  readonly backend: "webgl2" | "cpu";
  readonly reason: string; // "auto: webkit" | "auto: not webkit" | "webgl2: unavailable" | "webgl2: setting" | "cpu: setting"
}
```

`env` を省略すると `navigator.userAgent` と WebGL2 の取得試行で判定する。テストでは `env` を注入する。

### 注入点

省略時・`null` 時は CPU 経路。core（engine + stroke）を直接使うアプリは次の 3 箇所に同じ加速器を渡す。

```typescript
// engine（低レベル。通常は直接呼ばない）
renderBrushStroke(layer, points, style, overlapCount?, state?, sourceLayer?, accelerator?)
appendToCommittedLayer(layer, points, style, expand, overlapCount?, state?, sourceLayer?, alphaLocked?, accelerator?)
// stroke（core 利用者が渡す 3 箇所）
createStrokeRuntime({ ...deps, accelerator })              // live 描画（StrokeRuntimeDeps）
replayCommand(layer, command, registry, { accelerator })   // command の再生（ReplayOptions）
executeHistoryOp(op, state, { ...deps, accelerator })      // Undo / Redo の history rebuild（ExecutorDeps）
```

core 利用者の最小手順:

```typescript
const accelerator = createBrushAccelerator({ backend: settings.engineBackend }); // null なら CPU
const runtime = createStrokeRuntime({ ...deps, accelerator });
// Undo / Redo / replay にも同じ accelerator を渡す
// 任意: mixing stamp を選んだときに accelerator?.warmUp(activeLayer) で初回 stroke の初期化を隠す
// 終了時: accelerator?.dispose()
```

react（`usePaintEngine`）はこれを内包する。`gpuBackend?: "auto" | "webgl2" | "cpu"`（既定 `"auto"`）を渡すだけで、加速器の生成・runtime / replay への注入・mixing stamp 選択時と Undo / Redo 直後（次 frame）の `warmUp`・unmount 時の `dispose` を hook が行う。Undo / Redo は通常 checkpoint 復元（CPU 書き込み）で終わるため常駐が無効化されるが、直後の warmUp で次の stroke 開始前に再 upload を済ませる。現在の backend と auto の判定理由は `engine.gpuBackend` / `engine.gpuBackendReason` で取得でき、デバッグ UI で表示できる。

詳細は [brush-api.md](./brush-api.md)、[incremental-render-api.md](./incremental-render-api.md)、stroke の docs を参照。

## GPU 経路の適格条件

stroke 開始時に次をすべて満たすときだけ GPU 経路になる。満たさない stroke は同じ入力で CPU 経路で描かれる（自動、通知なし）。

- ブラシが `stamp` で `mixing` が有効（`isBrushMixingActive`）、または `bristle`（Rough bristle。`mixing` の有無を問わない）
- `compositeOperation` が `source-over`
- `alphaLocked` でない
- Expand の branch 数（`compiledExpand.outputCount`）が `maxBranches` 以下
- 加速器が有効で surface を確保できた（context lost でない）

spray・非混色 stamp は対象外（CPU 経路のみ）。

## 描画モデル

- **accum**: layer 同寸の RGBA8 texture（premultiplied）。stroke 開始時に layer 内容を upload（常駐 hit 時は省略）
- **dab**: instanced draw。fragment = tip mask × 混色 field（bilinear）。`source-over`（premultiplied）で accum へ蓄積。Expand は branch ごとの instance を branch 0 → 1 → … の順に flush し、CPU 経路と同じ重なり順を保つ
- **混色 field**: `fieldColumns × fieldRows` を branch 数分縦に並べた strip texture（RGBA16F。無ければ RGBA8）。`updateDistancePx` ごとに pickup / restore / diffusion を全 branch 1 pass で更新（式は CPU の `advanceMaterialField` と同一）
- checkpoint の補間は CPU / GPU 共通で alpha 重み付き（premultiplied 補間 → unpremultiply）とし、透明画素は色に寄与しない
- **checkpoint snapshot**: `checkpointDistancePx` ごとに、accum の局所 tile を branch 別の snapshot texture へ GPU 内で blit する。tile の中心は CPU の `captureCheckpoint` と同じだが、寸法は stroke 中に変わらないよう筆圧による stampSize の上限（`lineWidth × (1 + pressureDynamics.size)`）から決め、32px 単位で確保して縮小しない（sampling 位置は CPU と同一で、tile が大きい分は読まれない）。field の sampling 元はこの snapshot であり、CPU 経路の「直近 checkpoint 時点の tile を読む」時間基準を再現する
- **commit**: pointer batch ごとに 1 回、branch 別 dirty rect を commit canvas（1024²）へ敷き詰めて一括 blit し、`transferToImageBitmap()` で得た 1 枚の ImageBitmap から rect ごとに `layer.ctx.drawImage` で書き戻す（WebGL canvas を drawImage の source にする回数を pass あたり 1 回に抑える。iOS WebKit では source 化ごとに snapshot copy が走るため）。dab ごとや点ごとには書き戻さない
- **readback なし**: 上記のどこにも `getImageData` / `readPixels` は無く、GPU stroke 中は `layer.ctx` を drawImage の source にもしない（iOS WebKit では GPU-backed canvas の source 化ごとに snapshot copy が走るため）
- **commit の非同期化**: WebKit の `transferToImageBitmap()` は queue 済みの blit 完了を待たない（`gl.flush` では不十分）。同期に `gl.finish()` を使うと GPU パイプラインの drain（Mac WebKit で 1 commit ≈ 1.5ms、1 stroke で 40〜60ms）を main thread が待つため、bitmap mode の commit は「tiles を commit canvas へ blit → `fenceSync` を置いて即返る（pending）」とし、stroke runtime が `setTimeout(0)` でポーリングして `clientWaitSync(fence, 0, 0)` が signaled になった時点で `transferToImageBitmap()` → layer へ描く（`clientWaitSync` の timeout 上限は WebKit / Chromium とも 0 で、待つことはできない）。転写が済むと runtime は `requestRender` を呼ぶ。表示は最大でもポーリング間隔ぶん（数 ms）遅れるだけ
- **同期 drain**: pending がある状態で次の commit・`endStroke`・`cancelStroke`・undo 復元・`dispose`・context lost に入るときは `gl.finish()` で drain してから転写する。stroke 終了時点の layer は同期 commit と byte 一致し、決定性の契約は変わらない。direct mode は従来どおり同期
- **全画面 texture は accum と base の 2 枚**（layer 同寸 RGBA8。2K で 16MB × 2、4K で 64MB × 2）。base は stroke 開始時の accum 複製で、cancel の復元と undo-1（後述）に使う

### Rough bristle

stroke 側が bristle の入力を **flush** 単位（点列の先頭から 32ms 経過、または移動距離が `lineWidth × 1.5` に達した時点。`packages/stroke/src/incremental-stroke.ts` の `shouldFlushBristleBatch`）でまとめて engine に渡し、engine は flush ごとに chunk（確定した中心線周辺の bbox）を GPU surface へ積む。1 chunk は chunk-local の atlas 上で 3 pass で描かれ、最後に accum へ合成される。

| pass | 内容 |
|---|---|
| mask | 掃引 quad を描き、fragment ごとに面掠れ（simple dropout mask: broad value noise 1 octave − 筆圧閾値。CPU と同一式を画素評価）と document 座標固定の紙目接触を評価して alpha を得る。quad の頂点属性は `(distance, crossPx ∈ [−lineWidth/2, +lineWidth/2])` と筆圧 |
| ink | profile atlas（seed 固定の 1D 毛束断面）を quad に沿って描く |
| composite | `mask × ink × material` を premultiplied で accum に `source-over`。material は混色 OFF なら `uColor`、混色 ON なら material field |

- **混色（perFlush 意味論）**: material field は flush 単位で進める（stamp の `updateDistancePx` ごとではない）。順序は「flush 内の全 run の pickup / restore を field に適用 → その field（F1）で composite → composite 後に diffusion（最大 1 pass 相当）を掛けて次の flush へ持ち越す」。checkpoint は run（field 更新 1 回分の区間）ごとに**位置を指定**するが、同一 flush 内の pickup が読む画素は該当矩形の **flush 開始時点の accum** であり、run の描画結果は同じ flush 内の後続 pickup には反映されない。画像として次の flush へコピー保持するのは branch ごとに最後に指定された checkpoint だけ。composite は flush 開始時の field（F0）と F1 を距離重みで mix する。重みは run の開始値 `w0 = runStartDistance / totalDistance` と終了値 `w1 = runEndDistance / totalDistance` を run 内の進行率で線形補間する（GPU は run geometry の local.x から進行率を得る。CPU は run 始点→終点の直線グラデーションで近似する。補間の省略判定は CPU が `max|F1 − F0| × |w1 − w0| < 1/255`（flush ごとに field 差を 1 回走査）、GPU が `|w1 − w0| < 1/255`。どちらも省略時の出力差は 1/255 以下）。CPU 経路も同じ意味論（`endField` は diffusion 前）なので、flush の切り方（32ms / 1.5×lineWidth）は描画結果の一部であり、replay で flush を束ねたり広げたりしてはならない
- **composite の field 参照**: field 更新 pass は run geometry（center / angle / sampleSize）で回転した正方形として checkpoint を読む。composite は同じ geometry の逆変換 `R(-angle) · (documentPosition − center) / sampleSize + 0.5` を clamp して field を読む。F0 / F1 とも現在の run の local frame で参照する
- 混色 OFF では field 更新 pass と checkpoint snapshot は走らない
- CPU 側での mask の事前生成・texture upload は無い（dropout mask は shader 内で評価）。profile atlas と紙目 tile は chunk が同じオブジェクトを参照している間は再 upload しない（差し替わったときだけ upload）

## 常駐（residency）と無効化の契約

`resident: true`（既定）のとき、commit 後の accum は「layer と同内容」として次の stroke でも再利用され、stroke 開始時の upload（2K で 16MB、4K で 64MB）を省略する。常駐は直近 1 layer のみ。

accum と layer の同一性が崩れる操作は engine / stroke の API が内部で自動的に無効化する:

- engine: `clearLayer`、`copyLayerPixels`、`setPixel`、`drawLine` / `drawCircle` / `drawPath` / `drawVariableWidthPath`、CPU 経路のブラシ描画、`mergeLayerDown` 系、`transformLayer`、`wrapShift`
- stroke: 非 GPU stroke の commit、checkpoint 復元、layer を書き換える command executor。Undo / Redo の history rebuild は一律には無効化せず、rebuild 中の最後の書き込みが GPU stroke の commit なら常駐を維持する（checkpoint 復元や CPU 書き込みで終わった場合、rebuild 失敗時は無効化）

**engine / stroke の API を経由せずに `layer.ctx` へ直接描いた場合は、呼び出し側が `accelerator.invalidate(layer)` を呼ぶ必要がある**。呼ばないと次の GPU stroke が古い accum の上に描かれる。

## undo-1 スナップショット

GPU stroke の終了時、stroke 開始前の accum（base texture）を **直前 1 手ぶん**だけ保持し、その stroke の Undo を history rebuild なしで復元する（WebKit で 355ms → 28ms 級）。2 手目以降の Undo と Redo は従来どおり history rebuild。保持は加速器あたり 1 件（次の GPU stroke 開始で置き換わる）。

契約は stroke パッケージの `gpu-undo-cache.ts`（structural bridge。公開 API ではない）が仲介する:

1. `createStrokeRuntime` が stroke 確定時に `retainGpuUndo(accelerator, layer, command)` で **確定した `StrokeCommand` オブジェクトを token として**登録する
2. `pushCommand` が `bindGpuUndoHistory` で「その command が history の末尾に入った index と `commands` 配列（参照）」を snapshot に結び付ける。push された command が登録 token と別オブジェクトなら結び付けられず、その stroke の undo-1 は使えない
3. `executeHistoryOp("undo")` は対象 command が `stroke` のとき `restoreUndoSnapshot(layer, currentIndex, commands)` を試み、hit なら rebuild を省略する。判定は index と **`commands` 配列の参照同一性**、layer インスタンスと寸法、加速器と surface の同一性。miss は通常の rebuild へ fallback する（試行 1 回で snapshot は消費される）。同一 backend・同一描画条件なら hit / miss の結果は byte 一致。context lost や dispose 後の rebuild は CPU 経路になり、Tier B の範囲で差が出る
4. 非 GPU の commit、checkpoint 復元、`invalidate`、rebuild 開始は snapshot を破棄する

**呼び出し側の義務**: (a) runtime が確定した command オブジェクトをそのまま history に push する（DTO 化・クローン・再生成すると token が一致しない）、(b) `HistoryState.commands` 配列を複製しない（`[...commands]` は参照が変わり miss になる）、(c) runtime と executor に同じ accelerator と同じ Layer インスタンスを渡す、(d) Undo は `executeHistoryOp` 経由で行う。どれかが崩れると結果は正しいまま undo-1 だけが静かに無効化される。`createIncrementalStrokeRenderer` を直接使う低レベル利用では登録は行われない。react の `usePaintEngine` はこの契約を守る（`packages/react/docs/INTERNALS.md`）。

## 決定性と parity

- **同一 backend**: live / incremental / replay / Undo / Redo は入力点列が同じなら pixel 完全一致（全処理が GPU コマンド順で決まり、時間や event 配送に依存しない）。テストで保証する
- **CPU 経路との差**: raster 規則・浮動小数点・texture format の差により byte 一致はしない。Tier B 契約（`packages/stroke/docs/parity-testing.md`）: alpha MAE ≤ 0.015、RGB MAE ≤ 0.02、`|Δ| > 0.1` の pixel 率 ≤ 1%、bbox 差 ≤ 1px
- 混色の pickup タイミング（stamp: checkpoint 距離・update 距離 / bristle: flush 単位）は CPU と同じ
- Rough bristle の dropout mask は CPU / GPU とも同じ式を画素ごとに評価するため、混色 OFF では実質一致（S 字 fixture で `|Δ| > 25/255` の画素が ink の 0.01%）。混色 ON は Tier B 内（Rough 150 点 fixture で alpha MAE 0 / RGB MAE 0.0013）
- WebKit の bitmap commit は fence 完了後に転写すること（描画モデルの「commit の非同期化」）が決定性の前提。vitest の browser mode は chromium のみで WebKit 固有の挙動は自動テストの外にあるため、WebKit 側の決定性は同一入力を複数 run 撮って byte 比較する（`tools/bench/results`）
- 同一 GPU 上での再現性は保証するが、GPU / ブラウザ間の bit 一致は保証しない。保存 command は backend を持たないため、別環境での replay は各環境の経路で描かれる

## lifecycle と障害

- surface は加速器ごとに layer 寸法単位で 1 つ（寸法が変わると再確保）。`dispose()` で GL リソースを解放する
- **context lost**（および進行中の `dispose()`）: 以降の stroke は CPU 経路。進行中の stroke は GPU 側への追加・commit を止め、`finalize` 時に layer を stroke 開始前の状態へ戻してから全入力点を CPU 経路で描き直す（結果は最初から CPU で描いた場合と byte 一致）。復元は **history 機構**で行う: `createStrokeRuntime` の `restoreLayerBeforeStroke(layer)` hook を呼び出し側が注入し（react の `usePaintEngine` は `rebuildLayerFromHistory` で自動接続）、平常時に layer の読み出しや snapshot 保持は行わない。hook を注入しない低レベル利用（`createIncrementalStrokeRenderer` 直接利用など）では復元せず、部分 commit 済みの layer 上に CPU で描き直す
- **cancel**（ジェスチャ成立などで stroke を破棄する場合）: GPU stroke は開始時に accum を GPU 内の base texture へ複製しておき、cancel 時は触った矩形だけ base から accum へ戻して通常の commit 経路で layer に書き戻す。CPU snapshot や history rebuild は使わず、常駐も維持される（context lost 中は history 復元へ fallback）。base texture は accum と同寸（2K 16MB、4K 64MB）で、stroke 開始ごとに GPU 内 blit が 1 回増える
- stroke の cancel / dispose では GPU stroke を必ず終了する（未終了の stroke が残ると以降 CPU 経路に固定されるため）。Undo / Redo の rebuild は進行中の stroke を先に同期 cancel してから開始する（pointer-up より先に Undo が届いた場合に、rebuild と live stroke の owner が競合しないように）

## 制限

- layer 寸法は 4K 程度までを想定（accum と base texture が layer 同寸で 4K = 64MB × 2）。タイル分割は行わない
- branch 上限 64（既定）。UI 上それ以上作れる場合は CPU 経路になる
- `compositeOperation` は `source-over` のみ
- WebGPU は未対応（WebGL2 のみ）

## デバッグ

`brushPerfDebug`（`perfDebug` 有効時のみ動作、通常時はゼロコスト）で stage 計測・stall 記録を取得できる。apps/web の評価パネルは現在の backend（`webgl2` / `cpu` と auto の判定理由）と commit mode を表示し、切替は設定を永続化してリロードする。apps/web の URL フラグは `?gpuBackend=auto|webgl2|cpu`、`?gpuCommit=bitmap|direct`、`?perfDebug=1` の 3 つ。
