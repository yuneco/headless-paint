# Safari 混色ブラシ性能改善計画・調査記録

## 最終採用方針

このファイルは、Safari で混色スタンプブラシが極端に重くなる問題の調査記録と、最終的に採用した実装計画をまとめたもの。

最終的な対応は次の2点に絞る。

1. `renderVersion` 更新を `requestAnimationFrame` 単位に合流する
   - 混色の有無に関わらず、表示 canvas の再描画要求を実フレーム数へ近づける。
   - Safari 実機で `paint canvas` が 200回/sec 超まで増え、`browser raf` が 2fps 未満まで落ちる区間があったため、常時有効の改善として採用する。
2. 混色状態の更新を距離ベースで間引く
   - stamp の配置は従来どおり `dynamics.spacing` に従う。
   - pickup / restore / mixed dab 生成だけを `max(stampSpacing, lineWidth * BrushMixing.updateDistanceRatio)` ごとに更新する。
   - 更新しない stamp では直近の mixed dab を再利用して描画する。
   - `BrushMixing.updateDistanceRatio` はブラシパラメータへ昇格し、デフォルトは `0.5` とする。

Plan A の `masked-buffer` は一定の効果があったが、品質面で `full` と完全等価ではなく、mutable canvas source の連続描画問題も残る可能性があるため今回は採用しない。実装からは削除し、今後の fallback 候補として本記録に残す。

調査用の global flag / `console.table` / ops mode はすべて削除し、製品コードには残さない。

## 実装計画

### Phase 1: API設計・ドキュメント

- `BrushMixing` に `readonly updateDistanceRatio: number` を追加する。
- `DEFAULT_BRUSH_MIXING.updateDistanceRatio` を `0.5` にする。
- `packages/engine/docs/types.md` / `brush-api.md` / `README.md` に、距離ベースの混色更新とデフォルト値を記載する。
- `packages/react/docs/README.md` には再エクスポートされる `BrushMixing` / `DEFAULT_BRUSH_MIXING` の説明を更新する。

### Phase 2: 利用イメージ

デモアプリでは混色有効な stamp brush に対して、既存の `Pickup` / `Restore` に加えて `Mix Distance` を表示する。

`Mix Distance = 0.5` の場合、線幅の半分を目安に混色状態が更新される。`0` は従来どおり stamp ごとの更新、値を大きくすると混色更新頻度が下がる。

### Phase 3: 実装

- React 側に `useRafRenderVersion()` を追加し、`useStrokeSession` / `useLayers` の `renderVersion` 更新を RAF 単位に合流する。
- engine の stamp brush 混色状態に `mixedCanvas` と `lastMixingUpdateDistance` を持たせる。
- `renderBrushStroke` は `updateDistanceRatio` から混色更新距離を計算し、更新しない stamp では直近の `mixedCanvas` を再利用する。
- pending 再描画では committed 側の `colorBuffer` / `mixedCanvas` を複製してから使い、committed の混色状態を汚さない。
- `BrushPanel` に `Mix Distance` スライダーを追加する。
- persistence の `BrushConfig` バリデーションとテストを `updateDistanceRatio` 付きに更新する。
- Plan A 実験経路と調査用ログを削除する。

### Phase 4: レビュー方針

- コード上に `masked-buffer` / `__HEADLESS_PAINT_*` / profiling `console.table` が残っていないことを検索で確認する。
- API ドキュメントと `BrushMixing` 型・デフォルト値が一致していることを確認する。
- brush-render / incremental-render / persistence のテストを実行する。
- lint / typecheck / build を実行する。

## 概要

Safari（macOS / iOS）で混色有効なスタンプブラシが極端に遅くなる問題を調査した。

初期の観測では `pickup` が `0` か非 `0` かで性能が大きく変わるため、描画先から色を拾う `drawImage(sourceLayer.canvas, sx, sy, sw, sh, ...)` が主因に見えた。しかし段階的な計測と機能分解の結果、主因は pickup 単体ではなく、混色 dab ごとに発行される Canvas2D / OffscreenCanvas の多段合成処理が Safari の描画キューを飽和させることだと判断した。

特に、高速ストローク時は最初だけ処理できるが、一定量の Canvas コマンドが蓄積すると途中から極端な引っ掛かりが発生する。これは CPU 同期処理の単純な遅さではなく、Safari/WebKit の Canvas/GPU バックエンドで非同期処理キューが詰まり、後続の Canvas API 呼び出しで同期フラッシュが起きている挙動と整合する。

## 調査対象の実装

混色有効時の dab は、概ね次の追加処理を実行していた。

```typescript
// 1. 背景 footprint をブラシ色バッファへ拾う
bufferCtx.drawImage(sourceLayer.canvas, sx, sy, sw, sh, 0, 0, bw, bh);

// 2. 元色へ戻す
bufferCtx.globalAlpha = restore;
bufferCtx.fillRect(0, 0, bw, bh);

// 3. mixed dab 用 work canvas を作る
workCtx.clearRect(...); // 後に copy 合成へ変更
workCtx.drawImage(colorBuffer, 0, 0);

// 4. tip mask を適用する
workCtx.globalCompositeOperation = "destination-in";
workCtx.drawImage(tipCanvas, 0, 0);

// 5. mixed dab を描画先へ配置する
ctx.drawImage(workCanvas, x, y, size, size);
```

混色なしスタンプブラシでは、基本的に次の最終描画だけであり、`colorBuffer -> workCanvas` の中間コピーや `destination-in` mask は存在しない。

```typescript
ctx.drawImage(tipCanvas, x, y, size, size);
```

## 追加した計測

調査のため、以下のグローバルフラグを追加した。

```javascript
globalThis.__HEADLESS_PAINT_PROFILE_MIXING = true;
globalThis.__HEADLESS_PAINT_PROFILE_STROKE = true;
globalThis.__HEADLESS_PAINT_PROFILE_CANVAS = true;
```

主な計測対象:

- `mixed brush`
  - dab 数
  - pickup / restore / context取得 / mask / final draw の累積時間
  - `mask copy ms`, `mask composite ms` などの内訳
- `stroke move`
  - pointer move 処理全体
  - `appendToCommittedLayer`
  - `renderPendingLayer`
  - React再描画トリガー
- `paint canvas`
  - 表示 canvas の再描画
  - `renderLayers`
  - canvas resize / background / overlay の内訳

また、混色処理を段階的に戻すため、以下の調査用モードを追加した。

```javascript
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "none";
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "pickup";
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "restore";
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "buffer-direct";
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "work-copy-static";
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "work-copy-only";
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "work-copy";
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "full";
```

各モードの意味:

| モード | 内容 | 描画結果 |
|---|---|---|
| `none` | 混色追加操作なし。通常 tip を描く | 混色なし |
| `pickup` | pickup のみ実行し、描画は通常 tip | 壊れる |
| `restore` | pickup + restore のみ実行し、描画は通常 tip | 壊れる |
| `buffer-direct` | colorBuffer を直接描画する。workCanvas copy / mask なし | 矩形寄りに壊れる |
| `work-copy-static` | pickup / restore なしで `colorBuffer -> workCanvas` copy のみ実行。描画は通常 tip | 壊れる |
| `work-copy-only` | pickup / restore / `colorBuffer -> workCanvas` copy を実行。描画は通常 tip | 壊れる |
| `work-copy` | workCanvas copy まで実行し、その workCanvas を描画する。mask なし | 壊れる |
| `full` | 現行の完全な混色処理 | 正常 |

## 主な観測結果

### 1. 低速ストロークでは安定する

低速に動かし続けた場合、1秒あたり約1000 stamps程度で、`mixed brush` / `stroke move` は低い値で安定した。

例:

```text
mixed brush:
stamps: 998 - 1262
total ms: 0 - 4
ms / stamp: 0.000 - 0.004

stroke move:
moves: 187 - 205
total ms: 9 - 31
ms / move: 0.044 - 0.166
```

### 2. 高速ストロークでは途中から急激に詰まる

高速に動かすと、最初は3500-5000 stamps/sec程度でも短時間は処理できる。しかし継続すると急激に `mask copy ms` / `mask ms` / `append ms` / `pending ms` が跳ね、`stroke move` の処理件数が10前後まで落ちる。

例:

```text
mixed brush:
stamps: 2321
total ms: 864
ms / stamp: 0.372
mask ms: 428
mask copy ms: 381

stroke move:
moves: 9
total ms: 999
ms / move: 111
append ms: 312
pending ms: 686
```

これは「1操作が常に遅い」のではなく、一定量の Canvas 処理を発行した後でキュー詰まりが顕在化する挙動。

### 3. `pickup` 単体は主因ではない

`pickup` モードでは高速に動かしても安定した。

```text
mode: pickup
stamps: 4375 - 5295
mixed total ms: 4 - 6
stroke total ms: 13 - 16
```

したがって、描画先レイヤーから footprint を拾う `drawImage(sourceLayer.canvas, ...)` 単体は主因ではない。

### 4. `restore` 単体も主因ではない

`restore` モードでも安定した。

```text
mode: restore
stamps: 3825 - 7035
mixed total ms: 4 - 9
stroke total ms: 11 - 34
```

`fillRect` による restore 単体も主因ではない。

### 5. `work-copy-static` で詰まる

`work-copy-static` は pickup / restore を実行せず、実質的に `colorBuffer -> workCanvas` の小 OffscreenCanvas 間コピーだけを追加するモード。

この状態でも高速継続時に詰まった。

```text
mode: work-copy-static
stamps: 2683
mixed total ms: 410
mask ms: 174
mask copy ms: 174

stroke move:
moves: 99
total ms: 649
append ms: 187
pending ms: 458
```

さらに次のログでも同じ傾向が出た。

```text
mode: work-copy-static
stamps: 2485
mixed total ms: 780
mask ms: 171
mask copy ms: 171
```

このため、最も強い原因候補は **小さい OffscreenCanvas から小さい OffscreenCanvas への copy を大量に継続発行すること**。

### 6. `buffer-direct` でも画面上の詰まりは残った

`buffer-direct` は `colorBuffer -> workCanvas` copy と mask を消し、`colorBuffer` を直接描くモード。

JS計測上は軽く見えた。

```text
paint canvas:
frames: 227 - 240
total ms: 1 - 9
layers ms: 0 - 5

stroke move:
moves: 237 - 241
total ms: 21 - 38
```

しかし実際の画面上では大きな詰まりが残った。その後のログでは `buffer-direct` でも `append` / `pending` が大きく跳ねた。

```text
mode: buffer-direct
stroke move:
moves: 41
total ms: 909
append ms: 252
pending ms: 655
```

この結果から、`workCanvas` を介さなくても、**mutable な `colorBuffer` を dab ごとの描画ソースとして使うこと自体**が Safari の Canvas/GPU キュー詰まりを引き起こす可能性が高い。

### 7. `none` は速い

混色追加操作を全スキップする `none` は安定して速かった。

```text
mode: none
stroke move:
moves: 226 - 240
total ms: 15 - 20
ms / move: 0.062 - 0.088
```

ただし、これは混色機能を丸ごと無効化しているだけであり、製品向けfallbackではない。

## 実装上試した対策

### OffscreenCanvas context のキャッシュ

dab ごとの `getContext("2d")` が Safari で大きな同期点になることがあったため、`WeakMap<OffscreenCanvas, OffscreenCanvasRenderingContext2D>` で context をキャッシュした。

効果:

- 初期の `getContext ms = 1000ms+` 級のスパイクは解消。
- しかし高速継続時の詰まりは残った。

### mixed work canvas の再利用

`renderStampBrushStroke` 呼び出しごとに `new OffscreenCanvas` していた `mixedWorkCanvas` を、tipサイズ単位の scratch canvas として再利用するよう変更した。

効果:

- 新規 OffscreenCanvas 初期化由来の詰まりは減った。
- しかし `colorBuffer -> workCanvas` copy 由来の詰まりは残った。

### pending preview のフルレイヤーコピー廃止

React統合では、混色preview時に `previewBaseLayer` を pending layer へ丸ごとコピーし、`copy` 合成する経路があった。

Safari で2048x2048のフルレイヤーコピーが極端に遅くなるため、React統合では `previewBaseLayer` を渡さず、pending差分だけを通常 `source-over` で重ねる形に変更した。

効果:

- `renderPendingLayer` 内のフルレイヤーコピー由来のスパイクを除外できた。
- しかし混色dab自体の詰まりは残った。

### pending colorBuffer clone の再利用

pending再描画時に `colorBuffer` を毎回 `new OffscreenCanvas` + `drawImage` でcloneしていたため、`WeakMap` で scratch buffer を再利用するよう変更した。

効果:

- 新規 Canvas 作成由来の問題を減らした。
- しかし高速継続時の Canvas copy キュー飽和は残った。

### `clearRect` の削除

`workCanvas` は `colorBuffer` と同サイズの全体コピーで上書きされるため、`clearRect` をやめ、`globalCompositeOperation = "copy"` で置換する形に変更した。

効果:

- `mask clear ms` は消えた。
- その代わり `mask copy ms` が支配的になった。
- 根本原因がclearではなくCanvas間copy/キュー飽和であることが明確になった。

## 現時点の結論

Safari で遅い原因は、特定の1つのCanvas API呼び出しではなく、**混色dabごとのCanvas2D多段合成パイプラインが発行するコマンド量**と考えるべき。

特に次のパターンが危険:

- 新規 OffscreenCanvas を描画中に作る
- 新規 Canvas の `getContext("2d")`
- 小さい OffscreenCanvas 間の `drawImage` copy を大量に継続発行する
- mutable な OffscreenCanvas を、更新直後に別の Canvas 描画の source として使い続ける
- `destination-in` mask をdabごとに実行する

`performance.now()` で囲ったop単位の計測は、Safariでは実際のGPU/Canvas負荷位置を正確に示さない。ログ上 `mask copy ms` や `pickup ms` に時間が出る場合でも、それはそのAPI自体の純粋な処理時間ではなく、蓄積したCanvas/GPUキューの同期フラッシュ地点を見ている可能性が高い。

## 重要な判断

`none` モードは高速だが、混色機能を無効化しているだけであり、fallbackとは呼べない。恒久対応としては不適切。

`buffer-direct` も描画結果を壊す上に、画面上の詰まりを完全には解消できなかった。製品向けの妥当なfallbackではない。

現行のCanvas2D/OffscreenCanvas多段合成方式をSafariで維持するのは難しい。

## 推奨される次の方針

### 第一候補: Safari向けCPU混色パス

Safariでは Canvas2D の中間合成を使わず、36x36程度の小バッファをCPU側で生成する。

方針:

1. ストローク開始時にtip alpha maskを `Uint8ClampedArray` として持つ。
2. `colorBuffer` もCanvasではなくCPU側RGBA配列として持つ。
3. pickupは必要最小限のsource pixelsを取得する。
   - ただし `getImageData` をdabごとに呼ぶと別のreadback問題になるため、stroke開始時のsource snapshotをどう取るか設計が必要。
4. restoreはRGBA配列上でブレンドする。
5. tip alphaを掛けてdab ImageDataを生成する。
6. 最終描画は可能なら `putImageData` ではなく、一定単位でまとめるか、ImageBitmap化を検討する。

懸念:

- `getImageData` / `putImageData` もSafariで重い可能性がある。
- ただし、現行のCanvas間copy/composite大量発行よりは制御しやすい。
- CPUパスはブラシサイズが大きい場合に重くなるため、サイズ上限またはSafari専用の品質設定が必要。

### 第二候補: フレーム/スタンプ予算制御

Safariでは高速入力時にdab数が増えすぎるとCanvasキューが飽和するため、描画密度を制御する。

方針:

- `requestAnimationFrame` 単位でpending描画を1回にまとめる。
- 1フレームあたりの最大stamp数を設ける。
- 高速移動中はspacingを動的に広げる。
- pendingは軽量preview、stroke endで高品質確定描画にする。

これはCPU混色パスと組み合わせるべき補助策。

### 第三候補: WebGL/WebGPU

混色dab合成をGPU向けに明示的に実装する。

現時点ではプロジェクトのCanvas2Dベース方針から外れるため、短期対応としては重い。

## 調査時点の暫定コード状態

調査中は、原因分離のために以下の暫定コードを入れていた。最終実装では、このうち調査用 profile / ops mode / Safari 判定 fallback は削除する。

- `packages/engine/src/brush-render.ts`
  - mixing profile
  - mixing ops mode
  - context cache
  - mixed work canvas cache
- `packages/react/src/useStrokeSession.ts`
  - stroke move profile
  - mixed preview の `previewBaseLayer` 非使用化
- `apps/web/src/components/PaintCanvas.tsx`
  - paint canvas profile
- `apps/web/vite.config.ts`
  - `@headless-paint/core` / `@headless-paint/react` のsource alias追加
- `packages/engine/src/incremental-render.ts`
  - pending colorBuffer scratch再利用
- `packages/engine/docs/incremental-render-api.md`
  - mixed preview方針の記述更新

注意:

- Safari判定で `none` をデフォルトにする変更は、混色機能を事実上無効化するため、最終仕様としては採用しない方がよい。
- profile / ops mode は調査用コードであり、プロダクション前に整理する必要がある。

## 検証済みコマンド

調査中、以下は通過済み。

```bash
pnpm run typecheck
pnpm lint
pnpm vitest packages/engine/src/brush-render.test.ts
pnpm vitest packages/engine/src/incremental-render.test.ts packages/engine/src/brush-render.test.ts
```

## まとめ

今回の調査で、Safariで混色ブラシが遅い主因は pickup 値そのものではなく、混色を実現するための Canvas2D / OffscreenCanvas 多段合成パイプラインだと分かった。

特に高速ストローク時、dab数が増えると小Canvas間copyやmutable canvas sourceの連続利用によりSafariの描画キューが飽和し、CPU側にも同期停止として現れる。

したがって、今後の本対応は「現行Canvas2D合成を少しずつ最適化する」より、Safari向けにCanvas間copy/compositeを避ける別レンダリング経路を設計するべきである。

## Plan A 最小実験実装

Plan A の改善可否を確認するため、調査用の `__HEADLESS_PAINT_MIXING_OPS_MODE` に `masked-buffer` を追加した。

狙い:

- 従来の `colorBuffer -> workCanvas` コピーを dab ごとに実行しない
- 従来の `workCanvas.globalCompositeOperation = "destination-in"` による dab ごとの mask 合成を実行しない
- `colorBuffer` 自体を作成時に `tipCanvas` の alpha で mask しておき、pickup / restore は `source-atop` で色だけを更新する
- 最終描画では `colorBuffer` をそのまま描画先へ `drawImage` する

実装上の変更:

- `packages/engine/src/brush-render.ts`
  - `MixingOpsMode` に `masked-buffer` を追加
  - Safari / iOS WebKit の暫定 fallback は解除し、デフォルトは従来 `full` に戻した
  - `createMaskedColorBuffer(tipCanvas, color)` を追加
  - `masked-buffer` 時は work canvas を作成せず、mask copy / mask composite をスキップ
  - 初回 colorBuffer は `renderMixedTip` 側で mode に応じて作成するようにし、Plan A と従来 full の初期化を分岐
- `packages/engine/src/brush-render.test.ts`
  - `full` と `masked-buffer` の描画結果を比較するテストを追加
  - 半透明エッジでは Canvas の非 premultiplied RGB に差が出るため、見た目に効く premultiplied RGB と alpha の差を検証

確認済み:

```bash
pnpm vitest packages/engine/src/brush-render.test.ts
pnpm vitest packages/engine/src/incremental-render.test.ts packages/engine/src/brush-render.test.ts
pnpm run typecheck
pnpm lint
```

Safari 実機確認手順:

```javascript
globalThis.__HEADLESS_PAINT_PROFILE_MIXING = true;
globalThis.__HEADLESS_PAINT_PROFILE_STROKE = true;
globalThis.__HEADLESS_PAINT_PROFILE_CANVAS = true;

// Plan A
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "masked-buffer";

// 従来フル合成（現在のデフォルト。明示指定する場合）
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "full";

// 比較用: 混色無効相当
globalThis.__HEADLESS_PAINT_MIXING_OPS_MODE = "none";
```

評価観点:

- `masked-buffer` で高速ストロークを継続したとき、`mask copy ms` / `mask composite ms` が 0 付近に落ちること
- `stroke move` の `append ms` / `pending ms` の急激な跳ねが `full` より明確に減ること
- 画面上の引っ掛かりが `buffer-direct` より改善すること
- 半透明エッジや pickup / restore の見た目が製品上許容できること

注意:

- `masked-buffer` は小Canvas間copyを消すが、mutable な `colorBuffer` を最終描画ソースとして使う点は残る。そのため、`buffer-direct` で観測された詰まりが同じ原因なら改善は限定的になる可能性がある。
- 改善が限定的な場合は、Plan A の Canvas2D 内改善だけでは不足と判断し、CPU混色パスまたは WebGL パスへ進む。

### 体感遅延を捕捉する追加計測

Safari 実機の `masked-buffer` ログでは、`mask copy ms` / `mask composite ms` は 0 になり、`mixed brush` / `stroke move` / `paint canvas` の同期計測値も低いままだった。一方で体感はかなり悪いとの報告があった。

この差は、既存計測が Canvas API 呼び出しを発行する JS 関数内の時間だけを見ており、Safari の Canvas/GPU キュー消化、compositor、入力イベント配送、次フレーム提示までの wall-clock 停止を捕捉できないためと考えられる。

追加した計測:

- `mixed brush`
  - `elapsed ms`
  - `stamps / sec`
- `stroke move`
  - `elapsed ms`
  - `moves / sec`
  - `max move ms`
  - `max gap ms`
- `paint canvas`
  - `elapsed ms`
  - `paints / sec`
  - `max paint ms`
  - `max gap ms`
- `browser raf`
  - `frames / sec`
  - `max gap ms`

次の確認では、同期処理時間ではなく `browser raf.max gap ms` と `stroke move.max gap ms` を重視する。ここが大きい場合、ボトルネックは Plan A が消した dab 内 mask copy ではなく、Safari が mutable canvas source の描画結果を画面へ反映する後段、または入力イベント配送そのものに移っていると判断する。

### requestAnimationFrame 再描画合流

Safari 実機ログでは、`paint canvas` が 200 回/sec 超で走っている一方、`browser raf` は 2fps 未満まで落ちる区間があった。実表示が詰まっている状態で表示 canvas への再描画要求だけを過剰に発行しているため、混色の根本問題とは独立に `renderVersion` 更新を `requestAnimationFrame` 単位へ合流する。

実装:

- `packages/react/src/useRafRenderVersion.ts` を追加
  - 複数回 `bumpRenderVersion()` されても、同一 animation frame では1回だけ `renderVersion` を進める
  - unmount 時に未実行の RAF をキャンセルする
  - `requestAnimationFrame` がない環境では従来通り即時更新する
- `useStrokeSession` の `renderVersion` を RAF 合流へ変更
- `useLayers` の `bumpRenderVersion` も同じ RAF 合流へ変更

期待するログ変化:

- `paint canvas.paints / sec` が入力イベント数ではなく実フレーム数に近づく
- `browser raf.max gap ms` が縮むかを確認する
- `mixed brush` の値は大きく変わらない想定

### 距離ベースの混色更新間引き

`full` 経路をデフォルトに戻して RAF 合流のみで再測定したところ、`paint canvas` は 60 回/sec 以下に抑えられたが、`browser raf` は高速ストローク中に 14-20fps まで落ちる区間が残った。`stroke move` と `mixed brush` の JS 同期時間は低いままであり、`full` の dab ごとの `colorBuffer -> workCanvas` / mask 更新頻度が Safari の後段キューを詰まらせている可能性が残る。

そこで、stamp は従来通り spacing ごとに描画しつつ、混色状態（pickup / restore / mixed dab 生成）の更新だけを距離ベースで間引く実験を追加した。

方針:

- デフォルトの混色更新距離は `max(stampSpacing, lineWidth * 0.5)`
- 係数補正は入れない
- 更新しない stamp では直近の mixed dab を再利用して描画する
- `full` 経路では分岐ごとに `mixedCanvas` と `lastMixingUpdateDistance` を `BrushBranchRenderState` に保持する
- pending 描画では `colorBuffer` と `mixedCanvas` を複製し、committed 側の混色状態を汚さない

実験時は調査用フラグで比率を切り替えたが、最終実装では `BrushMixing.updateDistanceRatio` を正式なブラシパラメータにする。デフォルトは `0.5`。`0` を指定すると混色更新は stamp ごとになり、従来挙動に近づく。

ログには実験中のみ `mix updates` と `updates / sec` を追加し、`stamps / sec` に対して `updates / sec` が下がるかを確認した。

Safari 実機の測定では、`updateDistanceRatio = 0.5` で高速ストローク時も `browser raf` が 60fps 前後に安定し、`paint canvas` も 60回/sec 前後に抑えられた。`mix updates` は stamp 数の約1/3程度まで下がり、体感上の引っ掛かりも解消したため、この方針を採用する。

## 最終実装結果

採用した変更:

- `packages/react/src/useRafRenderVersion.ts`
  - RAF 単位で `renderVersion` 更新を合流する hook を追加。
  - `useStrokeSession` と `useLayers` で使用する。
- `packages/engine/src/types.ts`
  - `BrushMixing.updateDistanceRatio` を追加。
  - `DEFAULT_BRUSH_MIXING.updateDistanceRatio = 0.5`。
- `packages/engine/src/brush-render.ts`
  - 混色更新距離を `max(stampSpacing, lineWidth * updateDistanceRatio)` で計算。
  - 更新しない stamp は直近の `mixedCanvas` を再利用。
  - Plan A の `masked-buffer` や調査用 ops mode は残さない。
- `packages/engine/src/incremental-render.ts`
  - pending 再描画で `colorBuffer` と `mixedCanvas` を複製し、committed 側の混色状態を汚さない。
- `apps/web/src/components/BrushPanel.tsx`
  - `Pickup` / `Restore` に加えて `Mix Distance` スライダーを表示。
- `packages/react/src/persistence.ts`
  - 保存された `BrushConfig` の `mixing.updateDistanceRatio` を検証対象に追加。
- `packages/*/docs`
  - BrushMixing API、RAF 合流、距離ベース混色更新を記載。

採用しない変更:

- Plan A `masked-buffer`
  - 小Canvas間 copy / mask 合成の削減には効果があった。
  - ただし `full` と品質が完全等価ではなく、dab 内の一部だけ混色する表現が弱くなる。
  - mutable `colorBuffer` を描画ソースとして使い続ける点も残るため、今回は実装から削除し、本記録に fallback 候補として残す。
- 調査用 debug / profile / global flag
  - 本対応後は削除し、製品コードには残さない。

最終確認では、コード上に `__HEADLESS_PAINT_*` / `masked-buffer` / profile `console.table` が残っていないことを確認する。
