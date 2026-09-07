# Bristle 紙目テクスチャの外部化（評価用）

## 目的

Rough bristle の見た目は「ストローク追従の掠れ（dropout）」×「document 固定の紙目（Fine tooth）」の積。
本作業は **紙目だけ** を外部の高さマップ（画像）へ差し替えられるようにし、表現の幅を実ブラウザで官能評価する。
掠れ・毛束断面の外部化は本作業の結果を見てから判断する（`plans/agents-note.md` リリース前確認事項 (1)）。

評価の問い:
- 紙目を画像に差し替えると、procedural Fine tooth と比べて見た目の幅が「意味のある程度」広がるか
- scale（px/texel）と amount / hardness の組み合わせで破綻（モアレ・タイル継ぎ目・単調化）が出ないか
- CPU / GPU 経路で同じ画像を使ったときに parity が保たれるか

## 現状（2026-09-07）

- CPU: `bristle-mask.ts` の `getFineToothHeightTile(seed, scalePx)` が 128² の `Float32Array` を生成、`hasSurfaceContact` が document 座標を 128 で mod してサンプル
- GPU: `gpu-stroke-surface.ts` の `GpuGrainParams.toothHeights` を `bristle-pass.ts` が 128×128 R32F へ `texSubImage2D`、shader `hasSurfaceContact` は `% 128` を定数で持つ
- Web: `BristleGrainEvaluation.tsx` が scale / hardness / amount / seed のスライダーと、procedural を複製したプレビューを持つ
- 画像テクスチャ資産は Lab にもない

## API 設計（Phase 1 で docs へ反映）

### 型（`packages/engine/src/types.ts`）

```typescript
/** document 座標へ固定してタイル状に繰り返す紙目の高さマップ。値は 0..1（1 = 山、絵の具が付きやすい）*/
export interface BristleHeightMap {
  readonly width: number;   // texel 数。1..2048
  readonly height: number;
  readonly heights: Float32Array; // row-major, width * height, 0..1
}

export interface BristleSurfaceGrain {
  readonly scalePx: number;   // procedural: ノイズのセル幅 px / heightMap: 1 texel あたりの px
  readonly amount: number;
  readonly hardness: number;
  readonly seed: number;      // procedural の紙目 seed。heightMap 指定時も接触判定の hash には使う
  readonly heightMap?: BristleHeightMap; // 指定時は procedural Fine tooth の代わりに使う
}
```

サンプリング契約（CPU / GPU 共通）:
- `texelX = positiveMod(floor(documentX / scalePx), width)`、Y も同様。nearest。補間なし
- `heightMap` 未指定時は従来通り procedural 128² タイル（scalePx はセル幅として焼き込み済み）。内部では両者を「map + scale」の同一表現へ正規化してから接触判定へ渡す
- 接触判定式（softness / amount / 反復接触の確率）は変更しない。変わるのは高さの取得元だけ

### ヘルパー（`packages/engine` export）

```typescript
export interface HeightMapFromImageOptions {
  readonly invert?: boolean;    // 暗い所を山にする（default false: 明るい所が山）
  readonly normalize?: boolean; // min..max を 0..1 へ伸長（default true）
  readonly contrast?: number;   // normalize 後に 0.5 中心で伸縮して clamp（default 1、0..8 程度）
}
export function createHeightMapFromImageData(
  image: ImageData,
  options?: HeightMapFromImageOptions,
): BristleHeightMap;
```

- 輝度は Rec.601（0.299R + 0.587G + 0.114B）。alpha は無視
- 処理順: 輝度 → invert → normalize → contrast（`clamp(0.5 + (h - 0.5) * contrast)`）
- 純関数。画像のデコードとリサイズは呼び出し側（Web なら `createImageBitmap` → OffscreenCanvas に長辺上限で縮小して描画 → `getImageData`）
- 実写の displacement map はコントラストが低い（2026-09-08 取得分を目視確認）ため、normalize + contrast は評価に必須

### GPU 内部 IF（公開 API ではない）

- `GpuGrainParams.toothHeights` → `toothMap: BristleHeightMap` + `toothScalePx: number`
- tooth texture は map の寸法が変わったときだけ `texImage2D` で再確保、同寸なら `texSubImage2D`
- shader: `uniform ivec2 uToothSize; uniform float uToothScale;` で定数 128 を置換

### 制約

- `heightMap` はブラシ設定のメモリ上のデータであり、永続化・シリアライズは対象外（評価用の位置づけ）
- width / height は 1..2048。超える場合は throw（GPU `MAX_TEXTURE_SIZE` の下限に合わせる）
- 非整数 `scalePx` では CPU / GPU の floor 境界がわずかに食い違い得る。parity テストは整数 scale（1, 2）で行う

## 利用イメージ（Phase 2）

```typescript
// apps/web: サンプル画像を紙目にする
const bitmap = await createImageBitmap(await (await fetch("/textures/cold-press.png")).blob());
const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
const ctx = canvas.getContext("2d")!;
ctx.drawImage(bitmap, 0, 0);
const heightMap = createHeightMapFromImageData(
  ctx.getImageData(0, 0, bitmap.width, bitmap.height),
  { invert: false, normalize: true },
);

onBrushChange({
  ...brush,
  dynamics: {
    ...brush.dynamics,
    surfaceGrain: { ...brush.dynamics.surfaceGrain, heightMap, scalePx: 1 },
  },
});

// procedural に戻す
surfaceGrain: { ...grain, heightMap: undefined, scalePx: 4 }
```

stroke / react パッケージは `BristleBrushConfig` をそのまま運ぶだけなので変更なし。

## Web 評価 UI

`BristleGrainEvaluation.tsx` に追加:
- Source セレクト: `Procedural` / 評価用テクスチャ一覧（dev サーバーから取得） / `画像を開く…`（`<input type="file">`）
- heightMap 用の調整（ユーザー要望 2026-09-08: 検証しやすいようスケールとコントラストを設定で変えられること）
  - Scale: 既存 `scalePx` スライダーを heightMap 時「px/texel」表記にし、既定 1、範囲 0.5..8
  - Contrast: `createHeightMapFromImageData` の `contrast`（0.25..8、既定 1）
  - Invert / Normalize チェック
  - Max size: 読み込み時の長辺上限（256 / 512 / 1024 / 2048、既定 1024）。画像はこの上限へ縮小してから高さマップ化する
  - デコード済み `ImageData` は保持し、調整変更のたびに `createHeightMapFromImageData` を再実行して commit する（1K で約 1M texel、release 時のみ）
- 既存の hardness（UI 表記 Contrast）と紛れないよう、UI 表記を「Contact hardness（接触の硬さ）」へ改める
- プレビューは heightMap をそのまま濃淡表示（procedural と同じ描画式で amount / hardness を反映）

### 評価用テクスチャの置き場と配信（ユーザー方針 2026-09-08）

- 画像はリポジトリに入れない。`work.local/paper-textures/height/*_Displacement.jpg`（ambientCG CC0、出典と SHA-256 は同ディレクトリの `manifest.md`）に置く
- `apps/web/vite.config.ts` に dev 専用ミドルウェアを追加: `GET /eval-textures/` で `work.local/paper-textures/height/` 内の画像ファイル名一覧を JSON で返し、`GET /eval-textures/<name>` で本体を配信する。ディレクトリが無ければ空配列。build 成果物には一切含めない
- 評価 UI は一覧を起動時に取得してセレクトへ並べる。CC0 以外の画像を試すときも同じディレクトリに置くだけでよく、コミット領域には入らない
- 取得済み: Paper001 / Paper003 / Paper006 / Fabric031 / Fabric036 / Fabric061 / Fabric062（いずれも 1K displacement、低コントラスト）

## 作業手順

### Phase 1: docs
- `packages/engine/docs/types.md`: `BristleHeightMap`、`surfaceGrain.heightMap`、サンプリング契約
- `packages/engine/docs/brush-api.md`: `createHeightMapFromImageData` と利用例、README 関数テーブル
- `packages/engine/docs/gpu-acceleration.md`: tooth texture が可変寸法になる旨

### Phase 2: 利用イメージレビュー（本ファイルの「利用イメージ」でユーザー承認）

### Phase 3: 実装（codex へ委譲、2 本）
- A（engine）: 型・ヘルパー・CPU `hasSurfaceContact` の map 化・GPU upload / shader uniform 化・テスト
  - テスト: `createHeightMapFromImageData`（輝度・normalize・invert・寸法検証）、CPU タイリングと scale、既存 procedural 結果が byte 一致で不変、GPU parity（browser、scale 1 / 2）
- B（web）: vite dev ミドルウェア（`/eval-textures/`）、評価 UI の Source / Contrast / Invert / Normalize / Max size / file 入力、hardness の表記変更
- 検収は Claude: `pnpm -r build && pnpm test && pnpm lint` + 実ブラウザで CPU / GPU の見た目確認

### Phase 4: アーキテクトレビュー → 官能評価
- 実ブラウザ（WebKit + Chromium）で取得済みテクスチャ 7 種 × scale {1, 2, 4} × contrast {1, 2, 4} を描画し、procedural と比較
- 結果と「掠れ・断面も外部化するか」の判断を `plans/agents-note.md` へ記録

## 完了条件

- heightMap 指定で CPU / GPU とも紙目が画像由来になり、未指定時の出力は従来と byte 一致
- 評価 UI でサンプルと任意画像を切替でき、フル検収 green
- 官能評価の所見が agents-note に残る
