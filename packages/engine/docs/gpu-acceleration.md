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

react（`usePaintEngine`）はこれを内包する。`gpuBackend?: "auto" | "webgl2" | "cpu"`（既定 `"auto"`）を渡すだけで、加速器の生成・runtime / replay への注入・mixing stamp 選択時の `warmUp`・unmount 時の `dispose` を hook が行う。現在の backend と auto の判定理由は `engine.gpuBackend` / `engine.gpuBackendReason` で取得でき、デバッグ UI で表示できる。

詳細は [brush-api.md](./brush-api.md)、[incremental-render-api.md](./incremental-render-api.md)、stroke の docs を参照。

## GPU 経路の適格条件

stroke 開始時に次をすべて満たすときだけ GPU 経路になる。満たさない stroke は同じ入力で CPU 経路で描かれる（自動、通知なし）。

- ブラシが `stamp` で `mixing` が有効（`isBrushMixingActive`）
- `compositeOperation` が `source-over`
- `alphaLocked` でない
- Expand の branch 数（`compiledExpand.outputCount`）が `maxBranches` 以下
- 加速器が有効で surface を確保できた（context lost でない）

Rough bristle・spray・非混色 stamp は対象外（現状は CPU 経路のみ）。

## 描画モデル

- **accum**: layer 同寸の RGBA8 texture（premultiplied）。stroke 開始時に layer 内容を upload（常駐 hit 時は省略）
- **dab**: instanced draw。fragment = tip mask × 混色 field（bilinear）。`source-over`（premultiplied）で accum へ蓄積。Expand は branch ごとの instance を branch 0 → 1 → … の順に flush し、CPU 経路と同じ重なり順を保つ
- **混色 field**: `fieldColumns × fieldRows` を branch 数分縦に並べた strip texture（RGBA16F。無ければ RGBA8）。`updateDistancePx` ごとに pickup / restore / diffusion を全 branch 1 pass で更新（式は CPU の `advanceMaterialField` と同一）
- **checkpoint snapshot**: `checkpointDistancePx` ごとに、accum の局所 tile を branch 別の snapshot texture へ GPU 内で blit する。tile の中心は CPU の `captureCheckpoint` と同じだが、寸法は stroke 中に変わらないよう筆圧による stampSize の上限（`lineWidth × (1 + pressureDynamics.size)`）から決め、32px 単位で確保して縮小しない（sampling 位置は CPU と同一で、tile が大きい分は読まれない）。field の sampling 元はこの snapshot であり、CPU 経路の「直近 checkpoint 時点の tile を読む」時間基準を再現する
- **commit**: pointer batch ごとに 1 回、branch 別 dirty rect を commit canvas（1024²）へ敷き詰めて一括 blit し、`transferToImageBitmap()` で得た 1 枚の ImageBitmap から rect ごとに `layer.ctx.drawImage` で書き戻す（WebGL canvas を drawImage の source にする回数を pass あたり 1 回に抑える。iOS WebKit では source 化ごとに snapshot copy が走るため）。dab ごとや点ごとには書き戻さない
- **readback なし**: 上記のどこにも `getImageData` / `readPixels` は無く、GPU stroke 中は `layer.ctx` を drawImage の source にもしない（iOS WebKit では GPU-backed canvas の source 化ごとに snapshot copy が走るため）

## 常駐（residency）と無効化の契約

`resident: true`（既定）のとき、commit 後の accum は「layer と同内容」として次の stroke でも再利用され、stroke 開始時の upload（2K で 16MB、4K で 64MB）を省略する。常駐は直近 1 layer のみ。

accum と layer の同一性が崩れる操作は engine / stroke の API が内部で自動的に無効化する:

- engine: `clearLayer`、`copyLayerPixels`、`setPixel`、`drawLine` / `drawCircle` / `drawPath` / `drawVariableWidthPath`、CPU 経路のブラシ描画、`mergeLayerDown` 系、`transformLayer`、`wrapShift`
- stroke: 非 GPU stroke の commit、checkpoint 復元、Undo / Redo の history rebuild、layer を書き換える command executor

**engine / stroke の API を経由せずに `layer.ctx` へ直接描いた場合は、呼び出し側が `accelerator.invalidate(layer)` を呼ぶ必要がある**。呼ばないと次の GPU stroke が古い accum の上に描かれる。

## 決定性と parity

- **同一 backend**: live / incremental / replay / Undo / Redo は入力点列が同じなら pixel 完全一致（全処理が GPU コマンド順で決まり、時間や event 配送に依存しない）。テストで保証する
- **CPU 経路との差**: raster 規則・浮動小数点・texture format の差により byte 一致はしない。Tier B 契約（`packages/stroke/docs/parity-testing.md`）: alpha MAE ≤ 0.015、RGB MAE ≤ 0.02、`|Δ| > 0.1` の pixel 率 ≤ 1%、bbox 差 ≤ 1px
- 混色の pickup タイミング（checkpoint 距離・update 距離）は CPU と同じ
- 同一 GPU 上での再現性は保証するが、GPU / ブラウザ間の bit 一致は保証しない。保存 command は backend を持たないため、別環境での replay は各環境の経路で描かれる

## lifecycle と障害

- surface は加速器ごとに layer 寸法単位で 1 つ（寸法が変わると再確保）。`dispose()` で GL リソースを解放する
- **context lost**（および進行中の `dispose()`）: 以降の stroke は CPU 経路。進行中の stroke は GPU 側への追加・commit を止め、`finalize` 時に layer を stroke 開始前の状態へ戻してから全入力点を CPU 経路で描き直す（結果は最初から CPU で描いた場合と byte 一致）。復元は **history 機構**で行う: `createStrokeRuntime` の `restoreLayerBeforeStroke(layer)` hook を呼び出し側が注入し（react の `usePaintEngine` は `rebuildLayerFromHistory` で自動接続）、平常時に layer の読み出しや snapshot 保持は行わない。hook を注入しない低レベル利用（`createIncrementalStrokeRenderer` 直接利用など）では復元せず、部分 commit 済みの layer 上に CPU で描き直す
- stroke の cancel / dispose では GPU stroke を必ず終了する（未終了の stroke が残ると以降 CPU 経路に固定されるため）

## 制限

- layer 寸法は 4K 程度までを想定（accum は layer 同寸で 4K = 64MB）。タイル分割は行わない
- branch 上限 64（既定）。UI 上それ以上作れる場合は CPU 経路になる
- `compositeOperation` は `source-over` のみ
- WebGPU は未対応（WebGL2 のみ）

## デバッグ

`brushPerfDebug`（`perfDebug` 有効時のみ動作、通常時はゼロコスト）で stage 計測・stall 記録を取得できる。apps/web の評価パネルは現在の backend（`webgl2` / `cpu` と auto の判定理由）を表示し、切替は設定を永続化してリロードする。
