# Spray brush design plan（粒子感エアブラシ／散布系ブラシ）

## ステータス

- 2026-07-02: 案B（新ブラシ系統 `"spray"`）で確定・承認。
- 2026-07-03: 全Phase実装完了（330 tests green・実機/性能確認済み）。同日のフィードバック調整（密度プロファイル化・sizeJitterMode 実験・UI修正）も反映済み。
- ペンディング: `sizeJitterMode` の最終選定（ユーザー評価後に1モードへ固定）。

## 背景と要求

粒子感のあるエアブラシを実現する。stamp の近似（spacing 小 + scatter 大）には以下の問題があった。

1. **性能**: 大量 dab の `drawImage` でブラシ大径時に性能劣化
2. **size 意味論の破綻**: ユーザーがエアブラシに求める size は「散布領域の径」だが、stamp の `lineWidth` は dab（粒子）径を意味する
3. **密度の連動**: 散布領域と粒子数が連動しない

size 意味論の違いはブラシモデルの違いであるため、`BrushConfig` に第3のバリアント `"spray"` を追加した。

## 実装された仕様

### モジュール構成（Step 0 リファクタ）

旧 `brush-render.ts`（566行）/ `brush-tip.ts` を `packages/engine/src/brush/` へ分割:

```
index.ts        renderBrushStroke（dispatch）+ 公開 re-export
prng.ts         mulberry32, hashSeed
scheduler.ts    walkEmissions（距離ベース emission 走査。stamp/spray 共有）
state.ts        BrushRenderState 生成・branch分解・merge・pendingクローン
tip.ts          generateBrushTip + BrushTipRegistry
stamp.ts        スタンプ描画
mixing.ts       混色チップ生成
spray.ts        スプレー描画
density-curve.ts 密度プロファイルの逆CDFサンプリング
```

`incremental-render.ts` からブラシ状態管理を排除し、「expand で分岐 → branch ごとに `renderBrushStroke` → state 更新」の一様ループに整理（398→248行）。

### branch state の統一

- `BrushRenderState = { seed, tipCanvas, branches[] }`。常に branches 配列（非Expandは長さ1）、branch ごとに `{ accumulatedDistance, emissionCount, mixing? }`
- `stampCount` → `emissionCount` にリネーム。emission = 距離 scheduler が発生させる描画単位（stamp: dab 1個 / spray: 粒子バースト1回）
- branch 実効 seed は `hashSeed(seed, branchIndex)`、emission 序数は branch ごとに 0 起点。非 mixing + Expand で2本目以降の branch に開始 emission が打たれない歪みを解消（意図的な挙動変更）
- `applyPressureCurve` は `evaluateParametricCurve` へ完全リネーム（互換エイリアスなし）。`PressureCurve` は `ParametricCurve` のエイリアス

### Spray ブラシ

```typescript
interface SprayBrushConfig {
  readonly type: "spray";
  readonly particle: BrushTipConfig;       // 粒子形状（circle/image）
  readonly dynamics: SprayDynamics;        // spacing, density, particleSize,
                                           // particleSizeJitter, sizeJitterMode,
                                           // opacityJitter, flow, radialDistribution
  readonly pressureDynamics: SprayPressureDynamics; // size / flow / density
}
```

- `lineWidth` = 散布領域の直径。`particleSize` = 粒子の絶対径 px（独立）
- 粒子数は面積連動: `n = density × πR²/1000 × 筆圧密度係数`。emission PRNG で確率的丸め、`SPRAY_MAX_PARTICLES_PER_EMISSION = 512` でクランプ
- `radialDistribution` は **`DensityProfileCurve`**（x: 0=中央→1=辺縁、y: 相対密度。端点 y 自由 + 2軸ハンドル×2、制御点 x∈[0,1] で単調性保証）。円環面積重み `pdf ∝ d(x)·x` の逆CDF LUT（128 entry、カーブ値キーのキャッシュ）でサンプリング。一様密度 ≡ 一様円盤（√u）、リング等の非単調分布も可。全ゼロ密度は一様円盤フォールバック
- `sizeJitterMode`（実験的、最終的に1つへ固定予定）: `uniform`（一様縮小）/ `power`（小粒優勢スキュー）/ `lognormal`（対数正規、倍率 [0.25,4]、チップは4倍で生成し縮小描画）/ `bimodal`（微小粒集団との混合）。粒子ごとの乱数消費は全モード同数に固定
- 決定論: `hashSeed(branchSeed, emissionIndex)` → `mulberry32`、emission 内乱数消費順固定。incremental ≡ replay をピクセル一致で保証
- mixing 非対応（フィールドなし）。`rotationJitter` / `scatter` なし
- プリセット `SPRAY_AIRBRUSH`。既存の stamp `AIRBRUSH` / scatter 系プリセットは維持

詳細は `packages/engine/docs/types.md` / `brush-api.md` を参照。

### UI（apps/web）

- BrushPanel に Spray プリセット追加。DebugPanel に Spray Dynamics（density / particleSize / jitter / sizeJitterMode / flow / pressure 系）
- `DensityProfileCurveEditor`（SVG、端点 y + 2軸ハンドルをドラッグ。左=中央/右=辺縁/上=高密度）
- Line Width スライダー上限 150
- DebugPanel ルートに `maxHeight: 100vh; overflow-y: auto`（サイドバー内容超過時に下部が操作不能だった問題の修正）

### 性能（計測結果）

- 直径 256px・筆圧 0.8: chunk 平均 0.177ms / p95 0.3ms（ブラウザ実測）。60fps 描画中フレーム落ちなし
- 粒子ごとの `save()/restore()` 回避・中間オブジェクト非生成のマイクロ最適化実施
- バーストテクスチャ最適化は不要と判断（計測余裕のため見送り。必要時に内部最適化として追加可能）

## 実装時の調整内容（補足）

- 初版の radialDistribution は「半径サンプリング写像 r = R·f(√u)」（`ParametricCurve` 流用）だったが、ユーザーフィードバックにより**密度プロファイル + 逆CDF** に変更。UI掛け替えのみではカーブの形と分布の意味がズレるため、エンジンごと差し替えた
- `usesBranchBrushState`（常に true を返す互換残骸）はレビューで削除
- BrushPanel のプリセット一致判定が `tip.type` のみ比較だった問題を codex review で検出し、hardness / imageId まで比較するよう修正（stamp / spray 共通）
- persistence: 旧形式・不正な radialDistribution は `DEFAULT_RADIAL_DISTRIBUTION` へ、未知の sizeJitterMode は `"uniform"` へフォールバック

## ペンディング

- `sizeJitterMode` の最終選定（2026-07-04 ユーザー評価予定。固定後は他モードのコードとフィールドを整理）
- image 粒子チップの回転ジッタの要否（v1 は回転なし）
- 時間 emission（吹き付け堆積）: `plans/pendings/2026-06-18-20-58_stamp-time-dabs.md` 側で stamp/spray 同時対応。`scheduler.ts` に `walkTimeEmissions()` を並列追加できる構造は確保済み
- デモUIで小径 spray（〜12px）は粒子が疎でほぼ見えない（面積連動仕様のため）。UX 調整の要否は今後判断

## 非目標（変更なし）

- 混色（mixing / pickup）の spray 対応
- 既存 stamp ブラシの size 意味論変更
- 速度依存 dynamics、粒子の物理シミュレーション
- round-pen への機能追加
