# レイヤー移動（Translate Layer）機能

> **ステータス: 破棄** — 本計画は採用されなかった。移動だけでなくリサイズ・回転・反転も統一的に扱えるよう、mat3 ベースの汎用アフィン変換アプローチに置き換えた。後継計画は `2026-03-07-layer-transform.md` を参照。

## Context

ペイントソフトとしてレイヤー内容の移動機能が必要。対象は単一レイヤー、wrapなし。
ドラッグ中はoffsetベースの非破壊プレビュー、確定時にピクセル焼き込み（はみ出しはクリップ）。
確定前にクリップによるピクセル損失の有無を判定する機能も提供する。

**方針A（焼き込み+クリップ）を採用**: レイヤーサイズ固定、Undoはrebuildで復元。

## 破棄理由

- translate-only では移動しかできず、リサイズ・回転・反転のたびに別 API を追加する必要がある
- mat3 アフィン変換なら1つの API（`transformLayer` + `LayerTransformPreview`）で移動・拡縮・回転・反転をすべてカバーできる
- `dx`/`dy` の整数オフセットではなく mat3 行列で表現することで、将来の拡張（shear 等）にも対応可能
- クリップ検出（`detectTranslateClipping`）はライブラリに含めず、`getContentBounds` で取得した境界矩形を使えばアプリ側で判定可能

---

## Phase 1: API設計・ドキュメント

### 1-1. Engine: 新しい型 `TranslatePreview`

**`packages/engine/src/types.ts`**:

```typescript
/** レイヤー移動プレビュー（レンダリング時に渡す一時的状態） */
export interface TranslatePreview {
  readonly layerId: string;
  readonly dx: number;
  readonly dy: number;
}
```

`LayerMeta` は**変更しない**。プレビュー状態は一時的なUI状態であり、永続的なレイヤーメタデータに含めない。`PendingOverlay` と同じく、レンダリングパラメータとして明示的に渡す。

### 1-2. Engine: translate-layer.ts（新規）

**`packages/engine/src/translate-layer.ts`** — 3つの純粋関数:

```typescript
/** ピクセルデータを(dx,dy)だけ移動して焼き込む。はみ出しはクリップ。 */
export function translateLayer(
  layer: Layer,
  dx: number,
  dy: number,
  temp?: OffscreenCanvas,
): void;

/** (dx,dy)移動で非透明ピクセルがクリップされるか判定 */
export function detectTranslateClipping(
  layer: Layer,
  dx: number,
  dy: number,
): boolean;

export interface TranslateClipInfo {
  readonly willClip: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly top: boolean;
  readonly bottom: boolean;
}

/** 各辺ごとのクリップ詳細情報を返す */
export function getTranslateClipInfo(
  layer: Layer,
  dx: number,
  dy: number,
): TranslateClipInfo;
```

**実装方針**:
- `translateLayer`: wrapShiftLayerと同じtemp canvas パターン。`layer.ctx.drawImage(tempCanvas, dx, dy)` で1回描画（wrappingなし）
- `detectTranslateClipping` / `getTranslateClipInfo`: クリップ対象の辺ストリップに `getImageData` → alphaチャネルをスキャン（早期離脱）。100px×2048pxで~1-5ms

### 1-3. Engine: レンダリング変更

`TranslatePreview` を明示的パラメータとして受け取り、該当レイヤーの描画時にオフセットを適用。

**`packages/engine/src/render.ts`**:

`RenderOptions` に追加:
```typescript
export interface RenderOptions {
  background?: BackgroundSettings;
  pendingOverlay?: PendingOverlay;
  translatePreview?: TranslatePreview;  // NEW
}
```

`renderLayers` 内のループで、`layer.id === translatePreview?.layerId` の場合に `drawImage` の位置をずらす:

| 行 | パス | offset適用 |
|----|------|-----------|
| 96 | pre-composite: committed→workLayer | YES（layerId一致時） |
| 119 | pre-composite: workLayer→ctx | NO（workLayer内で適用済み） |
| 137 | flat: committed→ctx | YES（layerId一致時） |
| 156 | flat: pending→ctx | NO（pendingは移動しない） |

`renderLayerWithTransform` は単一レイヤー用なので `TranslatePreview` は受けない（呼び出し側で対応）。

**`packages/engine/src/incremental-render.ts`**:

`composeLayers` にオプショナルパラメータ追加:
```typescript
export function composeLayers(
  target: CanvasRenderingContext2D,
  layers: readonly Layer[],
  transform?: ViewTransform,
  pendingOverlay?: PendingOverlay,
  translatePreview?: TranslatePreview,  // NEW
): void;
```

同じパターンでoffset適用:
| 行 | パス | offset適用 |
|----|------|-----------|
| 133 | pre-composite: committed→workLayer | YES |
| 146 | pre-composite: workLayer→target | NO |
| 156 | flat: committed→target | YES |
| 159 | flat: pending→target | NO |

### 1-4. Stroke: コマンド型

**`packages/stroke/src/types.ts`**:

```typescript
export interface TranslateLayerCommand {
  readonly type: "translate-layer";
  readonly layerId: string;
  readonly dx: number;
  readonly dy: number;
  readonly timestamp: number;
}
```

分類: `LayerDrawCommand` に含める（layerIdあり、チェックポイント対象）:
```typescript
export type LayerDrawCommand = StrokeCommand | ClearCommand | TranslateLayerCommand;
```

`isDrawCommand`, `isLayerDrawCommand` に `"translate-layer"` を追加。

**影響範囲の自動的な整合**（history.ts の既存関数がそのまま動く）:
- `getCommandsToReplayForLayer`: `isLayerDrawCommand` でフィルタ → translate-layer が自動的に含まれる
- `getAffectedLayerIds`: 同上 → undo時に正しいレイヤーが rebuild される
- `pushCommand`: `isDrawCommand` チェック → チェックポイント作成対象になる

### 1-5. Stroke: ファクトリ・リプレイ

**`packages/stroke/src/session.ts`** — `createTranslateLayerCommand(layerId, dx, dy)`

**`packages/stroke/src/replay.ts`** — `replayCommand` に case 追加:
```typescript
case "translate-layer":
  translateLayer(layer, command.dx, command.dy);
  break;
```

### 1-6. React: usePaintEngine

**`packages/react/src/usePaintEngine.ts`** — PaintEngineResult に追加:

```typescript
// ── Layer Translate ──
readonly onTranslateStart: () => void;
readonly onTranslateMove: (dx: number, dy: number) => void;
readonly onTranslateConfirm: () => void;
readonly onTranslateCancel: () => void;
readonly translatePreview: TranslatePreview | undefined;
```

**内部実装**:
- `translateRef = useRef<{ layerId: string; dx: number; dy: number } | null>(null)`
- `onTranslateStart`: activeLayerIdをキャプチャ、ref初期化 `{ layerId, dx: 0, dy: 0 }`
- `onTranslateMove(dx, dy)`: refに増分を加算、bumpRenderVersion
- `onTranslateConfirm`: `translateLayer(layer, dx, dy, tempCanvas)` で焼き込み → `createTranslateLayerCommand` → `pushCommand(state, command, layer, config)` → ref を null に → bumpRenderVersion
- `onTranslateCancel`: ref を null に → bumpRenderVersion
- `translatePreview`: translateRef.current から構築して返す（renderOptionsに渡すため）
- **Undo/Redo**: 特別処理なし。既存の `else` ブランチ（rebuildLayerFromHistory）で処理される

`translatePreview` は `RenderOptions` / `composeLayers` に渡す用にアプリへ公開。アプリ側でクリップ判定も可能:
```typescript
// アプリ側のドラッグ終了ハンドラ
const preview = engine.translatePreview;
if (preview) {
  const layer = engine.activeEntry?.committedLayer;
  if (layer && detectTranslateClipping(layer, preview.dx, preview.dy)) {
    // 確認ダイアログ表示 → confirm or cancel
  } else {
    engine.onTranslateConfirm();
  }
}
```

### 1-7. React: usePointerHandler

**`packages/react/src/usePointerHandler.ts`**:

`ToolType` に `"translate"` を追加:
```typescript
export type ToolType = "pen" | "eraser" | "scroll" | "rotate" | "zoom" | "offset" | "translate";
```

UsePointerHandlerOptions に追加:
```typescript
readonly onTranslateMove?: (dx: number, dy: number) => void;
readonly onTranslateEnd?: () => void;
```

`"translate"` case: `"offset"` と同じ座標変換ロジック（screenToLayer + 整数丸め + 小数蓄積）で `onTranslateMove` を増分で呼ぶ。ポインタアップ時に `onTranslateEnd()` を呼ぶ（引数なし = 確定判断はアプリ側）。

### 1-8. React: persistence.ts

- `isToolType`: `"translate"` を追加

`cloneLayerMeta` と `isLayerMeta` は変更不要（`LayerMeta` を変更しないため）。

---

## Phase 2: 利用イメージレビュー

### A. Engine単体（ヘッドレス）

```typescript
import {
  createLayer, translateLayer,
  detectTranslateClipping, getTranslateClipInfo,
} from "@headless-paint/engine";

const layer = createLayer(2048, 2048);
// ... 描画 ...

const clipInfo = getTranslateClipInfo(layer, 100, -50);
if (clipInfo.willClip) {
  console.warn(`クリップ: left=${clipInfo.left}, right=${clipInfo.right}`);
}
translateLayer(layer, 100, -50);
```

### B. レンダリング（プレビュー）

```typescript
import { renderLayers } from "@headless-paint/engine";

// translatePreview は usePaintEngine から取得
renderLayers(layers, ctx, transform, {
  pendingOverlay,
  translatePreview: engine.translatePreview,
});
```

### C. アプリ側フロー

```typescript
// 1. ユーザーがtranslateツールを選択してドラッグ開始
//    usePointerHandler が onTranslateMove を増分で呼ぶ
//    usePaintEngine が内部で累積し translatePreview を更新

// 2. ドラッグ終了 → onTranslateEnd() が呼ばれる
const handleTranslateEnd = () => {
  const preview = engine.translatePreview;
  if (!preview || (preview.dx === 0 && preview.dy === 0)) {
    engine.onTranslateCancel();
    return;
  }
  const layer = engine.activeEntry?.committedLayer;
  if (layer && detectTranslateClipping(layer, preview.dx, preview.dy)) {
    showConfirmDialog();  // UIで確認 → confirm or cancel
  } else {
    engine.onTranslateConfirm();  // クリップなしなら即確定
  }
};
```

### D. Undo/Redo

```typescript
engine.undo();  // rebuildLayerFromHistory でクリップ前の状態を完全復元
engine.redo();  // replayCommand で translateLayer を再適用
```

---

## Phase 3: 実装

### Step 1: Engine — 型と関数

1. `packages/engine/src/types.ts` — `TranslatePreview` 型を追加（`LayerMeta` は変更なし）
2. `packages/engine/src/translate-layer.ts` — 新規作成: translateLayer, detectTranslateClipping, getTranslateClipInfo
3. `packages/engine/src/translate-layer.test.ts` — テスト:
   - dx=0,dy=0 → no-op
   - 右シフト: ピクセル移動確認
   - 下シフト: ピクセル移動確認
   - はみ出しクリップ確認（端のピクセルが消える）
   - 新規領域が透明であること
   - クリップ判定: 非透明ピクセルありの辺 → true
   - クリップ判定: 透明のみの辺 → false
   - 各辺フラグの正確性
   - temp canvas 再利用
4. `packages/engine/src/index.ts` — export 追加

### Step 2: Engine — レンダリング変更

5. `packages/engine/src/render.ts` — `RenderOptions` に `translatePreview` 追加、renderLayers の drawImage にオフセット適用
6. `packages/engine/src/incremental-render.ts` — composeLayers にパラメータ追加、drawImage にオフセット適用
7. テスト追加: translatePreview 付きで正しい位置に描画されること

### Step 3: Stroke — コマンド・リプレイ

8. `packages/stroke/src/types.ts` — TranslateLayerCommand、union更新、type guard更新
9. `packages/stroke/src/session.ts` — createTranslateLayerCommand
10. `packages/stroke/src/replay.ts` — replayCommand に translate-layer case 追加
11. `packages/stroke/src/types.test.ts` — type guard テスト追加
12. `packages/stroke/src/index.ts` — export 追加

### Step 4: React — フック統合

13. `packages/react/src/usePaintEngine.ts` — translateRef, callbacks, translatePreview 公開, PaintEngineResult 拡張
14. `packages/react/src/usePointerHandler.ts` — `"translate"` ToolType 追加, onTranslateMove/onTranslateEnd コールバック
15. `packages/react/src/persistence.ts` — isToolType に "translate" 追加
16. `packages/react/src/index.ts` — re-export 追加

### Step 5: ドキュメント

17. `packages/engine/docs/` — types.md, README.md, 新規 translate-api.md
18. `packages/stroke/docs/` — types.md, session-api.md, README.md
19. `packages/react/docs/` — README.md

---

## Phase 4: 検証

### テスト実行
```bash
pnpm test      # 全テスト（既存 + 新規）
pnpm lint      # Biome lint
pnpm format    # Biome format
```

### 確認項目
- [ ] translateLayer のピクセル移動が正しい
- [ ] クリップ判定が正確（各辺独立）
- [ ] renderLayers で translatePreview が反映される
- [ ] composeLayers で translatePreview が反映される
- [ ] pre-composition パス（opacity<1, blend mode）でオフセットが正しい
- [ ] pendingLayer にはオフセットが適用されない
- [ ] TranslateLayerCommand が正しく履歴に追加される
- [ ] replayCommand で translate が正しくリプレイされる
- [ ] Undo（rebuild）でクリップ前の状態が完全に復元される
- [ ] LayerMeta に変更がないこと（persistence への影響ゼロ）
- [ ] 既存テストが全て pass する

### セルフレビュー（review-library-usage）
- パッケージAPIの活用漏れがないか
- 既存パターン（wrap-shift）との一貫性
- ドキュメントとの整合性
