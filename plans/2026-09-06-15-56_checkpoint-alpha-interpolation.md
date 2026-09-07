# Checkpoint の alpha 重み付き補間

ユーザー指定の修正方針・検証内容を承認済み仕様として実施。コミットしない。

## Phase 1: ドキュメント

- 公開 API / 型定義は変更しない。
- CPU / GPU の checkpoint 補間を `a = Σwᵢaᵢ`, `rgb = Σwᵢaᵢcᵢ / a` に統一する。alpha 0 は RGBA 0。
- gpu-acceleration.md に補間契約を追記し、黒混入の既知事項を削除する。

## Phase 2: 利用イメージ

- stamp / bristle の既存呼び出しを維持する。透明下地と黄色の境界を拾っても黄色の RGB は暗化しない。
- API 変更はなく、ユーザーが上記の式・利用結果・実装を指定済み。

## Phase 3: 実装・検証

- CPU の straight RGBA を alpha 重み付きで累積し、GPU の 3 sampling 経路は premultiplied 補間後に一度だけ unpremultiply する。
- CPU / GPU の fraction 0.5 と透明境界、黄色 field の暗化防止を回帰テストで確認する。
- pickup / restore / diffusion と既存 Tier B / cross-backend parity の比較ロジック・閾値は変更しない。
- `pnpm -r build`、`pnpm lint`、`pnpm run typecheck`、指定のノンブラウザテストを実行する。

## Phase 4: レビュー

- review-library-usage に沿って API・実装・ドキュメント整合を確認する。
- Canvas / WebGL に依存する未実行テストは明記し、実ブラウザ検収を Claude に引き継ぐ。

## 実施結果

Phase 1〜4を実施。CPU / GPU の補間と回帰テストを追加し、文書を更新した。build / lint / typecheck は成功。Node環境では145件成功、Canvas / WebGL依存192件は検証不能。追加CPU回帰6件は旧式で全件失敗・修正式で全件成功。実ブラウザ検収はClaude待ち。詳細と未実行テスト名は [検証結果](./2026-09-06-15-56_checkpoint-alpha-verification.md) を参照。コミットしていない。
