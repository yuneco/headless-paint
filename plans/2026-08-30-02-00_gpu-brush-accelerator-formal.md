# GPU brush accelerator 正式化（F1〜F4）

## Status

- Created: 2026-08-30 02:00 JST
- Base: `experiment/brush-acceleration`（spike結果は `plans/2026-08-25-00-29_brush-gpu-acceleration-investigation.md` Section 18〜19）
- State: **Phase 4 完了（2026-08-30）。実装済み・ユーザー確認待ち**
- Scope: Acrylic（stamp + mixing）のGPU経路（WebGL2）を engine の内部acceleratorとして正式化する。Rough bristleは第2フェーズ（本計画ではplug-in点の定義のみ）

## 1. 要求（spikeで確定した事実）

- WebKit系（Safari / iPad）でAcrylicのlive dispatchを 8〜28ms → 1〜3ms、Undo replayを 3〜8倍短縮する。4K・Expandほど効果が大きい
- 色混ぜ表現はCPU経路と経路差なし（Tier B: RGB MAE ≤0.02、|Δ|>0.1 ≤1%）。同一backendでlive / replay / Undo / Redo はpixel一致
- readbackゼロ（同期点ゼロ）。accum・field・checkpoint snapshotはGPU常駐、accumはstroke間常駐
- ChromiumはCPU経路が元から速い（1ms）ためGPU非採用。Node / headless / WebGL2不可 / context lost はCPU経路
- 上限: layer 4K、branch 64（超過はCPU）

## 2. 設計方針

### 2.1 位置づけ
- 公開 `Layer` はCanvas2Dのまま。GPUはengine内部の **accelerator** で、最終画素は従来どおり `layer.ctx` に書き戻される（commit）。外部から見た契約（Layer / StrokeCommand / History）は不変
- 関数型APIとの整合: acceleratorは **明示的に注入するruntime resource**（グローバルsingletonにしない）。engineの描画関数はacceleratorを引数で受け取り、無ければCPU経路

### 2.2 公開API（案、Phase 1で確定）
```ts
// engine
createBrushAccelerator(options?: BrushAcceleratorOptions): BrushAccelerator | null
interface BrushAcceleratorOptions {
  readonly backend?: "auto" | "webgl2" | "off"; // auto = WebKit系かつWebGL2可のときのみ
  readonly maxBranches?: number;                 // 既定64
  readonly resident?: boolean;                   // accumのstroke間常駐（既定true）
}
interface BrushAccelerator {
  readonly backend: "webgl2";
  warmUp(layer: Layer): void;        // surface確保＋accum upload（brush選択時に呼ぶと初回strokeの60msを消せる）
  invalidate(layer: Layer): void;    // engine API外でlayer.ctxへ直接描いた場合に呼ぶ（常駐の契約）
  dispose(): void;
}
// engine 描画IF: renderBrushStroke / appendToCommittedLayer に optional の accelerator を追加
// stroke: createIncrementalStrokeRenderer / createStrokeRuntime の config に optional の accelerator
// react: usePaintEngine のオプションで accelerator を生成・注入（apps/webは "auto"）
```
- persisted command / brush config にはbackendを保存しない
- 常駐の契約: engineのlayer書き込みAPI（draw / merge / transform / wrap-shift / clear / copy / CPU brush / checkpoint復元 / command executor）は内部で自動無効化する。**外部が`layer.ctx`へ直接描く場合は`invalidate(layer)`が必要**とdocsに明記
- 適格条件（内部）: stamp + mixing有効 + source-over + alphaLock無し + branch ≤ maxBranches + surface確保成功。それ以外はCPU経路（自動、通知なし。デバッグ用に理由を取得できるhookは検討）

### 2.3 決定性・parity契約
- 同一backend: live / replay / Undo / Redo pixel一致（テストで保証）
- CPU vs GPU: Tier B（`packages/stroke/docs/parity-testing.md` に追記）。field texture format（RGBA16F/8）・GPU差によるbit差は許容
- checkpoint snapshotの時間基準はCPUと同一（checkpoint距離でGPU内blit）

### 2.4 lifecycle / 障害
- surfaceはaccelerator単位（layer寸法ごとに1つ。寸法変更で再確保）。`dispose()`でGL resource解放
- context loss: 以降のstrokeはCPU経路。進行中strokeは `cancel` 相当で破棄せず、**そのstrokeのcommandをCPUで再実行**（rebuild単位のCPU再実行で決定性を保つ）
- stale owner回復（spike 19.6）は正式実装ではcancel経路の確実な終了で不要にする（保険として残すか判断）

### 2.5 Bristle plug-in点（第2フェーズのため定義のみ）
- surface契約（accum / commit / 常駐 / branch / field / snapshot）はbrush非依存
- Bristle用に「chunk単位のmask（MAX蓄積）+ ink（source-over）pass」を追加できるよう、`GpuStrokeSurface` の内部IFに `beginPass/endPass` 相当の拡張点を残す（公開しない）

## 3. Doc-First Phase

### Phase 1: API設計・ドキュメント
1. `packages/engine/docs/gpu-acceleration.md`（新規）: 位置づけ、公開API、適格条件、常駐契約、決定性/parity、lifecycle、制限（4K・64 branch・WebKit系のみauto）
2. `packages/engine/docs/brush-api.md` / `incremental-render-api.md` / `README.md` / `types.md`: accelerator引数と型
3. `packages/stroke/docs/stroke-machine.md` / `session-api.md` / `parity-testing.md`: config注入、Tier B契約
4. `packages/react/docs/README.md`: `usePaintEngine` オプション

### Phase 2: 利用イメージレビュー（ユーザーgate）
- `apps/web` からの利用（accelerator生成、warmUp、invalidate不要であることの確認）
- Node / テストからの利用（acceleratorなし＝CPU）
- 外部が`layer.ctx`へ直接描くケースの `invalidate`

### Phase 3: 実装
1. spike実装を正式IFへ整理（`packages/engine/src/brush/gpu/`）
2. 実験コードの削除: `sync` readback経路、lag knob、`nullStages`、`__hpDebugUi`、URL knob群、perf-debug の実験flag（計測stageは軽量なら残す判断）
3. 常駐無効化hookの整理（engine内部helperへ集約）
4. warmUp / dispose / context loss
5. テスト: 既存GPU/parity/residencyテストを正式IFへ移植、context lossテスト追加
6. benchmark: `work.local` の主要scriptを `packages/*/benchmarks` 等へ移す判断（最低限、backlog fixtureとparity harnessは再現可能に）

### Phase 4: アーキテクトレビュー
- review-library-usage、docs双方向整合、public export / schema / Node fallback の確認、`pnpm -r build` / `pnpm test` / `pnpm lint`、rootのdebugファイル確認、`plans/agents-note.md` 更新

## 4. 非目標
- WebGPU、Chromium向けGPU、Rough bristle GPU（第2フェーズ）、tile atlas（4K上限で不要と判断）、8K

## 5. ユーザー決定（2026-08-30）
- `auto` の判定は **UA sniff（WebKit系）**。capability実測はしない
- **デバッグパネルからbackendを切替可能**にする: 現在engineがどのbackendで動いているか（`webgl2` / `cpu` と、autoで選ばれた理由）を表示し、切替は confirm → リロード。指定は brush 設定と同様に **localStorage に永続化**（`apps/web` の persisted settings に `engineBackend: "auto" | "webgl2" | "cpu"` を追加）。engine/stroke 側は起動時に注入されるacceleratorに従うだけで、動的切替はサポートしない
- perf-debug 計測（stage timer / stall記録）は**邪魔にならない範囲で残す**（`perfDebug` 時のみ有効、通常時はゼロコスト）。残りの実験knobは削除。計測の削除可否は安定後に再判断

## 6. ペンディング
- context loss時の進行中strokeの扱いの詳細

## 7. Phase 2 決定（2026-08-30）
- **アプリ負担を最小に**: react `usePaintEngine({ gpuBackend })` が生成・注入・mixing stamp選択時の自動 `warmUp`・unmount時 `dispose` を内包。`engine.gpuBackend` / `engine.gpuBackendReason` をデバッグUI向けに公開
- **値名は `"auto" | "webgl2" | "cpu"` で統一**（engine / react / アプリ永続化）
- **core直接利用（paint-app / jotai）**: エンジン再実装は不要。`createBrushAccelerator` → `createStrokeRuntime({ accelerator })` / `replayCommand(..., { accelerator })` / `executeHistoryOp(..., { accelerator })` の3箇所に渡す＋任意で `warmUp`。docsの「core利用者の最小手順」に記載

## 8. 実装結果（2026-08-30）

### 実装された仕様（要約。詳細は `packages/engine/docs/gpu-acceleration.md`）
- engine 公開API: `createBrushAccelerator(options?)` / `resolveBrushAcceleratorBackend(options?, env?)`、型 `BrushAccelerator` / `BrushAcceleratorOptions` / `BrushAcceleratorBackend` / `BrushAcceleratorResolution`。`renderBrushStroke` / `appendToCommittedLayer` に optional `accelerator`
- stroke: `StrokeRuntimeDeps.accelerator`、`ReplayOptions.accelerator`（`replayCommand` / `replayCommands`）、`ExecutorDeps.accelerator`（`executeHistoryOp` / rebuild）。cancel / dispose で GPU stroke を確実に終了。context lost / dispose 時は commit 直前に退避した dirty rect を復元し、全入力点を CPU 経路で描き直す（byte 一致）
- react: `usePaintEngine({ gpuBackend })`（既定 auto）。hook が生成・注入・mixing stamp 選択時の `warmUp`・unmount 時 `dispose`。戻り値 `gpuBackend` / `gpuBackendReason`
- apps/web: `engineBackend` を localStorage に永続化、デバッグパネルで表示・切替（confirm → reload）、`?gpuBackend=` が優先
- GPU 内部: layer 同寸 accum（常駐、直近1 layer、engine/stroke の書き込みAPIで自動無効化）、instanced dab、field strip（全 branch 1 pass）、branch 別 checkpoint snapshot（GPU 内 blit、CPU の時間基準を再現）、commit packing（1024²、batch ごと1往復）、branch 上限 64（UBO）、readback ゼロ
- 適格条件: stamp + mixing + source-over + alphaLock 無し + branch ≤ 64 + surface 確保成功。auto は WebKit 系のみ

### 最終数値（WebKit Playwright、backlog fixture、正式API後）
- CPU dispatch p50/p95 8/12ms・undoLong 2611ms → GPU 2/3ms・882ms
- parity（Tier B）: none / radial 4 とも全 fixture pass（F1 RGB MAE 0.003〜0.005、|Δ|>0.1 0%）。Undo 後差分 0
- テスト 523 件 green（live/replay byte 一致、Expand parity、residency、context loss、backend 判定）

### 実装時の調整内容（補足）
- readback を CPU に戻す設計（sync / async / lag N）は WebKit の GPU 往復レイテンシが床となり採用せず、field 更新と checkpoint snapshot を GPU 内に置く方式へ転換（spike 計画 Section 18.12〜18.19）
- iPad の stall は cancel 経路で GPU stroke が未終了のまま残り CPU 経路に固定されていたことが原因。cancel / dispose で確実に終了し、stale owner からも回復する
- context loss の rollback は当初 stroke 開始時の全面 copy だったが、常時コストのため commit 直前の dirty rect 退避に変更
- backend の UA 判定は react 側の重複実装を排し engine の `resolveBrushAcceleratorBackend` に一元化

### ペンディング
- iPad 実機での最終確認（常駐・Expand・context loss 復旧の体感）
- Rough bristle の GPU 化（第2フェーズ。plug-in 点は `GpuStrokeSurface` 内部 IF に残す）
- `work.local` の benchmark / parity harness は正式 API に追従済みだが、リポジトリ管理下の再現手段へ移す判断は未
- perf-debug 計測（stage / stall）は `perfDebug` 時のみ有効で残置。削除可否は安定後に判断
- 外部からの `layer.ctx` 直接書き込みは `invalidate` 契約に依存（自動検出しない）

## 9. iPad確認（2026-08-30、正式API後）
- Debug Infoに「webgl2 (auto: webkit)」表示OK。GPU経路は有効（12 branchで `checkpointReadback` 0）
- 残stall（kaleido 6）: **`gpuCommit` 1回50〜100ms（最大357ms）**。iOS WebKitはWebGL canvasをdrawImage sourceにするたびにsnapshot copy＋GPU同期を行うため、branch別rectのdrawImage×12が重い（Macでは0.2ms）。対策: commit passごとに `transferToImageBitmap()` 1回→bitmapからN回drawImage
- **`realloc:snapshotArray` の頻発**: 筆圧連動stampSizeでtile寸法が毎回変わり12層texture arrayを再確保。対策: stampSize上限でtile寸法を固定し、確保済み以上なら再確保しない（縮小しない）
- 委譲中（Phase 4-c）

## 10. Phase 4 追加修正の結果（2026-08-30）
- p4c: commit を pass ごと `transferToImageBitmap` 1 回＋bitmap から N 回 drawImage に変更（iOS の source 化コスト対策）。GPU checkpoint tile を筆圧上限で固定し再確保を抑制。Mac WebKit では commit が +1ms/batch 程度（r1 dispatch 2/3 のまま、r8 3/4→4/6）
- p4d: context loss の rollback 退避を廃止し、`restoreLayerBeforeStroke` hook（react は `rebuildLayerFromHistory`）で復元。平常時に `layer.ctx` を source として読まない
- 最終回帰（Mac WebKit）: CPU 8/11・undoLong 2581 / GPU r1 2/3・852 / GPU r8 4/6・2394 / parity none・radial 4 全 pass（F1 RGB MAE 0.003〜0.005、|Δ|>0.1 0%）
- 「r8 undoLong が 1006→2394 に後退」と見えたのは誤認。1006 は parity が壊れていた `0a3fb89`（live accum 直読み）の値で、snapshot 方式（`8c9c3a4`）以降は ≈2.4s が基準（CPU 19137 比 −87%）。bisect で確認済み
- iPad 再確認待ち（kaleido 6 の commit stall が解消しているか）

## 11. iPad再確認（2026-08-30 18:00）
- stall は解消
- **不具合**: Acrylic（GPU）で複数stroke → Undo → Redo 後に矩形状（commit tile相当）の描画欠け。Expandの有無に関係なし。replay（1回の`feedMany`＝大きなdirty rect→複数tile・複数pass）でのImageBitmap commit（p4c）がiOSで壊れている疑い。再現テスト（複数stroke・2 pass以上）と修正を委譲中。CPU経路（`?gpuBackend=cpu`）での再現有無をユーザーに確認依頼
