# live-vs-replay パリティテスト基盤（WS0-3）

中間層リファクタリング（paint-app `plans/2026-07-04-headless-paint-middle-layer.md`）のリグレッションガード。
「ライブ描画」「記録された StrokeCommand の replay」「undo→redo の rebuild」が同一ピクセルを生むことを、
リファクタ前後で保証する。スクリーンショット保存 baseline は使わず、**同一実行内のピクセル完全一致比較**を主軸にする。

## 検証する性質

1. **(a) live vs replay**: セッション API（`startStrokeSession` → `addPointToSession`×N → `endStrokeSession`）で
   描いたレイヤーと、そこで生成された `StrokeCommand` を `replayCommand` で新規レイヤーに再生した結果が
   ピクセル完全一致すること
2. **(b) undo/redo 等価**: stroke 後に `pushCommand` → `undo` → `rebuildLayerFromHistory` でストローク前の
   ピクセルに戻り、`redo` → `rebuildLayerFromHistory` で (a) の live 結果と完全一致すること

## 決定化の方法

- **brushSeed**: 固定値を明示注入する（`createStrokeCommand` / `endStrokeSession` に渡す）。
  乱数は `mulberry32(hashSeed(seed, emissionIndex))` で seed から完全決定的
- **クロック**: replay に実クロックは不要。入力点の `timestamp` はテストデータとして固定値を埋め込む。
  静止吹きつけ（emission）は「timestamp だけ進んだ同座標の点列」をテストデータで表現する
  （react 層のタイマーが行う合成点注入と同じ形。タイマー自体はここではテストしない）
- **フィルタ**: live 側もテストヘルパーが filterPipeline をコンパイルして逐次処理し、replay 側の
  `processAllPoints`（一括処理）と突き合わせる。逐次 vs 一括の差もパリティ対象に含める

## 構成

```
packages/stroke/src/
  parity-helpers.ts      # テスト専用ヘルパー（export はテストからのみ使用）
  parity.test.ts         # (a)(b) のマトリクステスト
```

既存の `replay.test.ts`/`history.test.ts` は engine を vi.mock するが、**パリティテストは実 engine を使う**
（vitest browser mode + 実 OffscreenCanvas）。ピクセル比較は `engine` の `getImageData` を用い、
`spray.test.ts` の `pixels()` 完全一致パターンを踏襲する。

### ヘルパー IF

```ts
// ライブ経路をシミュレートし、描画済み layer と生成された StrokeCommand を返す
simulateLiveStroke(opts: {
  layer: Layer;                       // 描画先（事前内容があってもよい）
  inputPoints: InputPoint[];          // 生入力（timestamp 固定値埋め込み済み）
  style: StrokeStyle;
  filterPipeline: FilterPipelineConfig;
  expand: ExpandConfig;
  brushSeed: number;                  // 必須（既定 0 に頼らない）
  alphaLocked: boolean;
  sourceLayer?: Layer;                // mixing 用サンプリング元
}): { command: StrokeCommand }

// StrokeCommand を新規/指定レイヤーに replay
replayOnLayer(command: StrokeCommand, layer: Layer, sourceLayer?: Layer): void

// ピクセル完全一致アサーション。不一致時は差分ピクセル数と bounding box を出力
expectPixelEqual(actual: Layer, expected: Layer, label: string): void
```

## テストマトリクス

各ケース: 固定 seed / 筆圧変化を含む点列 / 静止ホールド区間（同座標・timestamp 前進）を含む。

| ケース | brush | 追加条件 |
|---|---|---|
| round-pen 基本 | ROUND_PEN | — |
| round-pen 消しゴム | ROUND_PEN | compositeOperation: destination-out、下地あり |
| round-pen アルファロック | ROUND_PEN | alphaLocked: true、下地あり |
| stamp ジッター | AIRBRUSH（stamp） | sizeJitter/opacityJitter/scatter あり |
| stamp mixing | stamp + mixing | sourceLayer に下地色 |
| spray lognormal | SPRAY_AIRBRUSH | sizeJitterMode: "lognormal" |
| spray bimodal | SPRAY_AIRBRUSH | sizeJitterMode: "bimodal" |

各ケースで (a)(b) 両方を検証する。

## 既知のリスク（実装時の停止条件）

live は `addPointToSession` がオーバーラップ付きチャンクで `appendToCommittedLayer` を複数回呼び
brushState（accumulatedDistance/emissionCount）を引き継ぐのに対し、replay は fresh state から1回で描く。
stamp/spray でこの構造差が非等価を生む可能性がある。**パリティ不一致が出た場合、engine/stroke の
実装コードを修正して合わせにいかないこと**。不一致の組合せ・差分規模を記録してテストは失敗のまま報告し、
扱い（現状挙動の仕様化 or 中間層での修正対象化）は計画側で判断する。
