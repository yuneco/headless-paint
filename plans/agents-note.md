# Agents Note

LLMエージェントの作業メモ。設計ドキュメントではない。セッション完了ごとに整理する。

## 発見した課題・改善候補

- **Acrylic v2 production統合は旧混色方式を残さない**: `feature/acrylic-v2-production`を`main@47e6db4`から作成し、Labは`experiment/acrylic-lab@4f5a1cd`へ固定した。混色enabledのStamp / 将来のBristleは単一brush-local color fieldを共有し、旧footprint転写、旧Canvas color buffer、pending cloneを削除する。旧commandは通常の必須値補完で読める場合だけ受理し、専用legacy renderer / conversionは作らない。詳細は`plans/2026-08-22-acrylic-v2-production-integration.md`（2026-08-22）。
