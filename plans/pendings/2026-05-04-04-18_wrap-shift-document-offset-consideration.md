# wrap-shift をドキュメント設定値化する検討

## 位置づけ

このファイルは検討結果の記録であり、実装計画ではない。Doc-First の Phase 1 以降、API ドキュメント更新、コード変更はまだ行わない。

## 背景

現状の wrap-shift は `wrapShiftLayer()` で全 committed layer のピクセルを物理的にラップ移動している。

この方式は表示上は単純だが、以下の負担がある。

- ドラッグ中に全レイヤーへ `drawImage` ベースのコピーが走るため、レイヤー数・キャンバスサイズに比例して重い
- `wrap-shift` が全レイヤー影響の DrawCommand になり、Undo/Redo、replay、checkpoint、history pruning で特別扱いが必要になる
- checkpoint ベース Undo の設計でも、wrap-shift のために全レイヤー pre-write checkpoint、`baseCumulativeOffset`、all-scope coverage 検証などが必要になる
- 操作の意味は「表示上のタイル原点をずらす」に近いのに、実装上は「全ピクセルを書き換える破壊的操作」として扱われている

## 結論

wrap-shift は物理ピクセルの移動ではなく、ドキュメントのグローバルな `wrapOffset` 設定値として扱う方向が妥当。

最も透過的に吸収できる場所は、履歴やレイヤー書き換えではなく、次の2つの境界である。

1. 表示境界: `renderLayers` / パターンプレビューなど、Layer を画面・タイルへ描画する箇所
2. ストローク描画境界: 入力点を FilterPipeline に通した後、committed / pending layer へ焼く直前

`screenToLayer()` 直後の raw input を即座に物理座標へ変換する案は避けるべき。smoothing や straight-line が物理座標の wrap ジャンプを見てしまい、中央に移動したシームを跨ぐ自然なストロークが不連続になるため。

## 推奨モデル

レイヤーのピクセルは常に canonical / physical 座標に保存する。`wrapOffset` は「physical 座標のピクセルを visual 座標へどれだけ表示シフトするか」を表すドキュメント設定にする。

既存の `wrapShiftLayer(layer, dx, dy)` と同じ見え方に合わせるなら、符号は以下が自然。

- physical -> visual: `visual = physical + wrapOffset`
- visual -> physical: `physical = visual - wrapOffset`

つまり、現在の物理シフト `dx = +100` と同じ表示にしたい場合、`wrapOffset.x = 100` とし、表示時は layer canvas を `(+100, ...)` 側へ4コピー描画する。ユーザーが visual 座標 `v` に描いた点は、canonical には `v - wrapOffset` で保存される。

## どこで吸収するか

### 1. 表示

`renderLayers()` に現在の `wrapOffset` を渡し、各 layer を4コピーで描画する。

これにより offset 変更は state 更新 + 再描画だけになり、Layer の canvas は書き換えない。

対象は committed layer だけではなく、pending overlay と transform preview も同じ visual 空間に見える必要がある。pending はそのストローク開始時に捕捉した offset で physical に描かれているため、通常表示では現在の document offset に従って committed と同じように表示すればよい。

パターンプレビューは「現在の表示 offset を反映したタイル」と「canonical タイル」のどちらを見せたいかを仕様として決める必要がある。ユーザーがシーム確認中に見るプレビューとしては、現在の表示 offset を反映した方が直感的。

### 2. 入力から描画まで

pointer handler はこれまで通り `screenToLayer()` で visual layer coordinate を返すだけにする。ここに wrapOffset を混ぜない方が責務が薄い。

`useStrokeSession` もしくはその直下の描画関数で、ストローク開始時の `wrapOffset` をキャプチャする。

推奨フロー:

```text
PointerEvent
  -> screenToLayer = visual point
  -> FilterPipeline / StrokeSession は visual point として処理
  -> committed/pending へ描画する直前に visual -> physical 変換
  -> physical wrap 境界で stroke segment を分割
  -> appendToCommittedLayer / renderPendingLayer
```

この位置で吸収すると、FilterPipeline はユーザーが見ている連続した座標を扱える。一方、Layer に焼かれるピクセルは常に canonical 座標になる。

### 3. 履歴

`wrapOffset` 変更を DrawCommand として扱わない。

選択肢は2つある。

- offset 変更は履歴対象外のドキュメント表示設定にする
- offset 変更を Undo 可能にする場合も、ピクセル影響を持たない settings command として扱う

少なくとも stroke / clear / transform-layer の replay に `wrap-shift` を挟む必要はなくなる。

ただし、ストロークコマンドには「描画時の wrapOffset」を保存する必要がある。後から document offset が変わっても、replay 時に当時と同じ physical 位置へ焼くため。

`StrokeCommand` は概念的に以下を持つ。

```ts
readonly wrapOffset: { readonly x: number; readonly y: number };
```

保存する input points は visual 座標のままにするのがよい。replay では FilterPipeline を visual 座標で再実行し、その後に保存済み `wrapOffset` で physical 変換する。

## 既存ピクセルシフト方式との差分

### 負荷

現行方式は offset ドラッグ中に全レイヤーのピクセルを毎回コピーする。

設定値方式では offset ドラッグ中は `wrapOffset` の更新だけになり、実コストは画面再描画時の4コピーに寄る。レイヤーの実データを書き換えないため、Undo/Redo や checkpoint のための追加コピーも不要になる。

### 履歴

現行方式では `wrap-shift` が all-scope DrawCommand で、以下へ波及している。

- `getCommandsToReplayForLayer()` が全レイヤー replay に wrap-shift を混ぜる
- `getAffectedLayerIds()` が wrap-shift を含む範囲を `{ type: "all" }` にする
- Undo/Redo が wrap-shift だけ高速パスで逆方向/順方向シフトする
- checkpoint pruning では wrap-shift prefix の累積値を別管理する必要が出る

設定値方式では、wrapOffset 変更そのものはピクセル履歴から外せる。履歴で残すべきなのは、各 stroke がどの offset 表示下で描かれたかだけ。

### 概念

現行方式では「タイル原点を移動して編集する」という UI 操作が、「全レイヤーのピクセルを変更する」というデータ操作になる。

設定値方式では UI 操作とデータ操作を分離できる。wrapOffset は viewport / document presentation に近い値であり、Layer canvas は canonical storage として安定する。

## 境界分割の必要性

visual 座標では連続した線でも、`visual -> physical` 変換後に canvas の端でジャンプする場合がある。

例:

```text
layerWidth = 1024
wrapOffset.x = 512
visual x = 510 -> physical x = 1022
visual x = 514 -> physical x = 2
```

この2点をそのまま描画すると、canvas 全幅を横切る線になる。したがって、描画直前に wrap 境界を検出し、stroke segment を分割する必要がある。

分割判定は、変換後 physical の距離閾値だけに頼るより、visual 座標に offset を適用した unwrapped 値が `width` / `height` の倍数を跨いだかで判定する方が安全。直線ツールなど長い線分でも誤判定しにくい。

Expand 後のコピーについても、canonical 範囲外へ出た点を modulo で戻すなら境界分割が必要になる。Expand は現状ほぼ等距離変換なので閾値分割でも成立しやすいが、将来スケール付き Expand を入れるなら前提が崩れるため、可能なら同じ unwrapped 情報を持って分割できる設計が望ましい。

## パッケージ責務の候補

### engine

担当すべきもの:

- `WrapOffset` 型
- visual / physical 変換ヘルパー
- wrap 境界分割
- `renderLayers()` の wrapOffset 表示
- `appendToCommittedLayer()` / `renderPendingLayer()` での wrap-aware 描画、またはそのための小さな下位ヘルパー

engine に寄せる理由は、最終的な問題が「Layer canvas へどの座標で焼くか」「canvas をどう表示するか」だから。

### input

`screenToLayer()` は wrapOffset 非依存のまま維持するのがよい。

input package に visual -> physical 変換を置く案もあり得るが、FilterPipeline 前に使われやすくなり、不連続座標を smoothing に渡す誤用を誘発する。置くとしても名前で `visualToPhysicalAfterFiltering` のような利用タイミングを強く示す必要がある。

### stroke

`StrokeCommand` に描画時の `wrapOffset` を保存する責務がある。

replay では、保存済み input points を FilterPipeline に通し、保存済み wrapOffset で physical 描画する。これにより、document の現在 offset と過去 stroke の描画結果が分離される。

### react

`usePaintEngine` が document-level `wrapOffset` state を持つのが自然。

`onWrapShift(dx, dy)` は全レイヤーを書き換えず、`wrapOffset` を更新して renderVersion を進めるだけにする。`onResetOffset()` も物理逆シフトではなく `{ x: 0, y: 0 }` への設定変更になる。

ストローク開始時には現在の `wrapOffset` を session にキャプチャする。ストローク中に offset が変わっても、その stroke の描画 offset は固定する。

## 注意点

### 1. 既存ドキュメントとの過去案

`plans/2026-02-07-16-21_wrap-offset.md` に「表示オフセット + 入力変換 + 分割」案が残っている。過去には visual / physical 二重化の波及が大きいことを理由にピクセルシフト方式が採用された。

今回の検討では、履歴管理の複雑化が顕在化しているため、当時のトレードオフは再評価に値する。

ただし、過去案の「screenToLayer 後に applyWrapOffset して FilterPipeline へ渡す」流れは見直した方がよい。FilterPipeline は visual 座標で動かし、描画直前に physical 変換する方がシーム跨ぎに強い。

### 2. PNG / ドキュメント保存

Layer canvas は canonical storage なので、document export は基本的に physical canvas をそのまま保存すればよい。

ただし、ユーザーが見ている offset 済み表示をそのまま画像として export する機能がある場合は、export API に「canonical export」か「current visual export」かの区別が必要になる。

### 3. reset offset の意味

現行の `onResetOffset()` は全レイヤーを逆シフトして cumulative offset を0に戻す。

設定値方式では reset は単に表示 offset を0に戻すだけになる。見た目は変わるが、ピクセルは動かない。これは本来の「表示原点を戻す」に近い。

もし「現在の見た目を canonical に焼き込む」操作が必要なら、それは wrapOffset reset ではなく別名の destructive command として残すべき。

### 4. 既存 `wrapShiftLayer`

`wrapShiftLayer()` は完全に不要になるとは限らない。

用途を分けるのがよい。

- destructive pixel operation: `wrapShiftLayer`
- non-destructive document presentation: `wrapOffset`

ただし、UI の wrap-shift ツールは後者へ移行し、履歴の DrawCommand からは外す。

## 暫定推奨

実装へ進めるなら、次の方針が最も筋がよい。

1. document-level `wrapOffset` を正規概念として追加する
2. UI の wrap-shift ツールは `wrapOffset` 更新だけにする
3. `screenToLayer()` と FilterPipeline は visual 座標のまま維持する
4. committed / pending layer に焼く直前だけ、ストローク開始時にキャプチャした `wrapOffset` で visual -> physical 変換する
5. physical wrap 境界を描画直前に分割する
6. `StrokeCommand` には描画時の `wrapOffset` を保存する
7. `wrap-shift` DrawCommand は新仕様では廃止し、必要なら settings command として別扱いにする

この方針なら、wrap-shift の負荷と履歴仕様の複雑さを同時に下げられる。難所は境界分割と pending / Expand / パターンプレビューの整合性であり、ここを Phase 1 の API 設計で明確化する必要がある。
