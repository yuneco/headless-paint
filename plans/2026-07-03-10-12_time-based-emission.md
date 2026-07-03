# 時間ベースemission（吹きつけ）対応プラン

旧プラン `plans/pendings/2026-06-18-20-58_stamp-time-dabs.md` を、sprayブラシ追加・brushモジュール分割後の現状に合わせて更新し、実装したもの。**実装完了（2026-07-03）**。

## 背景と目的

stamp/sprayブラシは距離ベースemission（累積距離が `spacingPx` に達した地点に配置）のみで、一点にブラシを押し当て続けても描画が濃くならなかった。エアブラシ的な「押し続けている間、時間経過でその場に繰り返し描画される」体験（吹きつけ）を、stamp / spray両ブラシに追加した。吹きつけはブラシ設定でON/OFF可能。

## 実装された仕様

### 外部IF

- `StrokePoint.timestamp?: number` — 入力時刻(ms)。ない点列では時間emissionは発生せず従来互換
- `BrushDynamics.emissionsPerSecond?: number` / `SprayDynamics.emissionsPerSecond?: number` — 吹きつけレート。正の有限数で有効、未指定 or 0以下でOFF（ON/OFFはレート値の有無で表現、独立フラグなし）
- `BrushBranchRenderState.lastTimestamp?` / `nextTimeEmissionAt?` — branchごとの時間emission位相
- `walkEmissions(interpolated, spacingPx, startState, overlapCount, emit, timeSpacingMs?)` — 第6引数追加
- `timeSpacingMsFromRate(emissionsPerSecond)` — レート→ms間隔変換（engine/core/publicからexport）
- プリセット `AIRBRUSH` / `SPRAY_AIRBRUSH` に `emissionsPerSecond: 30` を設定

詳細は `packages/engine/docs/brush-api.md` / `types.md` を参照。

### アーキテクチャ

1. **engine（scheduler統合）**: `walkEmissions()` が距離emissionと時間emissionをセグメント内の発生位置順（時間emissionは両端timestampの線形比率で位置決定）にmergeし、**単一の `emissionIndex` 空間**を消費する。PRNGは `hashSeed(branchSeed, emissionIndex)` のままなので、incremental描画とreplayでPRNG列が一致する。engineは現在時刻を一切読まない
2. **二重配置防止**: 時間位相はbranch stateに保持し、`lastTimestamp` 以前のoverlap再入力区間は時間emission対象外。`cloneBrushRenderState()` が時間stateも複製するため、pending再描画がcommitted stateを進めない
3. **stroke**: session / replay の全変換（`toStrokePoints` / replay map / expand / Catmull-Rom補間）でtimestampを保持。補間は両端がtimestampを持つ場合のみ線形補間
4. **react（synthetic input）**: `useStrokeSession` が吹きつけ有効ブラシの描画中、setTimeoutで「最後の座標・筆圧＋`performance.now()`」のsynthetic InputPointを `onStrokeMove` と同経路で注入し履歴に保存する。実入力・synthetic問わず入力のたびに再スケジュール＝入力がレートより速い間は発火しない。timerはstroke end / cancel / unmountで停止
5. **replay等価性**: replayは保存済み `inputPoints`（timestamp込み）と `brushSeed` のみで再現。timer不使用
6. **混色（mixing）**: 更新は従来どおり距離ベースのまま。静止中は直近の混色状態を再利用（docsに明記）
7. **web UI**: BrushPanelに「Airbrush Buildup（吹きつけ）」トグル+Rateスライダー（1〜60/sec）。persistenceは正の有限数のみ復元

## 検証結果

- `pnpm build`（typecheck込み）・テスト339件・lint 全グリーン
- 新規テスト: scheduler（静止時間emission、距離+時間merge順序、incremental/一括一致、overlap二重配置防止、timestampなしfallback、`timeSpacingMsFromRate`）、state clone（時間state複製）、stamp統合（押し続けで濃くなる+emissionCount決定性）、session（timestamp保持）
- 実機（Playwright）: Airbrush押し続けで濃度上昇、**Undo→Redoでピクセル値完全一致**（replay等価性）、sprayの静止吹きつけを確認
- docs: engine 6ファイル、stroke 3ファイル、react 2ファイル、`docs/overview/stroke-composition.md` を更新（codexに委譲しレビュー済み）

## 実装時の調整内容（補足）

- `useStrokeSession` のレート→間隔変換は当初ローカル実装だったが、coreの `timeSpacingMsFromRate()` 再利用に修正
- `toStrokePoints()` のstroke / react重複は解消せず維持（strokeの関数は非公開で、5行のmapperのためにAPI公開する価値が低いと判断）
- react docsの `StrokeCompleteData.alphaLocked` 記載漏れ（既存のdoc drift）をあわせて修正

## 保留事項

- 時間emission専用flow倍率（濃くなりすぎ対策）や近接emission抑制
- 静止中の混色（mixing pickup）更新を時間ベースにするか
- 時間ベースemission中のfade（噴射開始/終了のエンベロープ）
- synthetic point生成のDOM非依存helper化（inputパッケージへの切り出し）
- `sizeJitterMode` の1本化（別作業）
- zoom-aware sampling（別プラン、`plans/pendings/2026-06-18-20-58_zoom-aware-sampling.md` に残置）
