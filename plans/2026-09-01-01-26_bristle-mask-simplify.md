# Bristle mask simple 探索

## 目的

`?bristleMask=field|simple`（既定 `field`）で、現行 field と broad 1 octave の simple dropout を runtime 切替し、GPU simple では CPU field 生成と texture upload を省く。Fine tooth、反復接触、profile atlas、mixing は共通のまま維持する。

## Phase 1: API 設計・ドキュメント

- 公開 API、persisted 形式、パッケージ export は変更しない。
- URL から `globalThis` の内部 debug flag へ設定し、engine 内部で参照する。
- ユーザー指定により docs は更新しない。外部 IF の追加がないため API docs の変更対象もない。

## Phase 2: 利用イメージレビュー

- `?bristleMask=field` または未指定: 現行 field 経路。
- `?bristleMask=simple`: CPU は simple field grid、GPU は shader 内 procedural 評価。
- 利用形、既定値、変更禁止範囲はユーザープロンプトで承認済み。

## Phase 3: 実装・検証

1. debug flag の読取と CPU simple field 生成を追加する。
2. GPU chunk に simple dropout パラメータと距離を渡し、shader で broad noise と pressure threshold を評価する。
3. GPU simple では mask field の生成・packing・upload を行わない。
4. default field の既存テスト期待値を維持し、simple の決定性と parity を追加確認する。
5. `pnpm -r build`、`pnpm lint`、`pnpm typecheck`、ノンブラウザ `pnpm test` を実行する。実行可能なら browser parity/perf も計測する。

## Phase 4: アーキテクトレビュー

- Fine tooth・反復接触・profile atlas・mixing に差分がないことを確認する。
- runtime flag が公開 API と persisted data に漏れていないことを確認する。
- `review-library-usage` の観点で既存 hash、フラグ配線、型・docs 整合をセルフレビューする。

## 実装結果

- CPU simple は broad `valueNoise2d` 1 octave と pressure threshold だけを既存 field grid に評価する。detail と edge micro texture は除外した。
- GPU simple は distance / crossPx / pressure を sweep vertex から補間し、fragment shader で同じ式を評価する。chunk の mask field 生成・packing・upload は行わない。
- Fine tooth、反復接触、profile atlas、mixing のロジックは変更していない。
- Chromium 一時計測（Rough 120px、150 samples、50回平均）: field 1.082ms、simple 0.356ms、simple/field 0.329。
- CPU grid と GPU procedural の Tier B は未達: alpha MAE 0.02263、`|Δ| > 0.1` 率 2.617%、coverage 差 0.417pt。同一 GPU backend の連続2回は完全一致。
- `pnpm -r build`、`pnpm lint`、`pnpm typecheck`、`pnpm test -- --run`（47 files / 560 tests）は green。
