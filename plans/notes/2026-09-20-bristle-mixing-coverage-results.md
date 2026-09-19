# Bristle混色カーブ修正・検証結果

## 結論

混色ONでだけ発生する欠けをCPU/GPUとも解消。maskと別形状のinkの積をやめ、maskを唯一の被覆とした。API・設定値・pickup/restore/diffusion式・flush境界は変更していない。CPUはmask走査内でRGBを補間し、色場の長手座標をrun終点基準の連続距離で求める。GPUは不要なink pass、断面upload、shader、atlasのink領域を除去した。

## 測定条件

- macOS / Playwright HeadlessChrome 145.0.7632.6。Chromeのautoと同じCPU経路、および強制webgl2。WebGL rendererはANGLE / SwiftShader（ソフトウェアGPU）。実Chromeの対話操作やSafari/iPad実機の速度は未測定。
- 10形状条件 × CPU/GPU × 空下地/赤い帯 × 混色OFF/ON = 80条件。361点、8点ずつfeedMany、seed=2、40px（wideのみ120px）、320²（wideのみ640²）。arc/spiral/pressure/wide/reverse/cross/straight/slow/texture/radial4。
- slowはtimestamp間隔8ms、通常2ms。pressureは0.2〜1、textureは0.55で既定紙目・dropout、radial4は4方向展開。それ以外は形状欠損を分離するため紙目・dropoutを無効化。
- mixing: pickup=.007/px、restore=.004/px、diffusion=.05pass/px、updateDistance=15px。他は既定値。
- 各条件2回warmup＋5回測定の中央値。renderer生成〜feedMany〜finalizeを同期計測。入力待ち、確認用getImageData/PNG化は除外。GPU完了を独立計測していないためGPU実機のフレーム時間とは区別する。
- 元コードはHEADの4描画ファイルを一時復元し、同じbenchmarkで計測してから修正内容へ戻した。修正前/後とも再測定。最終比較データは `work.local/bristle-coverage/{before-complete,after-complete}/results.json` と `after-complete/comparison.json`。実行環境は各 `environment.json`。

## 割れと表現

- 欠けの定義: 同じbackend/設定の混色OFFでalpha>250、混色ONでalpha<128となる画素。全40混色ON条件で修正後0。全alpha値の完全一致を意味する指標ではない。
- 空下地のCPU円弧744→0、螺旋707→0、筆圧変化4160→0、紙目あり459→0。GPUはそれぞれ1035→0、1032→0、6173→0、642→0。
- 色差は「空下地OFFの描画領域内、かつ修正前後ともalpha>250」の画素だけでRGB差を集計。欠けが埋まった画素と背景は除外。赤い帯のCPU平均絶対誤差は0.45〜2.22/255、いずれかのRGB差が20を超える割合は最大4.25%。GPUは平均0〜2.23/255、最大5.23%。pickup式は同じでも、被覆と色座標・その後の採色が変わるため画像は互換ではない。旧履歴の再描画も変わる。
- CPUの直線は色差平均0.50/255、20超の画素0%。紙目ありは平均1.40/255、20超2.06%。紙目の細かな欠けは比較画像で残っており、全面を滑らかに塗り潰す修正ではない。
- 混色OFFはCPU全20条件でRGBA byte一致。GPU19/20条件で一致し、wide・赤い帯のみ640²中1画素の被覆差（382,427、透明→不透明）がある。GPU atlas寸法変更に伴う境界差と考えられるが、原因を独立に確定したものではない。
- [CPU比較画像](../../work.local/bristle-coverage/comparison.png): 列は空下地Before/After、赤い帯Before/After。行は螺旋、筆圧変化、紙目あり。

## パフォーマンス

混色ONの20条件でCPU変化率の中央値は−27.9%、範囲−48.4〜0%。直線は同等、他は短縮。GPUは中央値−8.7%、範囲−20.3〜−2.4%。小さな差は測定揺れを含む。対照の混色OFFではCPU中央値−1.5%（範囲−15.6〜+9.6%）、GPU中央値−0.7%（−7.2〜+3.3%）であり、百分率だけで小差を断定しない。確認した範囲で性能劣化は見られない。CPUでは中間canvasと合成処理の削減が、追加RGB計算の費用を上回った。

以下は赤い帯・混色ON、1ストロークの中央値。p95は8点feedMany呼び出しの同期所要時間。

| backend | 条件 | 修正前ms | 修正後ms | 増減 | call p95 前→後ms |
|---|---|---:|---:|---:|---:|
| cpu | arc | 20.1 | 13.7 | -31.8% | 1.2 → 0.8 |
| cpu | spiral | 16.4 | 9.4 | -42.7% | 1.1 → 0.7 |
| cpu | pressure | 25.4 | 13.1 | -48.4% | 1.6 → 0.9 |
| cpu | wide | 107.6 | 58.2 | -45.9% | 5.4 → 2.8 |
| cpu | reverse | 19.6 | 12.1 | -38.3% | 1.1 → 0.7 |
| cpu | cross | 28.1 | 16.5 | -41.3% | 1.7 → 1.0 |
| cpu | straight | 4.8 | 4.8 | +0.0% | 0.3 → 0.4 |
| cpu | slow | 18.0 | 12.6 | -30.0% | 0.6 → 0.5 |
| cpu | texture | 19.6 | 11.3 | -42.3% | 1.1 → 0.7 |
| cpu | radial4 | 69.4 | 46.1 | -33.6% | 4.0 → 2.6 |
| webgl2 | arc | 49.0 | 43.8 | -10.6% | 2.7 → 2.2 |
| webgl2 | spiral | 48.4 | 44.3 | -8.5% | 3.1 → 2.1 |
| webgl2 | pressure | 51.3 | 45.2 | -11.9% | 3.0 → 2.3 |
| webgl2 | wide | 84.2 | 69.6 | -17.3% | 4.7 → 4.0 |
| webgl2 | reverse | 47.7 | 44.6 | -6.5% | 2.3 → 2.4 |
| webgl2 | cross | 55.2 | 49.5 | -10.3% | 2.8 → 2.5 |
| webgl2 | straight | 41.1 | 38.6 | -6.1% | 2.0 → 1.9 |
| webgl2 | slow | 131.6 | 128.5 | -2.4% | 4.2 → 4.1 |
| webgl2 | texture | 47.6 | 44.4 | -6.7% | 2.4 → 2.2 |
| webgl2 | radial4 | 89.6 | 71.4 | -20.3% | 4.6 → 3.6 |

## 検証・レビュー

- 追加coverage回帰テストは元コードでCPU64/GPU71画素の欠損により失敗、修正後は0で成功。handle比0.5/1、mix距離5/15を含む。
- 全64ファイル784テスト成功（混色勾配、pressure、紙目、CPU/GPU Tier B、live/replay等を含む）。GPU pass構造を検証する既存テストは、削除したink pass/uploadが発生しない期待値へ更新。GPU readMaskテスト用寸法の不足は本体を修正し、coverageやparityの閾値は緩めていない。
- `pnpm run build`（typecheck、全package、公開artifact検査）、`pnpm run lint`、`git diff --check` 成功。
- review-library-usageに沿ってengine/input/stroke概要とbrush/GPU詳細を照合。色の補間はengine内の既存mask rasterを使用。追加APIは内部モジュールのみで公開エントリ変更なし。brush-api、gpu-acceleration、Changelogを更新。
- 未計測: Safari/iPad実機、長時間のメモリ推移、他canvasサイズ・極端な設定・半透明色。CPU色場canvasの小さなreadbackは実機によって費用が異なる。全デバイスで性能改善するとの結論にはしない。

再現コマンド: `node tools/bench/benchmark-bristle-coverage.mjs work.local/bristle-coverage/after-complete`、`node tools/bench/compare-bristle-coverage.mjs after-complete before-complete`。修正前計測には元の描画実装を使用する。元の結果を上書きしないこと。
