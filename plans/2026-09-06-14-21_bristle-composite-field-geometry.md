# GPU bristle composite の field 座標修正

## Phase 1 / 2: 設計・利用イメージ

- ユーザー指定の内部修正を実施。公開 API・CPU 経路・field 更新 shader・既存 Tier B 比較と閾値は変更しない。
- composite は document 座標に run geometry の逆変換を適用する。契約を engine の gpu-acceleration.md に記載。
- 既存 PendingBranchSegment.update から run geometry を渡し、update のない末尾 run / 即時描画には branch ごとの直近 geometry を使用する。stroke 開始で保持値をリセットする。
- 利用側の変更なし。右→左でも拾った色が接触した側に着地する。今回の設計・実装範囲は依頼で承認済み。

## Phase 3: 実装・検証

- uFieldGeometry を追加し、surface → composite target → uniform の経路を接続。
- engine の bristle-pass.test.ts に左右両方向の CPU/GPU parity と色の着地側の回帰テストを追加。
- pnpm -r build、pnpm lint、ノンブラウザ engine テストを実行。browser テストと実機検収は依頼側が実施する。

## Phase 4: レビュー

- review-library-usage に従い内部データフロー・既存 API 利用・ドキュメント整合を確認する。
- コミットしない。

## 実施結果

- shader: `offset = p - center`、`local = (cos(angle)*offset.x + sin(angle)*offset.y, -sin(angle)*offset.x + cos(angle)*offset.y)`、`normalized = clamp(local / sampleSize + 0.5, 0, 1)`。既存の field texel / branch strip 参照へ接続。mask / ink の uChunkSize は維持。
- geometry: updateMaterialField → 遅延描画時は既存 segment.update → 描画順に branch ごとの latestMaterialFieldUpdates を更新 → bristleTarget.fieldGeometry → uniform4f(uFieldGeometry)。update のない末尾は同じ branch の直近値を使い、beginStroke でリセット。target 作成時に update オブジェクトを保持するので atlas の遅延 composite でも他 run の値に置き換わらない。
- 追加テスト（bristle-pass.test.ts）: `left-to-right mixing keeps picked-up band color on the touched side within Tier B` / `right-to-left mixing keeps picked-up band color on the touched side within Tier B`。固定 seed、同じ白い40pxブラシ、上半分だけに接触する有限の赤帯を横切る。既存 compareAlpha をそのまま使い alpha MAE ≤ 0.015、large delta率 ≤ 0.01、coverage差 ≤ 2pt。さらに色帯の外の透明だった上下領域で premultiplied の赤成分増加を測り、CPU/GPU それぞれ触れた側への pickup と反対側への非着色を確認。ブラウザ実行は依頼側待ち。
- `pnpm -r build`: exit 0、ログ内の TypeScript error / warning なし。
- `pnpm lint`: exit 0。
- `pnpm run typecheck`: exit 0。
- `pnpm exec vitest run --browser.enabled=false packages/engine`: 140 passed / 186 failed。失敗は OffscreenCanvas 未定義・WebGL2 surface が作れないことによるもの。コマンド全体は exit 1 であり成功扱いにしない。
- 同コマンドにブラウザ依存186ケースだけを除外する `--testNamePattern` を付けた再実行: exit 0、140 passed / 186 skipped（14 files passed / 14 files skipped）。除外パターンは `/tmp/bristle-field-browser-test-pattern.txt`、実行ログは `/tmp/bristle-field-node-tests.log`。リポジトリのテスト設定・既存テストには除外を追加していない。
- セルフレビュー: engine / input / stroke の README、engine GPU acceleration、stroke parity-testing を確認。CPU経路・field更新shader・公開API/型・既存比較関数/閾値に変更なし。公開利用側の変更なし。

### ブラウザ API 不在で実行できなかったケースを含むファイル

すべて `packages/engine/src/` 配下。一部ファイルの非ブラウザケースは通過している。

- `content-bounds.test.ts`
- `draw.test.ts`
- `incremental-render.test.ts`
- `layer-collection.test.ts`
- `layer-merge.test.ts`
- `layer.test.ts`
- `pattern-preview.test.ts`
- `transform-layer.test.ts`
- `wrap-shift.test.ts`
- `brush/bristle-mask.test.ts`
- `brush/bristle.test.ts`
- `brush/mixing.test.ts`
- `brush/spray.test.ts`
- `brush/stamp.test.ts`
- `brush/state.test.ts`
- `brush/tip.test.ts`
- `brush/gpu/accelerator.browser.test.ts`
- `brush/gpu/bristle-pass.test.ts`
- `brush/gpu/gpu-stroke-surface.test.ts`
- `brush/gpu/per-flush-checkpoint-verification.test.ts`

## 検収結果（Claude、実ブラウザ 2026-09-06）

- 差し戻し 1 回: テスト helper が混色用 stroke 開始スナップショット（sourceLayer）を渡しておらず production の契約例外で落ちた → テストのみ修正
- `pnpm -r build && pnpm test && pnpm lint`: 617 tests green
- 追加テストの検出力: 旧 bbox 写像に戻す（uniform は参照を残す）と right-to-left のみ「触れた側の赤み 0」で fail、left-to-right は pass。バグを捕まえている
- 見た目: 赤線に上半分だけ重なるアーチ（両方向）で GPU が CPU と一致（外側に着地）
