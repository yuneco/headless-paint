# Bristle の筋感整理と筆圧連動パラメータ

## 目的

紙目外部化の官能評価（`plans/2026-09-07-23-58_bristle-external-tooth-heightmap.md`）で出たユーザー所見に基づく整理。

- 高筆圧でも埋まらない固定の筋（1D 断面 profile のレーン隙間）は、ユーザーが制御できない割に表現差が強く邪魔になる → **レーン profile を削除**
- 筆圧で増減する筋（stroke-space dropout）は主役として残し、**「どの程度筋を出すか」を筆圧連動の強さとして制御**する。連動 0 なら常にベタ
- 太さの筆圧連動を stamp と同じ語彙（`size`）で提供する。透明度（`flow`）は現時点で正しく実装できない（下記）ため**定義ごと入れない**（ユーザー決定 2026-09-08: 動くもののみ定義する）

## 現状の事実（2026-09-08 調査）

- 断面 profile（`bristle-profile.ts`）は `bristleCount` 57 本のレーンを `bristleFill` 1.8（pitch の 1.8 倍幅、隣と重なる）で並べ、幅・間隔のばらつきで偶然できた隙間だけが固定の筋になる。筆圧では変わらない
- 見えている筋感の主因は dropout。ノイズセルが進行 58px × 横断 1px で細長く、閾値 `0.5 + (0.5 − 有効筆圧) × 0.9` を筆圧が下げる。`pressureDynamics.coverage` は有効筆圧を 0.5 へ寄せるだけなので、0 にしても閾値 0.5 の筋が常に残り「ベタ」にできない
- profile canvas（2px × 断面高）は混色時の断面色場の入れ物でもあり、CPU 掃引・GPU ink pass・checkpoint / run 内補間がこれを使う。レーンを消しても混色用の「alpha 1 の断面 canvas」は残る
- `edgeTextureAmount` / `edgeTextureLengthPx` は旧 mask 経路の遺物で参照されない
- CPU 非混色は chunk ごとの局所 canvas を layer へ source-over、GPU は stroke surface へ FUNC_ADD（source-over）で蓄積。chunk 境界の重なりは不透明 paint 前提。**半透明（flow < 1）では境界が二重に乗る**

## API 設計（クライアントから見える変更）

### `BristleDynamics`（削除 6、追加 0）

| フィールド | 変更 | 理由 |
|---|---|---|
| `bristleCount` / `bristleFill` / `bristleWidthVariation` / `bristleSpacingVariation` | **削除** | レーン profile 廃止 |
| `edgeTextureAmount` / `edgeTextureLengthPx` | **削除** | 未参照の遺物。互換維持しない方針 |
| `geometryStepPx` `transverseMaskCellPx` `dropoutLengthPx` `dropoutWidthPx` `depositHardness` `cusp*` `lagLengthRatio` `surfaceGrain` | 維持 | |

### `BristlePressureDynamics`（置換 1、追加 1）

```typescript
interface BristlePressureDynamics {
  readonly dropout: number; // 筆圧が弱いほど掠れる強さ。0 = 常にベタ、1 = 筆圧 0 で最大の掠れ
  readonly size: number;    // stamp と同義。0 = 均一幅、1 = 筆圧比例
}
const DEFAULT_BRISTLE_PRESSURE_DYNAMICS = { dropout: 1, size: 0 };
```

- `coverage` は削除（意味が変わるため置換。互換なし）
- `dropout`: mask の閾値を `dropout × (1 − p)` にする（`p` は `pressureCurve` 適用後の筆圧、未定義なら 0.5）。`dropout = 1, p = 0.5` で現行既定（閾値 0.5）と同じ濃さ。`p = 1` で閾値 0（ノイズは 0..1 なので抜けなし）、`p = 0` で閾値 1（ほぼ全抜け）。`dropout = 0` で閾値 0 固定（常にベタ）。内部定数 `SIMPLE_MASK_LOW_PRESSURE_GAIN` は廃止
- `size`: 掃引の半幅をサンプルごとに `calculateRadius(p, lineWidth, size, pressureCurve)` で決める。dropout ノイズの横断座標・紙目・混色 checkpoint footprint は基準 `lineWidth` のまま（ノイズと色場の安定性のため）
- `flow`（不透明度）は入れない。「1 ストローク = 不透明度 `T(p)` の 1 層」の意味論には CPU 側にストローク単位の alpha surface が要り、chunk 境界の重なり契約を変える大きめの作業になる。後続計画として agents-note に記録する

### 影響する公開面

- `packages/engine`: `types.ts`、`DEFAULT_BRISTLE_DYNAMICS`、`ROUGH_BRISTLE`、`bristle-profile.ts` 削除
- `packages/react`: `persistence.ts` の bristle 検証（削除 6 フィールド、`coverage` → `dropout` / `size`）。旧 schema の bristle 設定は parse 失敗 → 既定へフォールバック（既存の挙動に従う）。`usePenSettings` の `coverage` 参照
- `apps/web`: DebugPanel の bristle スライダー（coverage → dropout / size）

## 利用イメージ

```typescript
// 筋を出さないベタ塗りのハケ。筆圧は太さだけに効く
const flatHake: BristleBrushConfig = {
  ...ROUGH_BRISTLE,
  pressureDynamics: { dropout: 0, size: 1 },
};

// 弱い筆圧で掠れ、強く押すと太くベタになる
const expressive: BristleBrushConfig = {
  ...ROUGH_BRISTLE,
  pressureDynamics: { dropout: 1, size: 0.6 },
};
```

## 描画の変更点（内部）

1. profile 削除: `getBristleProfileAtlas` を廃止。非混色 CPU は `drawSweep` を alpha 1 の quad 塗りに、非混色 GPU は ink pass と profile texture upload を省略し mask alpha で composite。混色は alpha 1 の断面 canvas（2px × 2·lineWidth）を従来の位置に渡す
2. dropout: CPU `createSimpleBristleMaskEvaluator` と GPU `simpleMaskDistance` の閾値式を置換
3. size: `resolveSweepPoints` で半幅をサンプルごとに持ち、quad 頂点と GPU `crossPx` の範囲へ反映。mask の `rows` は基準幅で固定

## 作業手順

- Phase 1: docs（types.md / brush-api.md / README.md、react docs の persistence 記述）
- Phase 2: 利用イメージレビュー（パラメータ表を中心にユーザー確認）
- Phase 3: codex 委譲 2 本（A: engine、B: react persistence + web DebugPanel / 評価 UI）。検収は Claude（フル + 実ブラウザで dropout 0 / 1、size 0 / 1 の見た目）
- Phase 4: アーキテクトレビュー、agents-note 更新（flow の後続計画を記録）

## 完了条件

- `pressureDynamics.dropout = 0` で筆圧によらず筋が出ない、`1` で低筆圧ほど掠れる（CPU / GPU）
- `size = 1` で筆圧比例の太さ（CPU / GPU）
- profile 関連のパラメータ・モジュールが消え、混色の既存テスト（checkpoint / run 補間 / parity）が通る
- フル検収 green
