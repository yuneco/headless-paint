# live-vs-replay パリティテスト基盤（WS0-3）

中間層リファクタリング（paint-app `plans/2026-07-04-headless-paint-middle-layer.md`）のリグレッションガード。
「ライブ描画」と「記録された `StrokeCommand` の replay」が同じ canonical incremental path を通り、
ビット一致することを固定する。スクリーンショット保存 baseline は使わず、
**同一実行内のピクセル完全一致比較**を主軸にする。

## 検証する性質

1. **(a) live vs replay**: `createStrokeRuntime` で描いたレイヤーと、そこで生成された `StrokeCommand`
   を `replayCommand` で新規レイヤーに再生した結果が、全ケースでピクセル完全一致すること。
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
- **フィルタ**: live/replay とも `processPoint` + `finalizePipeline` の逐次処理に統一する。
  replay は `processAllPoints` による一括処理を使わない。
  Rough bristle は製品既定と同じ `causal-adaptive` を使い、各入力がpendingを経ず確定する経路を検証する。

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
// stroke-runtime のライブ経路を実行し、描画済み layer と生成された StrokeCommand を返す
simulateLiveStroke(opts: {
  layer: Layer;                       // 描画先（事前内容があってもよい）
  inputPoints: InputPoint[];          // 生入力（timestamp 固定値埋め込み済み）
  style: StrokeStyle;
  filterPipeline: FilterPipelineConfig;
  expand: ExpandConfig;
  brushSeed: number;                  // 必須（既定 0 に頼らない）
  alphaLocked: boolean;
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
| rough bristle mixing | ROUGH_BRISTLE | causal-adaptive、sourceLayerに下地色、連続毛束と面掠れ |
| spray lognormal | SPRAY_AIRBRUSH | sizeJitterMode: "lognormal" |
| spray bimodal | SPRAY_AIRBRUSH | sizeJitterMode: "bimodal" |

各ケースで (a)(b)(c) を通常の green テストとして検証する。

## 既知のリスク（実装時の停止条件）

live と replay は `createIncrementalStrokeRenderer` を通り、1点ずつ `feed` してから `finalize` する。
この構造により、`addPointToSession` のオーバーラップ判定、filter の逐次処理、brushState の carry、
mixing 用 sampling layer の作成タイミングを統一する。

(b) が失敗した場合は checkpoint 設定または undo rebuild のテスト手順を疑う。(c) が失敗した場合は
replay 経路の非決定性を示すため、差分ピクセル数、`maxChannelDelta`、原因仮説を記録して停止する。

## GPU加速器との parity（Tier B）

`accelerator` を注入した混色 stamp は WebGL2 で描かれる。契約は次のとおり（engine の [gpu-acceleration.md](../../engine/docs/gpu-acceleration.md) を参照）。

- **同一 backend**（GPU 同士、CPU 同士）: live / incremental / replay / Undo / Redo は入力点列が同じなら pixel 完全一致。GPU 経路では accelerator を注入した runtime と replay の双方で同じ経路を通ること
- **CPU vs GPU**: byte 一致は要求しない。固定 fixture で alpha MAE ≤ 0.015、RGB MAE ≤ 0.02、`|Δ| > 0.1` の pixel 率 ≤ 1%（union coverage 基準）、bbox 差 ≤ 1px を満たす
- replay（`replayCommand` / `executeHistoryOp` の options）にも同じ accelerator を渡す。渡さない場合は CPU 経路で再構築され、GPU で描いた live 結果とは Tier B の範囲で差が出る
