# 紙目 heightMap の正式化（レジストリ方式・web 同梱）

2026-09-16。`experiment/paper-tooth-heightmap` で評価してきた外部紙目 heightMap を、評価用の「メモリ上のオブジェクト参照」から、stamp の image tip と同じ **ID 参照 + レジストリ解決** に切り替えて正式採用する。procedural Fine tooth は既定として残し、heightMap は選択肢とする。

## 決定事項（ユーザー 2026-09-16）

- Turn follow（`handleLengthRatio`）は既定 0.5 で確定。追加作業なし
- 紙目テクスチャ外部化は効果的なので採用。procedural は既定として残し、テクスチャはオプション
- 履歴・設定への載せ方は stamp の image tip と同様（ID 参照、画像本体はレジストリ）
- web デモには ambientCG の **Fabric031 / Fabric036 / Fabric061** の 3 種のみ同梱（CC0 1.0。表示義務はないが出典を記載する）
- ブラシ透明度の設計は保留（調査ドキュメント `plans/2026-09-08-20-14_brush-opacity-investigation.md` はコミット済み）

## 現状（Phase 0 調査）

- `BristleSurfaceGrain.heightMap?: BristleHeightMap` が `StrokeCommand.style.brush` に `Float32Array` 参照のまま乗る。react の設定エクスポートでは参照コピー、復元では落ちる。web の `settings-storage` は JSON 化するので 1K map で localStorage 容量超過（catch で継続）
- image tip は `createInitialBrushState`（`packages/stroke/src/incremental-stroke.ts`）がストローク開始時に `registry` から解決し `BrushRenderState.tipCanvas` に置く。engine の `renderBrushStroke` は registry を受け取らない。未登録 ID は throw（`Image tip not found`）
- bristle は CPU（`bristle.ts` の `resolveBristleToothMap(brush.dynamics.surfaceGrain)`）と GPU（`pushBristleChunk` の `grain.toothMap`）の両方で `surfaceGrain` から直接高さを取る
- `BrushTipRegistry` は `get/set(imageId, ImageBitmap)` だけ。stroke（incremental-stroke / replay / stroke-runtime / command-executor）、react（usePaintEngine / useStrokeSession / history-ops）、web（App / BrushPanel / SidebarPanel / register.ts）に配線済み
- web の評価 UI `BristleGrainEvaluation` は dev サーバー専用 middleware `/eval-textures/`（`vite-eval-textures.ts`）から `work.local/paper-textures/height/` を読み、リサイズ（既定 1024）→ `createHeightMapFromImageData`（normalize=true, contrast=1, invert=false 既定）で作る
- react persistence の `parseBristleBrushConfig` は `surfaceGrain` の 4 フィールドだけを検証・再構成する（`heightMap` は落とす）

## 設計方針

### 1. 参照モデル: `heightMapId`（engine）

```typescript
interface BristleSurfaceGrain {
  readonly scalePx: number;
  readonly amount: number;
  readonly hardness: number;
  readonly seed: number;
  readonly heightMapId?: string; // レジストリに登録した高さマップの ID。未指定は procedural Fine tooth
}
```

- 現行の `heightMap?: BristleHeightMap` フィールドは削除（互換なし。評価期間中のメモリ専用フィールドで、永続化対象外だったため）
- 意味論は現行と同一: 指定時は `heights` を document 座標でタイル、`scalePx` は 1 texel あたりの px。未指定は procedural（`scalePx` はセル幅）

### 2. レジストリ: tip と高さマップを 1 つのレジストリで扱う

案 A（推奨）: `BrushTipRegistry` を **`BrushAssetRegistry`** に改名し、種別ごとの accessor を持たせる。

```typescript
interface BrushAssetRegistry {
  readonly getTip: (imageId: string) => ImageBitmap | undefined;
  readonly setTip: (imageId: string, image: ImageBitmap) => void;
  readonly getHeightMap: (heightMapId: string) => BristleHeightMap | undefined;
  readonly setHeightMap: (heightMapId: string, map: BristleHeightMap) => void;
}
function createBrushAssetRegistry(): BrushAssetRegistry;
```

- 理由: stroke / react / web の配線は既に 1 つの registry 引数で通っている。別レジストリを足すと `registry` と `heightMapRegistry` の 2 本を全経路（incremental-stroke config、replay 3 関数、stroke-runtime、command-executor、usePaintEngine、useStrokeSession、history-ops）に増やすことになる
- 旧名 `BrushTipRegistry` / `createBrushTipRegistry` / `get` / `set` は残さない（プロジェクト方針: 互換フォールバックなし）。参照箇所は docs 9 ファイル・src 14 ファイル
- 案 B: `BrushTipRegistry` の名前を維持して `getHeightMap/setHeightMap` を追加。配線ゼロだが「tip レジストリに紙目が入る」名前のねじれが残る。ユーザーが改名の churn を避けたい場合はこちら

### 3. 解決タイミング: ストローク開始時に `BrushRenderState` へ

tip と同じ場所で解決する。

```typescript
interface BrushRenderState {
  readonly tipCanvas: OffscreenCanvas | null;
  readonly heightMap: BristleHeightMap | null; // bristle で heightMapId 指定時のみ。開始時に registry から解決
  readonly seed: number;
  readonly branches: readonly BrushBranchRenderState[];
}
```

- `createInitialBrushState`（stroke）が bristle かつ `heightMapId` 指定なら `registry.getHeightMap(id)` を呼ぶ。registry なし / 未登録は image tip と同じく throw（`Height map not found: <id>`）。replay でも同じ経路なので、環境間で静かに procedural へ落ちない
- engine の `renderBristleBrushStroke` は `state.heightMap` を CPU / GPU の両経路で使う（`resolveBristleToothMap(grain, state.heightMap)`）。`cloneBrushRenderState` / `DEFAULT_BRUSH_RENDER_STATE` / `mergeBrushState` は参照をそのままコピー（heights は不変扱い）
- `BristleHeightMap` の寸法検証（1..2048）は `createHeightMapFromImageData` と `setHeightMap` の両方で行い、描画時の throw は残す

### 4. react persistence

- `parseBristleBrushConfig`: `heightMapId` は省略可。存在すれば非空文字列（長さ ≤ 128）以外は reject。復元後の設定に ID を保持する
- ID が指すマップの登録はアプリの責務（tip と同じ）。復元時に未登録でも persistence は成功し、その設定で描き始めたときに throw する（tip と同じ契約）

### 5. web デモ

- `apps/web/src/brush-presets/paper-textures/` に 3 枚を同梱し、Vite の asset import で URL を得る（`base` `/headless-paint/` の build でも解決される）。`public/` は作らない
- `registerAppBrushTips` を `registerAppBrushAssets` に改名し、起動時に 3 枚を fetch → `createImageBitmap` → `OffscreenCanvas` で `ImageData` → `createHeightMapFromImageData` → `setHeightMap`。ID は `"paper-fabric-031"` / `"paper-fabric-036"` / `"paper-fabric-061"`
- `BristleGrainEvaluation` の Source は「Procedural / Fabric 031 / Fabric 036 / Fabric 061」の固定 select にし、`heightMapId` を切り替える。`/eval-textures/` fetch、ファイル選択、リサイズ段階選択、Contrast / Invert / Normalize の再生成 UI は削除（変換オプションは同梱時に固定する）
- `vite-eval-textures.ts` / そのテスト / `vite.config.ts` の plugin 登録 / `vitest.config.ts` の include を削除
- 出典表示: `apps/web/src/brush-presets/paper-textures/README.md` に ambientCG の ID・URL・CC0 1.0・取得日・zip SHA-256・加工内容（Displacement の抽出とリサイズ）を記載。UI 上の出典表示は置かない

### 追加決定（ユーザー 2026-09-16）

1. レジストリは共通のリソース登録機能として **`BrushAssetRegistry`** に改名（案 A）。`BrushTipRegistry` 系の旧名は残さない
2. 同梱解像度は **512**（グレースケール JPG）。粒の大きさを評価時（1024 / scale 1）と揃えるため既定 `scalePx = 2`。利用側は任意サイズを `setHeightMap` で登録できる
3. 固定変換オプション: 3 枚とも invert=false, contrast=1。normalize は **Fabric031 のみ true**、036 / 061 は false
4. 任意画像の読み込み UI は削除。Source は Procedural + 同梱 3 枚の固定 select
5. UI 上の出典表示は不要（デモはライブラリ実装者向け）。出典はテクスチャのディレクトリの README のみに記載

## 作業手順（Doc-First）

### Phase 1: API 設計・ドキュメント

- `packages/engine/docs/types.md`: `BristleSurfaceGrain.heightMapId`、`BrushRenderState.heightMap`、`heightMap` フィールドの削除、永続化の記述を「ID は永続化対象、本体はレジストリ」へ
- `packages/engine/docs/brush-api.md`: `BrushAssetRegistry`（または案 B）、`createHeightMapFromImageData` の利用例を registry 登録へ、Rough bristle の説明の `surfaceGrain.heightMap` 参照を `heightMapId` へ
- `packages/engine/docs/README.md`、`gpu-acceleration.md`（tooth texture の取得元）、`packages/stroke/docs/{command-executor,stroke-machine,history-api,README}.md`、`packages/react/docs/README.md` の registry 名・型を更新
- 未登録 ID の契約（throw）を stroke docs に明記

### Phase 2: 利用イメージレビュー

- web 起動時の登録コード、Rough bristle の `heightMapId` 切り替え、persistence の往復、replay の失敗ケースをコード例で提示し、上記「未決」4 点の回答をもらう

### Phase 3: 実装（codex 委譲）

- engine: 型・registry・state・bristle CPU/GPU の取得元差し替え・`createHeightMapFromImageData` の検証、テスト（heightMapId 指定と未指定の byte 一致、clone の参照維持、GPU chunk の toothMap）
- stroke: `createInitialBrushState` の解決と throw、replay テスト
- react: persistence の検証・補完、往復テスト
- web: 同梱テクスチャ・登録・評価 UI の置き換え・dev middleware 削除・README
- 検収は Claude がフル（build / typecheck / lint / test 全件、ブラウザ含む）で実施

### Phase 4: アーキテクトレビュー

- 双方向の docs 整合、registry 名の残骸検索、`heightMap` オブジェクト参照の残骸検索、agents-note の関連項目整理

## 完了条件

- `heightMapId` 未指定の Rough bristle は現行と byte 一致
- 同じ ID・同じ登録内容で live / replay / Undo→Redo が byte 一致
- 未登録 ID は開始時に throw し、procedural へ静かに落ちない
- react persistence で `heightMapId` が往復し、web の localStorage 保存が 1K map で失敗しない（本体を保存しないため）
- web に 3 テクスチャが同梱され、`/eval-textures/` と `work.local` 依存が消える。出典がテクスチャディレクトリの README に記載される（UI 表示なし）
- フル検収 green

## 実装結果（2026-09-16、検収済み）

- codex に設計レビュー付きで委譲。ステップ 0 の判定は no-go なし。設計補足として、runtime と incremental renderer が別々に初期状態を作る構造を内部 `initialBrushState` の共有で一本化し、GPU 障害時の CPU 再描画も開始時に解決した同一の heightMap 参照を使うようにした（登録内容の後差し替えが進行中ストロークに影響しない契約を満たすため）
- engine: `BrushAssetRegistry` / `createBrushAssetRegistry`（`getTip/setTip/getHeightMap/setHeightMap`）、`BristleSurfaceGrain.heightMapId`、`BrushRenderState.heightMap`。`resolveBristleToothMap(grain, heightMap)` を CPU / GPU 両経路で使用。`validateHeightMap` を登録時・描画時で共用
- stroke: `createInitialBrushState` が開始時に 1 回だけ解決。registry 無しは `BrushAssetRegistry required for height map`、未登録は `Height map not found: <id>` を throw。`tipRegistry` フィールドは `registry` に改名
- react: persistence は `heightMapId`（1..128 文字）を往復、本体は保存しない
- web: Fabric031 / 036 / 061 を 512px グレースケール JPEG で `apps/web/src/brush-presets/paper-textures/` に同梱（出典 README 同梱、UI 表示なし）。起動時に `registerAppBrushAssets` で登録。評価パネルの Source は固定 select（Fabric 選択で scalePx 2、Procedural で 4）。`/eval-textures/` middleware・テスト・`apps/web/vitest.config.ts` を削除
- 追加テスト: asset-registry（検証・名前空間）、state（clone / branch / merge の参照維持）、bristle-pressure-dynamics（CPU raster と GPU chunk が `state.heightMap` を使う）、stroke `height-map-registry`（開始時 1 回解決・GPU 復旧・throw・procedural null）、`height-map-parity`（live / replay / undo-redo byte 一致、別マップで結果が変わる）、persistence 往復・reject
- Claude 検収: `pnpm -r build` / `pnpm typecheck` / `pnpm lint` 成功、`pnpm test`（browser mode 込み）62 ファイル 775 件成功。既存 parity / snapshot の期待値は無変更。Chromium 実機で Rough bristle → Fabric 031 / 061 の描画と Undo×2 / Redo×2 を実行しコンソールエラーなし
- docs: codex 指摘の記載漏れ（`BrushRenderState` 使用例・README 概要・round-pen 戻り値の `heightMap`、registry 未指定時のエラー文）を Claude 側で補正

### ペンディング

- 紙目 heightMap の Contrast は接触判定の性質上ほぼ効かない。ヒストグラム均等化（筆圧 p で紙の p 割が接触）への置き換えは別課題
- 同梱テクスチャの既定 `scalePx = 2` と normalize（031 のみ）は評価時の官能に基づく。実機で再確認して調整可
