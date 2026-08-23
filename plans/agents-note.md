# Agents Note

LLMエージェントの作業メモ。設計ドキュメントではない。セッション完了ごとに整理する。

## 発見した課題・改善候補

- **Rough bristleの固定紙目＋反復接触はProduction官能gate通過（2026-08-23）**: `4db92c8`で、Fine toothをdocument座標へ固定したsoftware raster、pixel-local pressureによる0/1寄りの面掠れ、同じ場所を擦るほど未着彩部が埋まるstochastic repeated contactをProductionへ統合した。ユーザー評価は合格であり、これをRough bristleの現行Production基準とする。共通Paper Surface、半透明塗料、紙の摩耗・顔料厚モデルは含まず、必要なら別課題として扱う。
- **Apple Pencil実機評価はHTTPS必須（2026-08-22）**: LAN上の平文HTTPではSafariの`getCoalescedEvents()`が露出せず入力点密度が下がり、補間・ブラシ性能の評価を誤る。rootの`pnpm dev:https:setup`で現在のLAN IPをSANへ含むignored証明書を生成し、`pnpm dev:https`で起動する。iPadでは生成したlocal CAをインストールして完全信頼を有効にする。
- **Production web統合後の最終実機gate（2026-08-23更新）**: Acrylic v2 / Rough bristleは`apps/web`でまとめて評価できる。Labで採取した461点・約1.92秒の固定入力をcoalesced batchごと再生した最終WebKit値は、Rough混色OFFでCall p50 / p95 `6 / 15ms`、batch wall p50 / p95 `5 / 15ms`（Lab p95 `15ms`と同等）。max `78ms`のcold resource生成は残る。Acrylicの旧late / early値はPlaywrightが1点ずつawaitするfixtureでGPU/同期負荷を隠していたため破棄する。残件はiPad Safariで長時間stroke、描画直後UI、tab安定性、cold first stroke、25〜100% zoom高速操作を官能確認すること。webのCall metricは同期engine callbackだけで非同期GPU完了を含まない。
- **Rough bristleのLab textureはprocedural Fine tooth（2026-08-23更新）**: 外部画像assetではなく、2周波value noiseによるdocument-spaceの高さ場だった。Lab参照値はscale 4px / amount 0.85 / hardness 0.82 / seed 1、Production既定値は官能評価によりscale 4px / amount 1 / hardness（UI上のContrast）0.75 / seed 1へ決定した。Productionでは高さ場をseed / scale単位で共有し、swept quadのsoftware raster内でpixel-local pressureと接触させる。追加ライセンスはない。TEX-03で収集した外部CC0画像はOrganic sponge向け監査素材であり、Roughのreferenceとしてproductionへ入れない。
- **Rough bristleの入力batchはpointer event境界から分離（2026-08-22）**: `getCoalescedEvents()`をReact→strokeへbatch搬送する一方、bristle geometryはtimestamp 32msまたは累積距離1.5Bで決定的にflushする。caller batchが異なってもpixel一致し、live/replay/Undoの結果をイベント配送頻度へ依存させない。通常brushは従来の1点単位描画を維持する。
- **Acrylic v2のWebKit readback律速を修正（2026-08-23）**: 旧Productionは`updateDistancePx`ごとに18×8 scratchへcheckpointを描いて`getImageData`しており、高密度1920 samplesで2347 readbacks・約3.7秒を占めた。checkpoint更新時だけ有限tileを一度readbackし、その間はcached pixelsからCPUで進行方向付きbilinear samplingする方式へ変更した。同じ8 samples/frame相当のWebKit fixtureで同期dispatch p95は`24ms → 11ms`、4 samples/frame相当3600 samplesではp50 / p95 `6 / 9ms`、前半/後半p50 `5 / 6ms`。Canvas source ringは無効、`willReadFrequently`はp95 30msへ悪化したため採用しない。iPad実機の長時間stroke・描画直後UI・タブ安定性は引き続き最終gateとする。
- **Mixing / bristleのpendingはengine-level no-opに固定（2026-08-22）**: 色場・毛束状態と確定canvasの因果順序をrollback可能なpendingへ含める複雑性を避けた。汎用input pluginとして`causal-adaptive`（過去情報だけを使う速度・急旋回適応補正）を追加し、`apps/web`ではAcrylic v2とRough bristleへ標準適用する。他ブラシの既存smoothing設定は変えない。
- **Rough bristle production初期版は不透明paintを対象とする（2026-08-23更新）**: 連続掃引chunkは小さく重ねて継ぎ目を防ぐため、半透明paintでは重なり濃度が見える可能性がある。反復接触は追加pigment canvasを持たず、document固定の高さ場へpixel-local pressureで0/1接触し、谷に確率的な再接触を与える。半透明対応や厳密な顔料厚は必要性を再評価してから別設計にする。
- **Rough bristleの面掠れ・紙目・反復接触は同じsoftware rasterで最終判定する（2026-08-23更新）**: Lab COMB同様、低解像度の符号付きpaint fieldをswept quadへbilinear補間し、最終pixelでhardnessとFine toothへの接触を判定する。紙目判定もchunk平均筆圧からpixel-local pressureへ変更した。初回未着彩cellへalpha floorを置かず、canonical distance trialごとの確率的再接触で不透明片だけを増やす。461点fixtureのWebKit Call / batch wall p50 / p95は`4 / 16ms`、固定S字は`1 / 9ms`。共通Paper Surface resourceは別作業だが、Roughの暫定Fine toothはその将来resourceと同じdocument座標契約を守る。
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
