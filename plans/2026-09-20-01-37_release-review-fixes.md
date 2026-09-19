# 更新リリース前レビューの修正

対象はユーザー承認済みのレビュー項目1〜4（詳細レポートのR1〜R5）。配布文書の同梱やバージョン変更・公開は対象外。

## Phase 1・2: 契約と利用イメージ

既存の `history-api.md` の契約を維持する。A の checkpoint 後に B clear → A clear → Undo を行うと、A の checkpoint の画素が復元される。B の layer-local command はAの再構築へ適用しない。全体操作の wrap-shift は両レイヤーへ適用する。前ターンのレビューで提示したこの修正方針をユーザーが承認済み。

関数シグネチャ・exportは追加変更しない。直接 `replayCommand` へ任意レイヤーを指定して描画する既存契約は維持し、履歴からの再構築で対象を選別する。
ドキュメントは現在の公開APIと動作へ合わせる。workspace 内部の Stroke Machine と名前付き非公開の ReplayOptions はその公開範囲を明示する。
移行案内はルート `CHANGELOG.md` の Unreleased に0.0.12からの変更を簡潔に記載する。

## Phase 3: 修正・検証

- 実Canvasの回帰テストを追加し、修正前の失敗を確認する。
- layer-local commandを既存の `isLayerDrawCommand` で選別し、wrap-shiftを維持する。
- engine / input / stroke / react の文書不整合を修正。
- 全build、公開成果物検証、browserテスト、lintを実行。

## Phase 4: 最終レビュー

- review-library-usageで既存API活用、契約と実装の整合、利用例を照合する。
- 結果を追記し、レビュー報告・agents-noteの未解決状態を更新する。

## 検収結果

- 実Canvas（Chromium）の回帰7件は修正前すべて失敗し、修正後すべて成功。clear / stroke / transform の対象分離、Undo/Redo、global wrap-shift、duplicate / merge の再帰再構築を確認。
- 全テスト63ファイル782件成功。テストfixtureの必須 `compositeOperation` を型検査で補完した最終状態でも対象7件を再確認。
- `pnpm build`（typecheck、全パッケージbuild、公開成果物検証）成功。`pnpm lint`、`git diff --check` 成功。
- 配布成果物からの再現コードも、UndoでAの赤画素が復元され、Bのclearが呼ばれないことを確認。
- 既存 `isLayerDrawCommand` を利用し、API追加なし。文書は累積点列、描画タイミング、型・公開範囲、sampling OR条件、panの座標系に合わせて修正。
- CHANGELOGにUnreleasedの機能・修正と0.0.12からの移行事項を簡潔に追加。READMEから参照可能。
- アーキテクトレビュー通過。直接replayの契約維持、layer-local判定の網羅性、再帰再構築への適用と7件のテスト現物、文書の整合を確認。
- 失敗再現時に生成したスクリーンショットは削除済み。bristle修正と合わせてコミット。バージョン更新・公開は未実施。
