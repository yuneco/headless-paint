# GPU commit の非同期化（fence ポーリング）

## Context

WebKit の `transferToImageBitmap()` は queue 済み blit を待たないため、commit 直前に `gl.finish()` で同期している（`e2e259b`）。この待ちが Mac WebKit で 1 stroke（150 点、31 commit）あたり 40〜60ms、moveMany の 35〜50% を占める（finish を除いた exclusive 計測で moveMany 113〜129 → 40〜72ms）。待ちの中身は GPU パイプラインの drain であり、CPU 仕事ではない。

`clientWaitSync` の timeout 上限（`MAX_CLIENT_WAIT_TIMEOUT_WEBGL`）は WebKit / Chromium とも 0 なので「短く待つ」はできず、ポーリングのみ可能。

## 方針（ユーザー合意 2026-09-07: コスト削減に進む）

commit を「blit + fence を置いて即返る」に変え、fence の完了を stroke runtime がポーリングして転写する。

- engine（`GpuStrokeSurface` / accelerator 内部 runtime）: `commitToLayer` は tiles を commit canvas へ blit し `fenceSync` を置いて **pending** にする。`pollPendingCommit(owner, layer): boolean` は `clientWaitSync(fence, 0, 0)` が signaled なら transferToImageBitmap → layer へ描き、true。未完なら false。`endStroke` / `cancelStroke` / `dispose` / context lost / 次の `commitToLayer` は pending を **同期 drain**（`gl.finish` → 転写）してから進む
- stroke（`incremental-stroke.ts` / `stroke-runtime.ts`）: flush ごとの commit 後、pending なら `deps.setTimeout(poll, 0)` でポーリング（最大数回、間隔 0〜4ms）。転写できたら `deps.requestRender()`。stroke 終了（finalize）は従来どおり同期 commit
- 表示: 転写が遅れても layer の内容が 1 frame 程度遅れるだけ。pending 中に次の flush が来たら同期 drain（現状と同じ動作に退化）
- replay / rebuild（`gpuCommitCadence: "final"`）は変更なし（最後に 1 回、同期）
- 決定性: GPU 内容は変わらず、layer に載る画素も同じ。stroke 終了時点で byte 一致

## 外部 IF

公開 API 変更なし。`BrushAccelerator` の内部 runtime（structural bridge）に `pollPendingCommit` を追加。`createStrokeRuntime` の deps は既存の `setTimeout` / `requestRender` を使う。

## Phase 1: ドキュメント

- `packages/engine/docs/gpu-acceleration.md` 「commit の同期」を「commit の非同期化」に書き換え: fence、poll、同期 drain の発火点、表示遅延の上限、direct mode は従来どおり同期
- `packages/stroke/docs/stroke-machine.md` の deps 説明に「GPU commit のポーリングに setTimeout / requestRender を使う」を 1 行

## Phase 2: codex read-only レビュー（ユーザー合意）

## Phase 3: 実装（codex）

- gpu-stroke-surface.ts: pending commit の状態（fence、packed tiles / bitmap 前の commit canvas 内容、dirty rects）。commit canvas は pending 中に次の blit で上書きされてはならない → pending があれば先に drain
- commit-packing.ts: `commitRectsToLayer` を「blit フェーズ」と「転写フェーズ」に分離。bitmap mode のみ非同期。direct mode は従来どおり
- accelerator.ts: `pollPendingCommit` / drain の呼び出し点（endStroke / cancel / dispose / lost / restoreUndo）
- incremental-stroke.ts / stroke-runtime.ts: ポーリング。runtime dispose で停止
- テスト: (a) pending 中に endStroke した場合に layer が完全（byte 一致）、(b) poll が false → true になった後の layer が同期 commit と byte 一致、(c) cancel 中の pending 破棄、(d) 既存の決定性・parity・undo-1 テストが無変更で green
- 採否判定（閾値方針）: Mac WebKit probe6 で moveMany が −20% 以上（113〜129 → ≤ 95ms 目安）。未達なら棄却して戻す

## Phase 4: レビュー
