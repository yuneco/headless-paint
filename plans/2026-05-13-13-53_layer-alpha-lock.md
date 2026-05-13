# レイヤー alpha lock 追加

## 最終仕様

レイヤー単位で透明ピクセルを保護する `alphaLocked` を追加した。alpha lock が有効なレイヤーでは、通常描画は既存 alpha のある領域にだけ反映され、通常描画では描画前の alpha channel を維持する。消しゴムは alpha lock の対象外で、従来通り `destination-out` として動作する。

公開状態は以下に限定する。

- `LayerMeta.alphaLocked`: レイヤー設定として保存・復元される永続状態。既定値は `false`。
- `StrokeCommand.alphaLocked`: ストローク作成時点の alpha lock 設定スナップショット。replay / undo / redo / rebuild では現在の `LayerMeta.alphaLocked` ではなく、常に command の値で描画する。

`createLayer` の `meta.alphaLocked` は任意指定で、省略時は `false` になる。React API では `setLayerAlphaLocked(layerId, alphaLocked)` と `toggleAlphaLock(layerId)` を公開する。alpha lock の切り替えは `visible` と同じく、ライブラリ側では自動的に Undo/Redo 履歴へ積まない。必要な場合はアプリ側が custom command として管理する。

merge down 後の結果レイヤーは、既定で下側 target layer の `alphaLocked` を引き継ぐ。明示的な result meta / command meta がある場合はそれを優先する。

## 描画方針

committed への通常描画では、alpha lock 有効時に `source-over` 相当の描画を `source-atop` に差し替える。これにより描画先レイヤーの既存 alpha をマスクとして使う。`destination-out` は差し替えず、消しゴムとして通常通り適用する。

pending layer 自体は alpha lock を評価せず、既存描画のままにする。プレビュー合成時だけ、alpha lock 有効かつ通常描画の pending を existing committed alpha でマスクする。この処理は engine の `renderLayers` / `composeLayers` 周辺に閉じ、React / web / stroke にはピクセル合成手順を露出しない。

プレビュー用 scratch には既存の `PendingOverlay.workLayer` を再利用する。今回は full-size workLayer を使う単純な設計に留め、dirty rect / 複数 rect / 面積しきい値などの最適化は実装しない。

## 実装結果

engine:

- `LayerMeta.alphaLocked` と default meta を追加。
- `appendToCommittedLayer` に描画時 alpha lock 値を渡せるようにした。未指定時は `layer.meta.alphaLocked` を使う。
- `renderPendingLayer` は alpha lock 非依存のまま維持。
- pending overlay の precompose 経路で alpha lock プレビューを反映。
- clone / meta update / merge down / structural command 周辺で `alphaLocked` を保持。

stroke:

- `StrokeCommand.alphaLocked` を追加。
- stroke session はストローク開始時点の active layer alpha lock を command とライブ描画へ渡す。
- replay は現在の layer meta ではなく command の `alphaLocked` を使う。

react / web:

- persistence の export / import で `alphaLocked` を保持。
- `useLayers` / `usePaintEngine` に `setLayerAlphaLocked` と `toggleAlphaLock` を追加。
- web demo の LayerPanel に lock / unlock ボタンを追加。

docs:

- `packages/engine/docs/`, `packages/stroke/docs/`, `packages/react/docs/` に API と挙動を反映。
- 特に stroke docs には、描画 replay が常に `StrokeCommand.alphaLocked` に従うことを明記した。

## 保留事項

alpha lock preview の dirty rect 最適化は測定後に判断する。Safari での dynamic canvas resize の不利を避けるため、最適化する場合も full-size scratch canvas を再利用し、転写範囲だけを制限する方針とする。Expand で分散した pending に対する複数 rect 管理や area threshold も、実測で必要性が出た場合に設計する。

## 検証

- `pnpm --filter @headless-paint/engine test`
- `pnpm --filter @headless-paint/stroke test`
- `pnpm --filter @headless-paint/react test`
- `pnpm build`
- `pnpm test`
- `pnpm lint`
