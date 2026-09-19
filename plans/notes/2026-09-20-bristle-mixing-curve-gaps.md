# Bristle 混色ON時のカーブの割れ調査

ユーザー画像: 急カーブの輪郭に規則的な割れ。速度に依存せず混色ON時に発生するとの報告。

## 確認した原因

- mask は各端点の位置・筆幅・frameから連続したquadを作る。
- 混色のinkは別形状: `bristle.ts:drawSweep` と GPU `bristle-pass.ts:inkQuad` が区間中央・平均frameを使って矩形/台形を配置する。端点frameを結んだmaskの形状とは一致しない。
- GPU混色OFFは mask alpha のみ、ONは `material.a * mask * ink`（shader-sources.ts）。inkが覆っていない画素はmaskがあっても消える。
- 混色は `updateDistancePx` ごとにrunを区切る。隣接runのinkはそれぞれのmaskに掛けるため、他runのinkで穴を補えない。CPUも同じ矩形掃引とrun分割を持つ。
- 色や混色量の問題ではなく、色を載せる形状が最終coverageに干渉している。空の下地・固定筆圧・紙目とdropoutなしで再現した。

## Chromiumでの切り分け実験

256²、半径60pxの1.8π円弧、筆幅40px、361入力点、固定筆圧1、1 engine呼出し。混色はpickup .007 / restore .004 / diffusion .05、既定handle .5・geometryStep 1。各条件でOFF時alpha>250かつON時alpha<128となる画素を数えた。ユーザーの実ストロークやlive flushを完全再現した値ではない。

| 条件 | CPU欠け画素 | GPU欠け画素 |
|---|---:|---:|
| Mix Distance 15、handle .5 | 64 | 71 |
| handle 0 | 0 | 1 |
| geometryStep .5 | 66 | 75 |
| geometryStep 2 | 40 | 52 |
| Mix Distance 5 | 145 | 161 |
| Mix Distance 36 | 17 | 24 |
| handle 1 | 29 | 37 |

GPU compositeでink alphaを掛ける処理だけを一時的に迂回すると、すべての比較条件で欠け画素・alpha損失とも0になった。診断変更は復元済み。CPUは非介入対照として元の数値のまま。診断fixtureは/tmpへ退避しテスト対象から削除、失敗表示による測定値回収で生成したスクリーンショットも削除済み。

## 対処の判断

- 設定による緩和: `handleLengthRatio=0`（現行debug UIは Turn Lag）またはMix Distanceを大きくする。ただし前者は柄による向きの追従特性、後者は混色更新の見え方を変える。全曲線での解消保証はない。単にgeometryStepを細かくする対処は今回改善しなかった。
- 根本修正: 形状/coverageはmaskに一本化し、混色ルートは同じ被覆上のRGBを計算する。GPUでは断面が一様alphaの現状でink alphaの必要性を再評価。CPUでは色場の写像をmaskと同じquad座標へ合わせる必要があり、色付き矩形を広げるだけの対応は不十分。
- 不透明・空下地の同一入力で混色ON/OFFのalpha一致を検証し、別に色付き下地のpickup、逆向き、筆圧変化、急旋回、CPU/GPU、live/replayを確認する。速度差によりflush条件は変わるため、同じ形状の複数timestamp間隔も試す。

恒久修正・計測を実施済み。結果は [修正検証レポート](2026-09-20-bristle-mixing-coverage-results.md) を参照。既存のリリース前修正作業ツリーは維持。
