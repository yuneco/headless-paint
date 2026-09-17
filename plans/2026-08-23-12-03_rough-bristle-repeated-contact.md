# Rough bristle repeated contact production implementation

## Status

- Branch: `feature/acrylic-v2-production`
- Lab references: `GRAIN-02`, `COMB-02`, `COMB-03`
- State: Phase 4 complete; Production実装・検収・ユーザー官能gate通過

## Problem

ProductionのRough bristleはdocument座標へ固定したFine toothをalpha maskとして掛けている。
`surfaceGrain.amount: 1`では同じdocument pixelの谷が毎回alpha 0になるため、同じ場所を
反復しても紙目以上には着彩されない。`amount`を下げてalpha floorを作る回避策は、低筆圧部を
「疎な不透明片」ではなく「薄い全面着彩」に変えてしまう。

## Product behavior

1. Fine toothの高さ場はdocument座標へ固定する。
2. 筆圧と高さから初回接触の0/1着彩候補を決める。
3. 初回に接触しなかった谷にも小さな再接触確率を与え、同じ場所を繰り返すと徐々に埋まる。
4. 1 stroke内の交差と、複数strokeの交差を同じ結果モデルで扱う。
5. 半透明alpha floor、顔料厚canvas、wear / reservoirは追加しない。
6. 初期版は不透明またはほぼ不透明なpaintを対象とする。

## API and usage image

公開APIは増やさない。既存の`BristleSurfaceGrain`を紙目の形状・作用量・接触境界の設定として
維持し、反復接触のtransfer curveはRough bristle rendererの固定contractとする。

```ts
const brush: BristleBrushConfig = ROUGH_BRISTLE;

renderBrushStroke(layer, points, {
  ...style,
  brush,
});
```

`surfaceGrain.amount: 0`は紙目と反復接触をともに無効化する。`amount: 1`では接触したpixelを
不透明に着彩し、未接触pixelをalpha 0のまま残す。反復時も既存の`amount` / `hardness` /
`scalePx` / `seed`だけで初回表現を調整し、専用UI parameterは追加しない。

## Engine design

- 紙目判定をchunk平均筆圧の後段Canvas maskから、swept quadのsoftware rasterへ統合する。
- quad内の補間座標`u`からpixel-local pressureを取得する。
- fixed contactは`surface seed + document pixel`のhashで決定し、描画chunkへ依存させない。
- repeated contactは`stroke seed + document pixel + canonical distance trial`のhashで決定する。
- 同じquadを構成する2 triangleでは同じtrial identityを使う。
- chunk overlapやreplayで同じcanonical trialを再評価しても結果が変わらない。
- maskの結合は引き続き`max(alpha)`とし、初回未着彩cellへalpha floorを加えない。

固定のtransfer curveはLabで官能評価済みの`Repeat strength 0.75`を基準にする。谷の深さに対する
到達率は指数減衰させ、初回のFine toothを壊さず、数回の反復で隙間が視認できる程度に埋まる値を
Production fixtureで決める。

## Validation gates

- 低筆圧の初回strokeにalpha 0と高alphaが共存し、薄い全面着彩にならない。
- 高筆圧は低筆圧より着彩面積が大きい。
- 同じstrokeを異なるseedで重ねると、`amount: 1`でも着彩面積が増える。
- 1 stroke内の交差でも未着彩部が増分着彩される。
- full / incremental / replayのpixel差が既存許容値内に収まる。
- Rough bristle以外のbrush結果を変更しない。
- WebKit production経路でcold runを除くp95が既存Lab / Production基準から大幅劣化しない。

## Phases

1. API / behavior docs（この文書、engine docs）
2. 利用イメージ確認（公開API不変。承認済み方針のため通過）
3. software rasterへの接触モデル統合、テスト、Webデモ確認
4. build / test / lint、WebKit benchmark、library usage review

## Implementation checkpoint (2026-08-23)

- 後段の平均筆圧Canvas grain maskを削除し、software rasterへpixel-local contactを統合した。
- 固定紙目は`grain seed + document pixel`、再接触は`stroke seed + canonical distance trial + document pixel`で決定する。
- 461点 / 約1.92秒のProduction fixture、mixing OFF、WebKitでCall p50 / p95 `4 / 16ms`、batch wall p50 / p95 `4 / 16ms`、max `69ms`。Lab p95 `15ms`に対して1ms差でgate内と判断する。
- 固定S字はWebKit Call p50 / p95 `1 / 9ms`。低筆圧端はalpha floorではなく疎な着彩片として残る。
- `pnpm build`、`pnpm test`（39 files / 468 tests）、`pnpm lint`を通過した。
- Library usage review: 公開`BristleBrushConfig` / persistence schema / preset利用方法は不変。旧`applyDocumentGrain`と平均筆圧mask経路の参照は残っていない。public renderer経由の反復接触testとsoftware raster単体testの両方を持つ。
- 2026-08-23のユーザー官能評価で合格。固定紙目、低筆圧時の0/1寄りの面掠れ、反復接触による着彩増加を、Rough bristleのProduction基準として確定した。

## Deferred

- Canvas / layer共通Paper Surface resource
- 鉛筆・パステルと共有するsurface height API
- 紙の摩耗、顔料厚、有限reservoir
- 半透明paintでのchunk overlapと反復濃度の厳密化
