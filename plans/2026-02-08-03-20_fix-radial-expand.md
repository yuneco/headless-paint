# Radial Expand バグ修正

## Context

radialモードの対称ペイントに2つのバグがある:
1. ガイド線が全線(両方向)で描画され、div=3で6分割に見える
2. angle≠0のとき入力位置と描画位置がずれる

## 完了した修正

### バグ1: ガイド線が2倍に見える — 完了

`SymmetryOverlay.tsx` の `drawAxisLine`（中心を貫通する全線）→ `drawRayLine`（中心から片方向の半直線）に変更。radialモードのみ。

- 変更: `apps/web/src/components/SymmetryOverlay.tsx`
- `drawRayLine` 関数を追加（L107-123）
- radialモードのガイド描画で `drawRayLine` を使用（L56）

### バグ2: expand.ts の行列生成 — 完了

radialケースで `config.angle` を全行列に加算していたため、i=0（入力ストローク自身）も回転してしまっていた。`config.angle` を除去。

- 変更: `packages/engine/src/expand.ts` L38
- テスト追加: `packages/engine/src/expand.test.ts` L165-181（Red-Greenで確認済み）

### ドキュメント更新 — 完了

- `packages/engine/docs/types.md` L137: angleフィールドの説明を更新

## ペンディング: UI上の入力位置ズレ

### 症状

radial div=3, angle=30で12時方向に点を打つと、画面上では**1時の位置**に描画される。angle=60なら2時。expand.ts自体は正しく修正されており（angleを無視して0°/120°/240°の回転行列を出力）、問題はUI層にある。

### ユーザーの分析

> radialではangleは実際には意味を持たない。angleの値に関わらず3分割なら入力座標, +120度, +240度の3ストロークが出力されるべき。計算上正しく処理するとangleの影響は入力と出力で打ち消されて0になる。

つまり、**入力座標変換（screen→layer）** または **描画座標変換（layer→screen）** のどちらかで、ExpandConfigのangleが不正に影響している可能性がある。

### 調査すべき箇所

1. **入力座標変換**: `apps/web/` でPointerEventのscreen座標をlayer座標に変換する処理。ViewTransformにexpand.angleが混入していないか
   - `packages/input/` の `screenToLayer` / `layerToScreen` 周辺
   - `apps/web/src/hooks/useExpand.ts` でangleがViewTransformに渡されていないか

2. **描画合成**: `composeLayers` やレンダリング時にexpand.angleが座標系に影響していないか
   - `packages/engine/src/incremental-render.ts` の `composeLayers`

3. **SymmetryOverlay自体**: ガイド線の描画がcanvasの座標系を変更していないか（save/restoreの欠如など）

4. **仮説**: `layerToScreen` がexpand.angleを考慮した変換をしていて、ポインタ位置→レイヤー座標の変換でangle分だけオフセットが入っているかもしれない。その場合、入力時点でangle分ずれた座標がexpandに渡されていることになる。

### 補足: radialにおけるangleの本質

radialモードの回転対称では、angleは数学的に打ち消される:
- 入力点Pをangle回転してP'にする → P'を等間隔回転で展開 → 結果をangle逆回転で戻す
- 結果的にPを直接等間隔回転したのと同じ

したがって、expand.tsでangleを無視するのは正しい。ガイド線のみangleで回転表示する（視覚的な方向指示として）。
