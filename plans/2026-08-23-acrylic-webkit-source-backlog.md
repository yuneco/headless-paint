# Acrylic WebKit mutable-source backlog

## 目的

Production Web demo の Acrylic で、長い連続strokeの途中から描画FPSと入力受付が同時に落ちる問題を、Rough bristleの合格状態を変えずに解消する。

## 再現と判定

- 従来fixtureは `page.mouse.move()` を1点ずつ待っていたため、WebKitの非同期描画queueへ十分な負荷を与えていなかった。
- coalesced入力相当を1 frameへまとめるfixtureでは、同じStamp Acrylicでも混色OFFが同期処理p95約1ms、混色ONが約24msだった。
- したがって今回のBristle変更ではなく、Acrylicのmutableな混色dab sourceを短い間隔で更新・再利用するProduction既存経路を主対象とする。

## 設計

公開 `BrushMixing` 設定と描画結果の因果順序は変えない。branch-localな低解像度RGBA色場、checkpoint sampling、deposit後pickupは維持する。

第一候補として、WebKitがまだ描画中かもしれない単一の `renderCanvas` を即座に上書きしないCanvas ringを比較する。改善しなければ採用せず、sampling readback、CPU field更新、field upload、tip転写を個別計測する。

### 棄却した候補

- 8枚のdab source ring: 1920 sample / 240 batchのWebKit測定で同期処理p95が`24ms → 24ms`と変化しなかった。単一mutable sourceの即時再利用は今回の主要因ではない。
- checkpoint Canvasの`willReadFrequently`: 同条件でp95が`11ms → 30ms`へ悪化した。GPU layerからCPU-backed scratchへの転写を強制するため採用しない。

### 実測した主因

- 同fixtureでは18×8 samplingの`getImageData`が2347回、合計約3.7秒を占めた。CPU色場、`putImageData`、dab `drawImage`は支配的ではない。
- checkpoint更新時だけ有限tileをreadbackし、その間の回転・縮小samplingはcached pixelsからCPUで行う。

## 完了条件

1. Acrylic混色ONの高密度・長時間fixtureで同期batch処理とframe待ちが改善し、後半だけ悪化しない。
2. 混色OFFとRough bristleの描画経路・既定値を変更しない。
3. deposit→sample→次dabの順序、incremental/replay、state cloneの所有権を維持する。
4. engine test/build/lintを通し、混色stateのCanvas所有権テストをringへ拡張する。
5. 修正後も改善しない場合は、field upload / checkpoint readbackを次の切り分け対象として記録し、推測で追加変更しない。

## 結果

- 1920 samples / 240 coalesced batches（8 samples/frame相当）では、混色ONの同期dispatch p95を`24ms → 11ms`、maxを`27ms → 12–14ms`へ短縮した。前半/後半p50はともに`8ms`で、累積悪化はない。
- 3600 samples / 900 batches（4 samples/frame相当）の長時間gateはdispatch p50 / p95 `6 / 9ms`、前半/後半p50 `5 / 6ms`。承認待ち時間を実走時間へ混ぜず、ページ内`performance.now()`だけで判定した。
- 修正後も最大コストはcheckpoint更新時の有限tile readback。既定36pxごとのため1 frameへ極端な移動距離を詰めると複数回発生するが、material更新ごとの同期は除去した。
- 見た目の既存test（色境界、進行方向後方への色引き、checkpoint、incremental state）を維持した。最終的なApple Pencil官能評価はWeb demoで行う。

## API利用イメージ

利用側は従来どおり `BrushMixing` を指定する。ring数やCanvas選択はWebKit対策の内部詳細で、調整用APIには露出しない。
