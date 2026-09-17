# Simple bristle CPU procedural parity

## Phase 1: 設計・ドキュメント

- 公開API・型・GPU・shader・field式は変更しない。既存のsimple既定化と係数0.9の未コミット変更を保持する。
- CPU内部のsimple gridを評価関数へ置換する。rasterのuはsample index、vは0〜rows−1のまま、distanceとpressureをuで線形補間し、crossPx = −brushSize/2 + v/(rows−1)×brushSizeへ変換する。
- CPU/GPUのquad頂点位置と三角形分割は同じなので、画素内で同じ連続座標を復元できる。
- brush-api.mdの面掠れ説明を実装に合わせる。

## Phase 2: 利用イメージレビュー

- ユーザーの具体的な実装指示で承認済み。利用側の呼出しは変わらない。

## Phase 3: 実装・検証

- simple評価関数とrasterへの接続を実装し、旧gridテストを移行する。
- 距離・筆圧の補間、幅端の対応、sample分割・band解像度からの独立性を回帰テストで確認する。
- pnpm -r build、pnpm lint、pnpm exec vitest run --browser.enabled=false packages/engineを実行する。ブラウザ依存で実行不能なテストを記録する。
- 指定のTier Bテストは変更しない。実ブラウザでの検収は依頼側が担当する。コミットしない。

## Phase 4: レビュー

- review-library-usageで既存noise/hash/pressure関数の再利用、readonly、ドキュメント整合、変更禁止範囲の差分を確認する。

## 実装・検証結果

- 旧createSimpleBristleMaskFieldを内部createSimpleBristleMaskEvaluatorへ置換。既存のvalueNoise2dとsamplePressureを利用し、格子配列の確保を省いた。nullFieldは定数1を返す。
- bristle-mask.test.tsの旧grid決定性テストを評価関数へ移行し、座標対応・sample分割/band解像度独立性・筆圧補間後のclampとdebug gainのテストを追加（計4件、通過）。
- bristle-pass.test.tsの別テスト「reports procedural simple mask parity and stays deterministic」はfactory名のみ変更。共通importも同名へ移行。変更禁止のincremental Tier Bテスト本体はHEADと完全一致を確認した。
- pnpm -r build: 通過（初回に残った旧factory参照を修正後再実行し、TypeScript診断エラーなし）。
- pnpm typecheck: 通過。
- pnpm lint: 通過。
- pnpm exec vitest run --browser.enabled=false packages/engine: 140 passed / 184 failed、8 files passed / 20 files failed。失敗184件の内訳はOffscreenCanvas未定義178件、同例外により期待例外を確認できないtipテスト2件、WebGL acceleratorを生成できない4件。productionの期待値不一致は検出していない。
- JSON reporterの失敗理由を上記環境依存に限定できることを確認し、その184件のfullNameだけを除外した再実行: 140 passed / 184 skipped、14 files passed / 14 skipped。コマンドは `pnpm exec vitest run --browser.enabled=false packages/engine --testNamePattern "$(cat /tmp/headless-paint-node-test-filter.txt)"`。フィルタは一時ファイルのみで、テストや設定にはskipを追加していない。
- ログ: /tmp/headless-paint-build.log、/tmp/headless-paint-engine-vitest.log、/tmp/headless-paint-engine-vitest.json、/tmp/headless-paint-node-tests.log。
- セルフレビュー: engine/input/stroke READMEとengine brush-apiを確認。公開export/型に変更なし。field生成・bilinear・surface contact・noise関数はHEADと同一。GPU productionとwebの差分は着手前の未コミット変更のみ。コミットなし。
- Tier Bの実測合否は依頼側の実ブラウザ検収待ち。

### Canvas/WebGL依存で実行できなかったテストを含むファイル

- `packages/engine/src/content-bounds.test.ts`
- `packages/engine/src/draw.test.ts`
- `packages/engine/src/incremental-render.test.ts`
- `packages/engine/src/layer-collection.test.ts`
- `packages/engine/src/layer-merge.test.ts`
- `packages/engine/src/layer.test.ts`
- `packages/engine/src/pattern-preview.test.ts`
- `packages/engine/src/transform-layer.test.ts`
- `packages/engine/src/wrap-shift.test.ts`
- `packages/engine/src/brush/bristle-mask.test.ts`
- `packages/engine/src/brush/bristle.test.ts`
- `packages/engine/src/brush/mixing.test.ts`
- `packages/engine/src/brush/spray.test.ts`
- `packages/engine/src/brush/stamp.test.ts`
- `packages/engine/src/brush/state.test.ts`
- `packages/engine/src/brush/tip.test.ts`
- `packages/engine/src/brush/gpu/accelerator.browser.test.ts`
- `packages/engine/src/brush/gpu/bristle-pass.test.ts`
- `packages/engine/src/brush/gpu/gpu-stroke-surface.test.ts`
- `packages/engine/src/brush/gpu/per-flush-checkpoint-verification.test.ts`

## 検収結果（Claude、実ブラウザ 2026-09-06）

- `pnpm -r build && pnpm test && pnpm lint`: 615 tests green（chromium browser mode 込み）。Tier B テスト「keeps incremental rough bristle chunks within Tier B」は無変更のまま通過（変更前は alphaMae 0.0171 / largeDeltaRate 0.0206 で fail）
- S 字（Rough 120px、mixing OFF）CPU vs WebKit GPU: |Δ|>25 が ink の 0.01%。GPU は run 間 byte 一致
- Chromium CPU（probe6、1 stroke 150 点）: simple OFF 62ms / ON 92ms、field OFF 73ms / ON 103ms → 格子生成が消えて simple の方が速い
