# 更新リリース前レビュー

対象: `613ac33`。npm 公開済み `@yuneco/headless-paint@0.0.12` の tarball と現在の成果物を比較。
レビュー時の結論: **現状のままのリリースは非推奨。R1 の履歴再構築不具合を先に修正する。**
以下はレビュー時点の記録。ユーザー承認後、R1〜R5は修正済み。結果は [修正計画](../2026-09-20-01-37_release-review-fixes.md) を参照。配布文書の同梱・バージョン変更・公開は今回の修正対象外。

## 調査範囲・検証

- engine 全11、input 全7、stroke 全8ドキュメントを各 src と照合。React README / INTERNALS、公開 core / react の型とエントリ、README、配布設定も確認。
- `npm view` で現行公開版が 0.0.12 であることを確認。公開 tarball の型宣言と現行 dist を比較。
- `npm pack --dry-run --ignore-scripts` で配布内容を確認。8ファイル（dist 7 + package.json）のみ。
- 直前の同一コードの検収は typecheck、全パッケージ build、公開成果物検証、lint、Chromium 62ファイル775テスト成功。今回のレビューではその結果を再利用し、下記再現確認を追加した。
- R1 は配布済みビルドの `executeHistoryOp` を Node から実行し、Canvas2D context を記録用の代替実装にして誤った消去呼出しを再現。実ブラウザの新規回帰テストは未追加。
- WebKit / iPad 実機、性能、長時間描画を今回新たに検収したわけではない。

## R1 — P1: 他レイヤーの描画コマンドが Undo 対象に適用される

- 箇所: `packages/stroke/src/replay.ts:193-197`。
- `rebuildLayerFromHistory` は checkpoint 以降の全 draw command を `layerId` で絞らずに replay する。呼び先の `replayCommand` にも対象レイヤー判定はない。
- 再現: A に赤い checkpoint、履歴が「B を clear」「A を clear」の順。A の clear を Undo すると、A の赤い checkpoint を復元した直後に B の clear を A に適用し、透明にする。結果は `ok: true` となる。
- 期待値: A の画素 `[255, 0, 0, 255]`。実測した代替 context の画素: `[0, 0, 0, 0]`。
- 通常の Undo/Redo、複製元や結合元の履歴再構築にも同じ処理が使われる。GPU の直前 Undo キャッシュに hit しない経路も影響する。
- `packages/stroke/docs/history-api.md:153` の「該当レイヤーの draw command と wrap-shift」の契約違反。
- 0.0.12 にも存在する既存バグで、今回の新規回帰ではない。しかし画素を失うためリリース前に修正すべき。
- 対応: レイヤー限定の draw command は ID 一致時のみ適用し、全体操作の wrap-shift は従来どおり適用する。複数レイヤーの clear / stroke / transform と wrap-shift 混在、Undo/Redo・duplicate/merge の回帰テストを追加する。

再現の核:

```js
const state = {
  ...createHistoryState(1, 1, { layerCount: 2 }),
  currentIndex: 1,
  commands: [createClearCommand("B"), createClearCommand("A")],
  checkpoints: [{
    id: "cp-A", layerId: "A", commandIndex: -1, createdAt: 0,
    payload: { type: "raw", imageData: redImageData },
  }],
};
executeHistoryOp("undo", state, { layers: [layerA] });
// A.ctx.putImageData(redImageData) の後に A.ctx.clearRect が呼ばれる。
```

## R2 — P2: 0.0.12 からの破壊的変更をまとめた移行案内がない

公開 tarball と現行型から確認した変更:

| 0.0.12 | 現行 | 利用アプリへの影響 |
|---|---|---|
| `BrushTipRegistry` / `createBrushTipRegistry` | `BrushAssetRegistry` / `createBrushAssetRegistry` | import の変更 |
| registry の `get` / `set` | `getTip` / `setTip`、高さマップ用2メソッド | 呼出し変更、独自実装の更新 |
| hook / runtime の `tipRegistry` | `registry` | config の変更 |
| `BrushMixing.pickup` / `restore` | 距離rate・diffusion・checkpoint・field寸法を含む新schema | 単純改名ではない設定の見直し |
| 手組み `BrushDynamics` | `spacingSizeCoupling` 必須 | 従来動作なら `0` を追加 |
| 手組み `BrushRenderState` | `heightMap` 必須 | 非bristleなら `null` を追加 |
| 3種類の `BrushConfig` | bristle 追加 | exhaustive switch 等の更新 |

`packages/react/src/persistence.ts:776-792` は旧混色schemaを拒否する。旧 `mixing` を含む保存設定は混色が disabled でも `importPaintSettings` 全体が `null` になる。互換性を切ること自体は既存方針どおりであり、勝手に変換を追加すべきではない。React README にこの契約の記述はあるが、更新利用者向けに変更一覧、設定の再作成・復元失敗時の扱いをまとめる必要がある。

## R3 — P2: 点列の累積／差分と描画タイミングの説明が不正確

- `packages/input/docs/filter-pipeline-api.md:144`: `committed` を「新しく確定した点」と説明。実装は累積点列。説明どおり毎回 append すると過去点を重複描画する。
- `packages/stroke/docs/session-api.md:93`: `filterOutput.committed` を追記するとの説明も同様。実装は累積点列で置換。
- `packages/react/docs/README.md:435`: 全描画ブラシが終了まで pending 側に全ストロークを描く説明。現行の混色 stamp / bristle は committed 側へ逐次描画する。ブラシ別の挙動とキャンセルの復元責務を区別する必要がある。
- React `StrokeCompleteData.totalPoints` の説明は確定済み点数だが、実装は `command.inputPoints.length`（入力点数）。

## R4 — P2: 公開APIの型・利用例が一致しない

- `packages/engine/docs/brush-api.md:345,352`: `BrushRenderState` の例に必須 `heightMap` がなく、現行型ではコンパイル不能。`:358` は次回へ `nextState.branches[0]` を渡す説明だが、実引数は `nextState` 全体。
- `packages/stroke/docs/command-executor.md:34`: `shiftTempCanvas?: Layer` と記載、実装は `OffscreenCanvas`。`:49` の `command` も実際は optional。
- `packages/stroke/docs/history-api.md:146-150`: `rebuildLayerFromHistory` の第4引数 `ReplayOptions` が脱落し、GPU設定を渡す方法が示されない。
- stroke docs の `ReplayOptions`、Stroke Machine の関数・型は、外部公開 `/core` から名前付き import できない。内部専用とするか、正式公開するかを整理する。機械的なexport追加はしない。
- `packages/react/docs/README.md:94`: `setBrushPressureDynamics` が `PressureDynamics` のみ。実装は spray / bristle の型も受け付ける。
- 同 `PaintEngineConfig` に公開済みの `gpuCommitMode` が未記載。

## R5 — P2: 入力処理のサンプルが意図した挙動にならない

- `packages/input/docs/sampling-api.md:124-131` の約60fps制限例は、距離・時間が OR 条件なので1px進めば16ms未満でも採用。配布APIで2px移動・1ms後を採用することを確認。`types.md:73-77` の「両方」も訂正が必要。
- `packages/input/docs/coordinate-api.md:126-142` は画面移動を逆回転して `pan` に渡すが、`pan` は Screen Space。90度回転中の右ドラッグが上移動になる。画面移動量を直接渡す必要がある。
- `input/docs/README.md:54-55`、`transform-api.md:350-356` は nullable な `screenToLayer` の結果をガードせず利用。
- これらは基本的に既存問題。更新リリースで文書を整える対象に含める。

## 配布とその他の改善事項

- npm tarball に README / API docs / LICENSE がなく、package.json に repository / homepage の導線もない。リポジトリの文書を直しても配布物から参照できないため、少なくともパッケージREADMEと文書URLを用意する。MIT表記に対応するLICENSEの配置も確認する。
- GPU の説明に mixing stamp のみと bristle も対象という記述が混在。低レベル `renderBrushStroke` に accelerator を渡すだけでは GPU stroke は開始されず、runtime / replay の lifecycle 管理が必要なことを明記する。
- `BrushPressureState` は文書にあるが名前付き非公開。逆に `GpuResidencyInvalidationReason` / `GpuStrokeOwnerLabel` は公開されているが説明がない。内部状態・診断型の公開範囲は将来の互換性を考えて整理する。
- readonly 漏れ、実装済みAPIの「設計ドラフト」表記、React INTERNALS の旧構造説明（`onStrokeStart(point, true)`、pending を layers に挿入する説明等）が残る。
- 既存の公開成果物検証は workspace 内での自己参照。独立したアプリへ tarball をインストールする試験、とくに `/react` と React 18 / 19 の型解決は別途確認するとよい。

## 推奨する順序

1. R1 の修正と複数レイヤーの回帰テスト。
2. R2〜R5 の移行案内・APIドキュメント修正。公開範囲の判断が必要な項目は利用例を確認してから実装。
3. 配布文書の導線整備、全build / test / lint と独立したtarball利用確認。
4. バージョン更新と更新リリース。番号の変更だけで互換性問題の説明を省略しない。
