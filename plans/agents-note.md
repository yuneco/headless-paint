# Agents Note

LLMエージェントの作業メモ。設計ドキュメントではない。セッション完了ごとに整理する。

## 発見した課題・改善候補

- **デモUIの Line Width 上限が 50（lil-gui スライダー）**: spray は直径256px クラスの利用が想定されるが、デモUIでは試せない。上限拡大またはブラシ種別ごとの上限設定を検討したい（2026-07-03 spray 実装時に発見）。
- **spray は小径だと粒子が極端に疎**: 仕様通り（密度が面積連動）だが、lineWidth 12 程度では 1 emission あたり粒子 1 個未満になりほぼ見えない。UX として小径時の密度下駄やプリセット側の density 引き上げを検討する余地がある。
- **BrushPanel の `isSameBrush` は手書きフィールド比較**: フィールド追加のたびに漏れが出やすい（今回 codex review で particle 比較漏れを検出・修正）。ブラシ設定の構造比較ユーティリティ化を検討。

## 中期的に行うべき作業

- **sizeJitterMode の最終選定（直近: 2026-07-04 ユーザー評価予定）**: uniform / power / lognormal / bimodal から1つに固定し、他モードのコード・フィールドを整理する。lognormal はチップ4倍生成の特殊対応があるため、不採用なら useStrokeSession / replay の tipSize 計算も戻す。

- **時間 emission（吹き付け）**: `plans/pendings/2026-06-18-20-58_stamp-time-dabs.md` 側に spray を対象として追記して実施する（spray 計画で合意済みの後続作業）。`brush/scheduler.ts` に `walkTimeEmissions()` を並列追加する拡張点は確保済み。
- **バーストテクスチャ最適化**: 現状性能は十分（256px径で chunk 0.18ms）のため当面不要。将来もっと大径・高密度が必要になったら内部最適化として検討（API 露出なし）。

## ユーザーに覚えておいて欲しいこと

- spray ブラシの `lineWidth` は「散布領域の直径」。粒子サイズは `dynamics.particleSize`（絶対px）で独立。
- 非 mixing stamp + Expand の dab 配置・jitter は branch state 統一（2026-07-03）で意図的に変わった（branch ごと独立 seed・位相）。過去データの見た目互換はない（プロジェクト方針通り）。
