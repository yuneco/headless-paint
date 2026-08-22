# Agents Note

LLMエージェントの作業メモ。設計ドキュメントではない。セッション完了ごとに整理する。

## 発見した課題・改善候補

- **Apple Pencil実機評価はHTTPS必須（2026-08-22）**: LAN上の平文HTTPではSafariの`getCoalescedEvents()`が露出せず入力点密度が下がり、補間・ブラシ性能の評価を誤る。rootの`pnpm dev:https:setup`で現在のLAN IPをSANへ含むignored証明書を生成し、`pnpm dev:https`で起動する。iPadでは生成したlocal CAをインストールして完全信頼を有効にする。
- **Production web統合後の最終実機gate（2026-08-22）**: Acrylic v2 / Rough bristleは`apps/web`でまとめて評価できる。ローカルWebKit固定入力ではRough p95 `16.1–16.2ms`、late / early `0.94–0.96`、Acrylic late / early `0.61–0.80`で時間軸劣化なし。残件はiPad Safariで長時間stroke、描画直後UI、tab安定性、25〜100% zoom高速操作を官能確認すること。webのCall metricは同期engine callbackだけで非同期GPU完了を含まない。
- **Acrylic v2の新混色経路はWebKitで時間軸劣化なし（2026-08-22）**: production `apps/web`で576点の連続strokeを3回測定し、後半/前半の処理比は`0.96 / 0.86 / 1.03`、描画後preset切替は`42–78ms`だった。Playwrightが各点を同期送信するため絶対値はFPS gateに使えないが、旧CPU tip更新で見られた数秒後の桁違いの失速は再現しなかった。新方式は18x8のbrush-local連続色場と有限checkpoint tileだけを更新する。iPad実機の長時間stroke・描画直後UI・タブ安定性は最終統合時にも確認する。
- **Mixing / bristleのpendingはengine-level no-opに固定（2026-08-22）**: 色場・毛束状態と確定canvasの因果順序をrollback可能なpendingへ含める複雑性を避けた。汎用input pluginとして`causal-adaptive`（過去情報だけを使う速度・急旋回適応補正）を追加し、`apps/web`ではAcrylic v2とRough bristleへ標準適用する。他ブラシの既存smoothing設定は変えない。
- **Rough bristle production初期版は不透明paintを対象とする（2026-08-22）**: 連続掃引chunkは小さく重ねて継ぎ目を防ぐため、半透明paintでは重なり濃度が見える可能性がある。反復接触は追加pigment canvasを持たず、面掠れ・document grainの低接触floorをsource-overで蓄積する簡素なモデル。半透明対応や厳密な顔料厚は必要性を再評価してから別設計にする。
- **新Mixingの低レベルsource contract（2026-08-22）**: mixing有効な`renderBrushStroke`はtargetと別canvasのstroke-start source snapshotを要求し、同一canvasはerrorにする。通常のstroke runtimeは自動作成する。旧mixing schemaは変換せずpersistence error、非mixing stampの`spacingSizeCoupling`欠落だけ`0`補完とした。
- **Acrylic v2 production統合は旧混色方式を残さない**: `feature/acrylic-v2-production`を`main@47e6db4`から作成し、Labは`experiment/acrylic-lab@4f5a1cd`へ固定した。混色enabledのStamp / 将来のBristleは単一brush-local color fieldを共有し、旧footprint転写、旧Canvas color buffer、pending cloneを削除する。旧commandは通常の必須値補完で読める場合だけ受理し、専用legacy renderer / conversionは作らない。詳細は`plans/2026-08-22-acrylic-v2-production-integration.md`（2026-08-22）。
- **React `useStrokeSession` の旧 `StrokeCompleteData.totalPoints` は runtime command から厳密復元しにくい**: WS5 で hook を `createStrokeRuntime` の薄いラッパーにした結果、runtime の commit 出力は `StrokeCommand` のみになった。既存利用は `totalPoints < 1` のガード用途のため `inputPoints.length` で互換維持したが、フィルタ後の確定点数を public IF として残す必要があるなら runtime 側の commit payload 拡張を検討する（2026-07-05 WS5）。
- **デモUIの Line Width 上限が 50（lil-gui スライダー）**: spray は直径256px クラスの利用が想定されるが、デモUIでは試せない。上限拡大またはブラシ種別ごとの上限設定を検討したい（2026-07-03 spray 実装時に発見）。
- **spray は小径だと粒子が極端に疎**: 仕様通り（密度が面積連動）だが、lineWidth 12 程度では 1 emission あたり粒子 1 個未満になりほぼ見えない。UX として小径時の密度下駄やプリセット側の density 引き上げを検討する余地がある。
- **BrushPanelの設定同値比較を構造比較へ変更（2026-08-22）**: Bristle / Mixing追加時に手書きfield比較の漏れが再発したため、plain config全体の再帰的な同値比較へ置換した。今後BrushConfigへfieldを追加してもpreset選択表示のための列挙更新は不要。

## 中期的に行うべき作業

- **spray sizeJitterMode の整理（2026-07-04）**: 候補は `lognormal` / `bimodal` の2種類へ削減済み。`uniform` / `power` は互換フォールバックなしで削除する方針。`lognormal` はチップ4倍生成の特殊対応が残るため、今後完全に不採用にする場合は `useStrokeSession` / `replay` の tipSize 計算も戻す。

- **時間 emission（吹き付け）**: `plans/pendings/2026-06-18-20-58_stamp-time-dabs.md` 側に spray を対象として追記して実施する（spray 計画で合意済みの後続作業）。`brush/scheduler.ts` に `walkTimeEmissions()` を並列追加する拡張点は確保済み。
- **バーストテクスチャ最適化**: 現状性能は十分（256px径で chunk 0.18ms）のため当面不要。将来もっと大径・高密度が必要になったら内部最適化として検討（API 露出なし）。

## ユーザーに覚えておいて欲しいこと

- spray ブラシの `lineWidth` は「散布領域の直径」。粒子サイズは `dynamics.particleSize`（絶対px）で独立。
- 非 mixing stamp + Expand の dab 配置・jitter は branch state 統一（2026-07-03）で意図的に変わった（branch ごと独立 seed・位相）。過去データの見た目互換はない（プロジェクト方針通り）。
