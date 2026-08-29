# GPU brush accelerator 正式化（F1〜F4）

## Status

- Created: 2026-08-30 02:00 JST
- Base: `experiment/brush-acceleration`（spike結果は `plans/2026-08-25-00-29_brush-gpu-acceleration-investigation.md` Section 18〜19）
- State: **計画草案（Phase 0）**。ユーザー承認後にPhase 1へ
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

## 5. ペンディング
- `auto` の判定方法（UA sniff vs capability+実測）
- context loss時の進行中strokeの扱いの詳細
- perf-debug計測の残し方（開発機能として隔離するか削除するか）
