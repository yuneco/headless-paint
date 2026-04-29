# 8x8 field color mixing

## 目的

この計画は PoC の結果と、将来実装する場合の方針を記録するためのもの。現時点では実装変更は残していない。

PoC の目的は、アクリルブラシの混色を Canvas2D の alpha 合成から 8x8 の低解像度 color field ベースへ拡張した場合に、出力品質と性能が実用に耐えるかを確認すること。大きい dab が複数色の境界をまたいだとき、dab 全体が一律色にならず、ブラシ内部の局所差として下地色を拾えるかを検証する。

同じ 8x8 field mixing 経路で、セルごとの色補間アルゴリズムを Mixbox / OKLab / OKLCH / sRGB から切り替えられるようにし、品質比較を可能にする。

## 現在の状態

- PoC 実装は一度作成して検証済み。
- 検証後、実装・ドキュメント・依存追加の変更は破棄済み。
- このファイルだけを、再実装時の計画と判断記録として残している。

## Phase 1: API設計・ドキュメント作成

- `BrushMixing` に混色モデルを選ぶ `model` を追加する。
- 既存挙動は `model: "canvas"` として維持する。
- 実験用モデルとして `model: "mixbox-field"` を追加する。
- `mixbox-field` は 8x8 をデフォルトの field resolution とする。
- `BrushMixing` に `algorithm?: BrushMixingAlgorithm` を追加する。
- `BrushMixingAlgorithm` は `"mixbox" | "oklab" | "oklch" | "srgb"` とする。
- `model: "mixbox-field"` は 8x8 field 経路の選択、`algorithm` はセルごとの色補間方式の選択として責務を分ける。
- 未指定時の `algorithm` は `"mixbox"` として扱う。
- 対象ドキュメント:
  - `packages/engine/docs/types.md`
  - `packages/engine/docs/brush-api.md`

## Phase 2: 利用イメージレビュー

- `apps/web` の Acrylic preset で `mixing.model: "mixbox-field"`, `fieldResolution: 8`, `algorithm: "mixbox"` を指定する利用例を確認する。
- DebugPanel の Brush Dynamics に mixing algorithm の select を追加し、stamp brush の `mixing.algorithm` を更新する利用イメージを確認する。
- この API で実験の目的に合うかユーザー確認を取る。
- 承認まで実装へ進まない。

## Phase 3: 実装

- `packages/engine/src/types.ts` の型を更新する。
- `packages/engine/src/brush-render.ts` に `mixbox-field` の buffer 更新経路を追加する。
- `BrushRenderState.branches[]` に、分岐ごとの 8x8 brush field と source sample を保持する。
- `colorBuffer` は状態の正本にせず、field を `tipCanvas` と合成して描画するためのキャッシュとして扱う。
- source sample はストローク開始時または source layer 変更時に低解像度で作成し、dab 配置時は JS 配列から 8x8 サンプルする。
- Canvas readback は dab ごとに行わない。
- セル補間を `mixColor` に分離し、Mixbox / OKLab / OKLCH / sRGB を切り替える。
- 必要に応じて Mixbox 変換処理、OKLab/OKLCH 変換処理を engine 内の小さいモジュールに分離する。
- Acrylic preset を `mixbox-field` へ切り替える。
- DebugPanel に algorithm selector を追加する。
- persistence validation と UI の設定比較・検証が `BrushMixing` 拡張に追従しているか更新する。
- テストを追加し、既存 Canvas mixing の互換性と 8x8 field の局所色保持を確認する。
- 最小テストとして brush-render と persistence を通す。

## Phase 4: アーキテクトレビュー

- 実装と docs の型・デフォルト値・利用例が一致することを確認する。
- Canvas2D 既存混色を壊していないことを確認する。
- `mixbox-field` が experimental な品質検証用として責務を限定できていることを確認する。
- review-library-usage skill でセルフレビューを行う。

## 実験結果

- 8x8 field mixing は出力品質として合格点だった。
- 初期実装の dab ごとの `getImageData` は非常に重く、プロファイル上で処理時間の大半を占めた。
- 改善実験として、ブラシの保持色 field を `Uint8ClampedArray` で持ち、`colorBuffer` を描画用キャッシュに降格した。
- さらに下地色もストローク中の低解像度スナップショットとして保持し、dab ごとの readback を避ける方針を確認した。
- Mixbox / OKLab / OKLCH / sRGB を同じ 8x8 field mixing 経路で切り替え、混色アルゴリズムだけ比較できることを確認した。
- DebugPanel から切り替える利用イメージで問題ないことを確認した。
- この方針で性能・品質ともに合格点であることを確認した。

## 今後実装する場合の方針

- `BrushRenderState.branches[]` に、分岐ごとの 8x8 brush field と source sample を保持する。
- `colorBuffer` は状態の正本にせず、field を `tipCanvas` と合成して描画するためのキャッシュとして扱う。
- source sample はストローク開始時または source layer 変更時に低解像度で作成し、dab 配置時は JS 配列から 8x8 サンプルする。
- Canvas readback は dab ごとに行わない。
- `BrushMixing` に `algorithm?: "mixbox" | "oklab" | "oklch" | "srgb"` を追加する。
- DebugPanel の Brush Dynamics に algorithm selector を置き、stamp brush の `mixing.algorithm` を更新する。
- persistence validation は `algorithm` の4値を許可する。
- 実験実装は破棄し、この計画のみ残す。
