# wrap-shift を document offset + layer offset で遅延 materialize する検討

## 位置づけ

このファイルは検討結果の記録であり、実装計画ではない。Doc-First の Phase 1 以降、API ドキュメント更新、コード変更はまだ行わない。

実装へ進める場合は planning-flow に従い、まず `packages/*/docs/` へ外部IFを設計してから利用イメージレビューに進む。

## 背景

現状の wrap-shift は `wrapShiftLayer()` で全 committed layer のピクセルを物理的にラップ移動している。

この方式は描画器から見ると単純だが、以下の負担がある。

- ドラッグ中に全レイヤーへ `drawImage` ベースのコピーが走るため、レイヤー数・キャンバスサイズに比例して重い
- `wrap-shift` が全レイヤー影響の DrawCommand になり、Undo/Redo、replay、checkpoint、history pruning で特別扱いが必要になる
- checkpoint ベース Undo の設計でも、wrap-shift のために全レイヤー pre-write checkpoint、`baseCumulativeOffset`、all-scope coverage 検証などが必要になる
- 操作の意味は「表示上のタイル原点をずらす」に近いのに、実装上は「全ピクセルを書き換える破壊的操作」として扱われている

一方で、wrapOffset を完全に document-level 設定値へ寄せ、ストローク描画直前に visual -> physical 変換と wrap 境界分割を行う案にも難所がある。

- visual では連続する線分が physical canvas 端でジャンプするため、stroke segment の境界分割が必要になる
- スタンプブラシでは、1つの stamp footprint が wrap 境界を跨ぐ場合に同一 stamp を最大4位置へ複製描画する必要がある
- Expand / pending / stamp jitter / mixing と境界分割を同時に扱うため、描画APIの責務が重くなる

## 結論

中間案として、document-level の `wrapOffset` を正規概念として追加しつつ、各 layer に「その layer.canvas のピクセルがどの offset 状態で materialize されているか」を示す `pixelOffset` を持たせる方向が有力。

wrap-shift 実行時は document の `wrapOffset` だけを更新し、レイヤーのピクセルは移動しない。表示や読み取りでは `wrapOffset - pixelOffset` の差分を透過的に反映する。レイヤーへ書き込む直前だけ、対象レイヤーのピクセルを document の現在 offset に一致させる。

これにより、ストローク、スタンプ、消しゴム、Expand の描画自体は現行の座標系のまま維持できる。wrap 境界分割や stamp 複製描画を通常の stroke renderer に持ち込まない。

## 推奨モデル

概念的には次の2つの offset を持つ。

```ts
interface DocumentWrapState {
  readonly wrapOffset: { readonly x: number; readonly y: number };
}

interface LayerOffsetState {
  readonly pixelOffset: { readonly x: number; readonly y: number };
}
```

`Document.wrapOffset` は、現在ユーザーが見ているタイル原点を表す。

`Layer.pixelOffset` は、`layer.canvas` のピクセルがどの document offset に一致した状態で保存されているかを表す。初期値は `{ x: 0, y: 0 }`。

読み取り時の差分は以下。

```text
delta = document.wrapOffset - layer.pixelOffset
```

`delta` が 0 なら、その layer は現在の document offset に materialize 済みであり、通常通り読める。`delta` が非0なら、読み取り側が必要に応じて wrap 付きで `delta` 分シフトした結果を見る。

書き込み前には対象レイヤーだけ materialize する。

```text
ensureLayerMaterialized(layer, document.wrapOffset):
  delta = document.wrapOffset - layer.pixelOffset
  if delta == 0:
    return
  wrapShiftLayer(layer, delta.x, delta.y)
  layer.pixelOffset = document.wrapOffset
```

この materialize はユーザー操作として独立した履歴には見せず、後続の stroke / clear / transform / merge などの書き込み操作に内包する。

## データフロー

### wrap-shift 操作

```text
onWrapShift(dx, dy)
  -> document.wrapOffset += { dx, dy }
  -> layer.canvas は変更しない
  -> renderVersion を進める
```

wrap-shift 中に全レイヤーの `wrapShiftLayer()` は呼ばない。全レイヤー pre-write checkpoint も作らない。

wrap-shift を Undo 対象にする場合も、ピクセル影響を持たない settings command として扱う。ピクセル履歴上は「まだどの layer にも書き込んでいない表示設定変更」である。

### 表示

`renderLayers()` は document の `wrapOffset` と各 layer の `pixelOffset` を受け取り、差分がある layer を wrap 付きで表示する。

```text
for each visible layer:
  delta = document.wrapOffset - layer.pixelOffset
  draw layer.canvas at delta, delta - width/height copies as needed
```

pending overlay や transform preview も、対象 committed layer と同じ visual 空間に見える必要がある。書き込み開始時に対象レイヤーを materialize するなら、通常の stroke pending は `pixelOffset == document.wrapOffset` の座標系で描かれるため、現行の pending 合成に近い扱いを維持できる。

### 入力からストローク描画まで

pointer handler はこれまで通り `screenToLayer()` で visual layer coordinate を返す。`screenToLayer()` と FilterPipeline は wrapOffset 非依存のまま維持する。

ストロークで最初に committed layer へ書き込む直前に、対象レイヤーを現在の document offset へ materialize する。

```text
PointerEvent
  -> screenToLayer = visual point
  -> FilterPipeline / StrokeSession は visual point として処理
  -> 初回 committed 書き込み直前に ensureLayerMaterialized(activeLayer)
  -> appendToCommittedLayer / renderPendingLayer は現行通り
```

この方式では、描画器から見ると「現在見えている座標系の canvas に通常通り描く」だけになる。visual -> physical 変換、wrap 境界分割、stamp 複製描画は不要。

### stamp mixing

現行仕様では、stamp mixing は描画対象レイヤーの色を source として参照する設計である。React 統合ではストローク開始時点の committed layer snapshot を `sourceLayer` として渡し、同一ストローク内で描いた dab を再度拾い続けないようにしている。

この仕様を維持する限り、mixing のリスクは比較的低い。

- ストローク開始前に対象レイヤーを document offset へ materialize する
- その materialize 後の対象レイヤーを snapshot して `sourceLayer` にする
- mixing は対象レイヤー内の現在表示座標系だけを参照する

他レイヤーを参照する混色や、表示合成後の色を拾う混色を将来追加する場合は、読み取り facade 側の offset 透過が必要になる。その機能は今回の前提に含めない。

## 履歴モデル

### wrap-shift はピクセル履歴から外す

`wrap-shift` は document offset の変更として扱い、全レイヤーの DrawCommand にはしない。

選択肢は2つある。

- Undo 対象外の document 表示設定にする
- Undo 対象にする場合も settings command として扱う

いずれにしても、wrap-shift 実行時に全レイヤーの pre-write checkpoint は作らない。

### materialize は後続の書き込み操作に内包する

レイヤーへ書き込む command は、実行時に必要なら materialize を含む複合操作として扱う。

概念的には次のような内部opになる。

```text
stroke(layer A):
  materialize-layer-offset(A, oldPixelOffset -> document.wrapOffset)
  draw-stroke(A)
```

アプリ末端の履歴では、これは1つの stroke として扱う。ユーザーに materialize command は見せない。

### checkpoint coverage

強制CPはやめる。ただし、ピクセルを書き換える command には従来通り対象レイヤーの checkpoint coverage が必要。

materialize はピクセル破壊なので、CP は materialize 前の状態を起点にする必要がある。

```text
beginHistoryMutation(activeLayer)
ensureLayerMaterialized(activeLayer)
draw stroke
pushCommand(stroke with offset metadata)
```

wrap-shift 時ではなく、そのレイヤーへ次に実書き込みする直前に CP を作る。これにより、wrap-shift だけを何度行っても全レイヤーの checkpoint を消費しない。

### command に保存すべき offset

replay で同じ結果を得るには、各書き込み command が少なくとも次を知る必要がある。

- 書き込み時の document offset
- 必要なら書き込み前の layer pixelOffset

候補は2つ。

1. `StrokeCommand` / `ClearCommand` / `TransformLayerCommand` などに `documentOffset` を持たせる
2. 書き込み command の前に内部専用の `materialize-layer-offset` op を replay stream に展開する

外部履歴をシンプルに保つなら、ユーザーに見える command は現行に近い形を維持し、replay 内部で materialize を補う設計が望ましい。ただし replay の決定性を保つため、どの offset へ materialize してから描いたかは command または周辺の settings timeline から必ず復元できる必要がある。

### replay

rebuild は checkpoint の `pixelOffset` から開始し、以降の command を時系列に replay する。

```text
restore checkpoint pixels and checkpoint.pixelOffset
for command in replay range:
  if command writes layer:
    ensureLayerMaterialized(layer, command.documentOffset)
    replay command pixels
```

checkpoint payload には、その時点の layer pixelOffset も含める必要がある。ImageData だけでは、復元した layer.canvas がどの offset に materialize 済みなのか分からない。

## 既存ピクセルシフト方式との差分

### 負荷

現行方式は offset ドラッグ中に全レイヤーのピクセルを毎回コピーする。

遅延 materialize 方式では、offset ドラッグ中は document offset 更新だけになる。表示コストは各 layer の `delta` に応じた wrap 付き draw に寄る。

実際の `wrapShiftLayer()` は、次にそのレイヤーへ書き込む直前だけ発生する。編集されないレイヤーはピクセル移動を遅延し続けられる。

### 履歴

現行方式では `wrap-shift` が all-scope DrawCommand で、以下へ波及している。

- `getCommandsToReplayForLayer()` が全レイヤー replay に wrap-shift を混ぜる
- `getAffectedLayerIds()` が wrap-shift を含む範囲を `{ type: "all" }` にする
- Undo/Redo が wrap-shift だけ高速パスで逆方向/順方向シフトする
- checkpoint pruning では wrap-shift prefix の累積値を別管理する必要が出る

遅延 materialize 方式では、wrap-shift 自体はピクセル履歴から外れる。ピクセル履歴で管理するのは、各レイヤーの `pixelOffset` と、書き込み command がどの document offset で実行されたかである。

### 描画API

完全な document offset 方式では、描画直前に visual -> physical 変換、境界分割、stamp 複製描画が必要になる。

遅延 materialize 方式では、書き込み前に対象 layer canvas を現在の document offset に揃えるため、`appendToCommittedLayer()` / `renderPendingLayer()` / `renderBrushStroke()` は現行の座標系を維持できる。

## パッケージ責務の候補

### engine

担当候補:

- `WrapOffset` 型
- offset 差分の正規化ヘルパー
- `materializeLayerOffset(layer, fromOffset, toOffset)` または `ensureLayerOffset(...)`
- offset 差分付きで layer canvas を表示・読み取り用 canvas へ描画する helper
- `renderLayers()` の offset-aware 表示

engine に寄せる理由は、最終的な問題が「Layer canvas をどの offset 状態として扱うか」「canvas をどう表示するか」だから。

### input

`screenToLayer()` は wrapOffset 非依存のまま維持する。

input package に document offset や layer pixelOffset を入れない。FilterPipeline はユーザーが見ている visual 座標を扱う。

### stroke

stroke は replay 決定性のため、書き込み command と offset metadata の関係を持つ必要がある。

候補:

- 各 pixel-writing command に `documentOffset` を追加する
- `Checkpoint` に `pixelOffset` を追加する
- rebuild 時に command の `documentOffset` へ対象 layer を materialize してから replay する

外部APIでは materialize をユーザー操作として露出しない。内部的には compound operation として扱う。

### react

`usePaintEngine` が document-level `wrapOffset` state と layer-level `pixelOffset` state を管理するのが自然。

`onWrapShift(dx, dy)` は全レイヤーを書き換えず、document `wrapOffset` を更新して renderVersion を進めるだけにする。

stroke / clear / transform / merge などの書き込み前に、対象 layer だけ `beginHistoryMutation()` -> materialize -> 書き込みの順で処理する。

## 読み取り系の注意点

読み取り系は `document.wrapOffset - layer.pixelOffset` を見て、必要な場合だけ透過的に offset を反映する。

対象候補:

- `renderLayers`
- pattern preview / visual export
- color pick
- duplicate-layer
- merge-layer-down
- transform-layer preview / commit
- content bounds

ただし、すべてを同時に offset-aware にする必要はない。Phase 1 では「どのAPIが visual 読み取りで、どのAPIが raw pixel 読み取りか」を明確に分ける。

例:

- visual 表示・ユーザーが見る結果を扱う API は offset-aware
- low-level pixel API は raw canvas を扱い、呼び出し側が事前に materialize する

## reset offset の意味

現行の `onResetOffset()` は全レイヤーを逆シフトして cumulative offset を0に戻す。

遅延 materialize 方式では reset は document `wrapOffset` を `{ x: 0, y: 0 }` に戻すだけでよい。各 layer の `pixelOffset` はそのまま残り、表示時に差分が反映される。

もし「現在の見た目を全レイヤーへ焼き込んで offset 0 に揃える」操作が必要なら、それは reset ではなく別名の destructive normalize / bake 操作として扱う。

## PNG / ドキュメント保存

保存形式には document `wrapOffset` と各 layer の `pixelOffset` を含める必要がある。

PNG など単一画像 export は仕様を分ける。

- raw export: layer canvas の実ピクセルをそのまま出す
- visual export: document `wrapOffset` を反映した見た目を出す

ユーザーが通常期待する export は visual export と考えられる。

## 未決事項

- `pixelOffset` を `LayerMeta` に入れるか、react 側の layer entry state に持たせるか
- `Checkpoint` に `pixelOffset` をどう保存するか
- pixel-writing command に `documentOffset` を直接持たせるか、settings timeline から復元するか
- wrap-shift の document offset 変更を Undo 対象にするか
- `renderLayers()` に offset を渡す外部IF
- duplicate / merge / transform / content bounds を raw API と visual API にどう分けるか
- 保存済みドキュメントの import 時、既存ファイルを `{ wrapOffset: 0, pixelOffset: 0 }` として扱う migration 方針

## 暫定推奨

実装へ進めるなら、次の方針が最も筋がよい。

1. document-level `wrapOffset` と layer-level `pixelOffset` を正規概念として追加する
2. UI の wrap-shift ツールは document `wrapOffset` 更新だけにする
3. `screenToLayer()` と FilterPipeline は visual 座標のまま維持する
4. `renderLayers()` は `wrapOffset - pixelOffset` の差分で layer を表示する
5. pixel-writing operation の直前に対象 layer だけ document `wrapOffset` へ materialize する
6. materialize は独立したユーザー履歴にせず、後続の書き込み command に内包する
7. 強制的な全レイヤー pre-write checkpoint は廃止し、実書き込み対象レイヤーだけ checkpoint coverage を要求する
8. checkpoint には layer の `pixelOffset` も保存する
9. replay は checkpoint の `pixelOffset` から開始し、各書き込み command の document offset へ materialize してから描画する

この方針なら、wrap-shift の負荷と全レイヤー checkpoint の重さを下げつつ、ストローク・スタンプ・Expand の描画器は現行の単純さを保てる。難所は描画器ではなく、offset metadata、読み取り facade、replay の責務分離に移る。
