# live-vs-replay パリティテスト基盤（WS0-3）

中間層リファクタリング（paint-app `plans/2026-07-04-headless-paint-middle-layer.md`）のリグレッションガード。
現行コードでは「ライブ描画」と「記録された `StrokeCommand` の replay」は非等価である。
これは live がチャンク描画、replay が一発描画であることに由来する既知仕様として固定し、
中間層WS2で修正対象にする。スクリーンショット保存 baseline は使わず、
**同一実行内のピクセル完全一致比較**を主軸にする。

## 検証する性質

1. **(a) live vs replay**: セッション API（`startStrokeSession` → `addPointToSession`×N）で
   描いたレイヤーと、そこで生成された `StrokeCommand` を `replayCommand` で新規レイヤーに再生した結果が
   現行コードで非等価であることを `it.fails` で固定する。7ケースすべてが既知の失敗であり、
   失敗メッセージには差分ピクセル数、bounding box、RGBA の `maxChannelDelta` を出す。
2. **(b) undo rebuild**: stroke 後に `pushCommand` → `undo` → `rebuildLayerFromHistory` でストローク前の
   ピクセルに完全一致すること。下地があるケースでは、描画前の `beginHistoryMutation()` で
   pre-stroke checkpoint を履歴に保持する。
3. **(c) redo rebuild vs replay**: `redo` → `rebuildLayerFromHistory` の結果が、同じ `StrokeCommand` を
   `replayCommand` した結果に完全一致すること。これは replay 同士の決定性を守る本命の
   リグレッションガードで、全ケース green を必須とする。

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
  parity.test.ts         # (a)(b)(c) のマトリクステスト
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

// ピクセル完全一致アサーション。不一致時は差分ピクセル数、maxChannelDelta、bounding box を出力
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

各ケースで (a)(b)(c) を検証する。(a) は `it.fails` として既知の非等価を固定し、
(b)(c) は通常の green テストとして維持する。

## 既知のリスク（実装時の停止条件）

live は `addPointToSession` がオーバーラップ付きチャンクで `appendToCommittedLayer` を複数回呼び
brushState（accumulatedDistance/emissionCount）を引き継ぐのに対し、replay は fresh state から1回で描く。
この構造差は round-pen / stamp / spray の全7ケースで非等価として実測済みで、現行仕様として
`it.fails` により固定する。**非等価そのものを engine/stroke の実装コードで修正して合わせにいかないこと**。

(b) が失敗した場合は checkpoint 設定または undo rebuild のテスト手順を疑う。(c) が失敗した場合は
live/replay の非等価ではなく replay 経路の非決定性を示すため、実装コードを直さず詳細を記録して停止する。
