# Changelog

## 0.0.13 - 2026-09-20

### Added

- Rough bristle、WebGL2ブラシ加速、紙目高さマップ、causal-adaptive入力フィルタ。
- `createHeightMapFromImageData` と関連型を公開エントリから利用可能に。

### Fixed

- Rough bristleの混色ONで、急なカーブや筆圧による幅変化に生じる割れを修正。混色の被覆をmaskに統一したため、既存ストロークの再描画では局所的な色の拾い方も変化する。

- 複数レイヤーのUndo/Redo・履歴再構築で、他レイヤーの描画や消去が混入する問題。
- 公開APIの型・利用例、累積点列、sampling条件、回転後のパンのドキュメント。

### Migration from 0.0.12

- `BrushTipRegistry` / `createBrushTipRegistry` → `BrushAssetRegistry` / `createBrushAssetRegistry`、`tipRegistry` → `registry`。チップ用の `get` / `set` は `getTip` / `setTip` へ変更。独自registryには `getHeightMap` / `setHeightMap` も必要。
- 混色設定の `pickup` / `restore` は廃止。新しい距離rate・色場設定は `DEFAULT_BRUSH_MIXING` を基に調整する。旧混色設定を含む保存設定は、混色OFFでも `importPaintSettings` が `null` を返すため、アプリ側で設定を再作成する（自動変換なし）。
- 手組みの `BrushDynamics` に `spacingSizeCoupling: 0`、`BrushRenderState` に `heightMap: null` を追加すると従来の設定を維持できる。紙目を指定するbristleでは登録済み高さマップを使用する。
- `BrushConfig` の網羅的分岐に `bristle` を追加する。

詳細: [ブラシAPI](packages/engine/docs/brush-api.md)、[型定義](packages/engine/docs/types.md)、[保存設定の互換ルール](packages/react/docs/README.md#互換ルール)。
