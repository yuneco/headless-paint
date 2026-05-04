# レイヤー複製・下統合の core API 追加

## 背景

paint-app のレイヤーパネルに `Duplicate` と `Merge down` を追加するため、Canvas pixels / meta / 履歴 command / replay を横断する処理を headless-paint 側の first-class API として提供した。

アプリ側で Canvas 合成や履歴 command を都度実装すると、`renderLayers` / `composeLayers` と異なる合成規則になりやすく、Undo/Redo や checkpoint replay の扱いも複雑化する。そのため、複製・下統合を atomic layer operation として core に追加した。

## 実装仕様

### engine

- `cloneLayer(source, options?)`
  - source と同じサイズの新規 layer を作成する。
  - source meta をコピーし、`options.meta` を上書き適用する。
  - `options.id` で replay / redo 用の決定的 ID を指定できる。
  - `options.copyPixels` の既定値は `true`。
- `copyLayerPixels(source, target)`
  - target を clear してから source pixels を `source-over` でコピーする。
- `mergeLayerDown(targetLayer, sourceLayer, options?)`
  - target / source の `opacity` と `compositeOperation` を考慮して source を target pixels に焼き込む。
  - `visible` は pixel burning を gate しない。非表示レイヤーの pixel buffer も統合対象にする。
  - 統合後 target meta は既定で target の `name` / `visible` を維持し、`opacity: 1`, `compositeOperation: "source-over"` に正規化する。
  - non-normal blend mode や backdrop 依存の見た目を含む場合、全スタック表示結果の完全維持は保証しない。これは2レイヤーの破壊的統合として扱う。

### stroke

- `DuplicateLayerCommand` / `MergeLayerDownCommand` を structural command に追加した。
- `duplicateLayerAtomic(layers, options)` を追加した。
  - source layer の検索、insertIndex 正規化、pixel/meta copy、新規 layer 作成、updated layers 作成、command 作成を1つの結果として返す。
  - 既定の挿入位置は source の直上（`sourceIndex + 1`）。
- `mergeLayerDownAtomic(layers, options)` を追加した。
  - source と直下 target（`sourceIndex - 1`）の検索、target への焼き込み、source 削除、updated layers 作成、command 作成を1つの結果として返す。
  - source が存在しない、または source が最背面の場合は `null` を返す。
- `applyDuplicateLayerCommand` / `applyMergeLayerDownCommand` を追加した。
  - Redo / replay 用に recorded command の ID / index / meta を使って決定的に適用する。
  - command に記録された topology と現在 layers が一致しない場合は `null` を返す。
- checkpoint coverage / eviction / affected layer 判定を追加した。
  - `duplicate-layer`: source layer の checkpoint coverage が必要。affected は複製先 layer。
  - `merge-layer-down`: source / target 両方の checkpoint coverage が必要。affected は source / target。
  - checkpoint eviction は duplicate / merge の pixel dependency を考慮し、unrebuildable な操作を跨いで Undo できないよう `undoFloorIndex` を更新する。
- `rebuildLayerFromHistory` は duplicate / merge の pixel effect を command index 順に replay できるよう拡張した。
  - duplicate layer は source layer の duplicate 直前状態を再構築してコピーする。
  - merge target は source / target の merge 直前状態を再構築して再統合する。
  - add / duplicate で作成された layer は checkpoint がなくても空状態から replay を開始できる。

### react

- `usePaintEngine` に `duplicateLayer(layerId)` / `mergeLayerDown(layerId)` を追加した。
- React hook 利用者は Canvas 合成や checkpoint coverage を直接扱わず、低レベル API 利用者と同等の Duplicate / Merge down を利用できる。
- `duplicateLayer` は複製先を active layer にする。
- `mergeLayerDown` は統合先 target を active layer にする。
- Undo / Redo では `duplicate-layer` / `merge-layer-down` を明示的に処理する。
- `merge-layer-down` Undo では target pixels だけでなく `targetMetaBefore` も復元する。

### apps/web

- デモアプリのレイヤーパネルに Duplicate / Merge down ボタンを追加した。
- apps/web から `usePaintEngine` の high-level action を呼び、デモ上で一通り操作と Undo / Redo を確認できる構成にした。

## paint-app との責務分離

headless-paint 側で提供するもの:

- レイヤー pixels / meta をコピーするプリミティブ
- 2レイヤーを表示合成規則に沿って焼き込むプリミティブ
- duplicate / merge down の atomic operation
- duplicate / merge down の structural command 型
- history の pixel scope / checkpoint dependency / affected layer 判定
- replay / rebuild 用の apply API
- core / react export と docs / tests

paint-app 側に残すもの:

- `...` メニュー UI
- 選択レイヤー、active layer、disabled 条件
- 複製名の採番
- inline rename
- persistence callback、dirty tracking、orphan cleanup との接続
- commandLog replay 後の dirty marking と source orphan cleanup

## 実装時の調整内容（補足）

- 計画初期段階では duplicate の checkpoint coverage が不足していた。複製元 pixels に依存するため、`duplicate-layer` でも source layer の pre-write checkpoint coverage を必須にした。
- `useLayers` には atomic operation の結果を反映する API がなかったため、`replaceEntries` を追加した。
- `rebuildLayerFromHistory` は draw command だけを replay する構造だったため、duplicate / merge の structural pixel effect を command index 順に扱うよう拡張した。
- `merge-layer-down` Undo で target meta が戻らない問題を確認し、`targetMetaBefore` の復元を追加した。
- paint-app 側プランへ、ライブラリ実装側からの申し送り事項を追記した。

## ドキュメント

- `packages/engine/docs/README.md`
- `packages/engine/docs/layer-api.md`
- `packages/engine/docs/types.md`
- `packages/stroke/docs/README.md`
- `packages/stroke/docs/types.md`
- `packages/stroke/docs/session-api.md`
- `packages/stroke/docs/history-api.md`
- `packages/react/docs/README.md`
- `packages/react/docs/INTERNALS.md`

## テスト・検証

- `pnpm --filter @headless-paint/engine test`
- `pnpm --filter @headless-paint/stroke test`
- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## 完了条件

- paint-app が Duplicate / Merge down を1 command の atomic operation として呼ぶための API が core から利用できる。
- React package 利用者も `usePaintEngine` から同等機能を利用できる。
- duplicate / merge down の structural command が履歴システムの既存設計に沿って扱われる。
- app 側に Canvas 合成規則の再実装を強いない。
- apps/web のデモアプリから Duplicate / Merge down を実行でき、Undo / Redo で確認できる。
- docs と tests が新規 API を説明・検証している。
