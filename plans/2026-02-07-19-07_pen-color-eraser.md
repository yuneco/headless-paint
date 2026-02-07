# ペンの色設定と消しゴムツールの追加

## Context

現在のペイントアプリは色がハードコード（`{r:50, g:50, b:50, a:255}`）されており、消しゴム機能もない。ユーザーが色を選んで描画し、消しゴムで消せるようにする。

**設計方針（ユーザー決定済み）:**
- 消しゴムモード: `compositeOperation?: GlobalCompositeOperation` を `StrokeStyle` に追加
- 線幅: ペンと消しゴムで共有
- カラーピッカー: ツールバー内に配置

## 変更対象ファイル

### Engine パッケージ
- [types.ts](packages/engine/src/types.ts) — `StrokeStyle` に `compositeOperation` 追加、`LayerMeta` に `compositeOperation` 追加
- [draw.ts](packages/engine/src/draw.ts) — `drawVariableWidthPath` で `compositeOperation` 適用
- [incremental-render.ts](packages/engine/src/incremental-render.ts) — committed: パススルー、pending: 常に `source-over`、`composeLayers` で `layer.meta.compositeOperation` 適用
- [render.ts](packages/engine/src/render.ts) — `renderLayers` で `layer.meta.compositeOperation` 適用

### Stroke パッケージ
- [types.ts](packages/stroke/src/types.ts) — `StrokeCommand` に `compositeOperation` 追加
- [session.ts](packages/stroke/src/session.ts) — `endStrokeSession`/`createStrokeCommand` で `compositeOperation` を保持
- [replay.ts](packages/stroke/src/replay.ts) — リプレイ時に `compositeOperation` を渡す

### Web アプリ
- [usePenSettings.ts](apps/web/src/hooks/usePenSettings.ts) — `color`/`eraser` state 追加
- [usePointerHandler.ts](apps/web/src/hooks/usePointerHandler.ts) — `"eraser"` を `ToolType` に追加
- [Toolbar.tsx](apps/web/src/components/Toolbar.tsx) — 消しゴムボタン＋カラーピッカー追加
- [App.tsx](apps/web/src/App.tsx) — ツール切替時の eraser 連携、color/onColorChange の配線
- [PaintCanvas.tsx](apps/web/src/components/PaintCanvas.tsx) — eraser 時のカーソル設定
- [HistoryContent.tsx](apps/web/src/components/HistoryContent.tsx) — 消しゴムストロークのラベル区別

### ドキュメント
- [packages/engine/docs/types.md](packages/engine/docs/types.md) — `StrokeStyle.compositeOperation`、`LayerMeta.compositeOperation` 追加
- [packages/engine/docs/draw-api.md](packages/engine/docs/draw-api.md) — `drawVariableWidthPath` シグネチャ更新
- [packages/engine/docs/incremental-render-api.md](packages/engine/docs/incremental-render-api.md) — committed/pending の compositeOperation 使い分けの説明
- [packages/engine/docs/render-api.md](packages/engine/docs/render-api.md) — `renderLayers` での `compositeOperation` 適用
- [packages/stroke/docs/types.md](packages/stroke/docs/types.md) — `StrokeCommand.compositeOperation` 追加
- [packages/stroke/docs/session-api.md](packages/stroke/docs/session-api.md) — 関数シグネチャ更新

## 作業手順

### Phase 1: API設計・ドキュメント

#### 1-1. Engine: `StrokeStyle` に `compositeOperation` 追加

```typescript
// packages/engine/src/types.ts
export interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity?: number;
  readonly pressureCurve?: PressureCurve;
  readonly compositeOperation?: GlobalCompositeOperation;  // NEW
}
```

デフォルト（`undefined`）は Canvas の既定値 `"source-over"`。消しゴムは `"destination-out"`。

#### 1-2. Engine: `LayerMeta` に `compositeOperation` 追加

```typescript
// packages/engine/src/types.ts
export interface LayerMeta {
  name: string;
  visible: boolean;
  opacity: number;
  compositeOperation?: GlobalCompositeOperation;  // NEW
}
```

レイヤー合成時の合成モード。pending レイヤーの消しゴムプレビューに使用。

#### 1-3. Engine: `drawVariableWidthPath` にパラメータ追加

```typescript
// packages/engine/src/draw.ts
export function drawVariableWidthPath(
  layer: Layer,
  points: readonly StrokePoint[],
  color: Color,
  baseLineWidth: number,
  pressureSensitivity: number,
  pressureCurve?: PressureCurve,
  compositeOperation?: GlobalCompositeOperation,  // NEW
): void
```

関数内で `ctx.globalCompositeOperation` を設定・復元する（`ctx.save()/restore()` は使わず手動管理、既存パターンに合わせる）。

#### 1-4. Engine: `renderLayers` / `composeLayers` で `LayerMeta.compositeOperation` を適用

```typescript
// render.ts renderLayers 内
ctx.globalAlpha = layer.meta.opacity;
if (layer.meta.compositeOperation) {
  ctx.globalCompositeOperation = layer.meta.compositeOperation;
}
ctx.drawImage(layer.canvas, 0, 0);
ctx.restore();  // restore で元に戻る
```

`composeLayers` も同様。

#### 1-5. Engine: committed vs pending の `compositeOperation` 使い分け

**重要な設計ポイント:**
- `appendToCommittedLayer`: `style.compositeOperation` を `drawVariableWidthPath` に渡す（committed レイヤーの既存ピクセルを消去）
- `renderPendingLayer`: `compositeOperation` を渡さない（常に `source-over`）。消しゴムプレビューは `LayerMeta.compositeOperation` による合成時に実現。空レイヤーへの `destination-out` は不可視になるため。

#### 1-6. Stroke: `StrokeCommand` に `compositeOperation` 追加

```typescript
// packages/stroke/src/types.ts
export interface StrokeCommand {
  // ...既存フィールド...
  readonly compositeOperation?: GlobalCompositeOperation;  // NEW
  readonly timestamp: number;
}
```

#### 1-7. Stroke: `createStrokeCommand` / `endStrokeSession` 更新

両関数に `compositeOperation` パラメータを追加。`endStrokeSession` は `state.style.compositeOperation` から取得。

#### 1-8. ドキュメント更新

上記API変更を対応するドキュメントに反映。

### Phase 2: 利用イメージレビュー（承認後に実装へ）

### Phase 3: 実装

ボトムアップ順で、各ステップでコンパイルが通る状態を維持。

#### 3-1. Engine 型変更
- `types.ts`:
  - `StrokeStyle` に `compositeOperation?: GlobalCompositeOperation` 追加
  - `LayerMeta` に `compositeOperation?: GlobalCompositeOperation` 追加

#### 3-2. Engine 描画変更
- `draw.ts`: `drawVariableWidthPath` で `compositeOperation` を受け取り、描画前に設定・描画後に復元
  ```typescript
  const prevOp = ctx.globalCompositeOperation;
  if (compositeOperation) ctx.globalCompositeOperation = compositeOperation;
  // ...描画処理...
  if (compositeOperation) ctx.globalCompositeOperation = prevOp;
  ```

#### 3-3. Engine レンダリング更新
- `incremental-render.ts`:
  - `appendToCommittedLayer`: `drawVariableWidthPath` に `style.compositeOperation` を追加（消しゴムは committed に直接消去）
  - `renderPendingLayer`: `compositeOperation` は渡さない（常に `source-over` で描画。プレビューは合成時に処理）
  - `composeLayers`: `layer.meta.compositeOperation` を設定してから `drawImage`
- `render.ts`:
  - `renderLayers`: `layer.meta.compositeOperation` を設定してから `drawImage`

#### 3-4. Stroke 型変更
- `types.ts`: `StrokeCommand` に `compositeOperation` 追加

#### 3-5. Stroke セッション/コマンド更新
- `session.ts`:
  - `endStrokeSession`: 返却オブジェクトに `compositeOperation: state.style.compositeOperation` 追加
  - `createStrokeCommand`: パラメータに `compositeOperation` 追加

#### 3-6. Stroke リプレイ更新
- `replay.ts`: `replayStrokeCommand` で `command.compositeOperation` を `drawVariableWidthPath` に渡す

#### 3-7. Web: ToolType 更新
- `usePointerHandler.ts`:
  - `ToolType` に `"eraser"` 追加
  - `"pen"` の条件を `"pen" || "eraser"` に変更（描画フローは同一）

#### 3-8. Web: usePenSettings 拡張
- `color` state 追加（初期値: `DEFAULT_PEN_COLOR`）
- `eraser` state 追加（初期値: `false`）
- `strokeStyle` の `color` をハードコードから state に変更
- `strokeStyle` に `compositeOperation: eraser ? "destination-out" : undefined` 追加
- `setColor`, `setEraser` ハンドラ追加

#### 3-9. Web: Toolbar に消しゴム＋カラーピッカー追加
- `tools` 配列に `{ type: "eraser", label: "Eraser", icon: "🧹" }` を pen の次に追加
- `ToolbarProps` に `color`, `onColorChange` 追加
- `colorToHex` / `hexToColor` ヘルパー（ローカル関数）
- `<input type="color">` をペンツールボタン群の後に配置

#### 3-10. Web: App.tsx 配線
- `handleToolChange` を作成: `setTool` + `penSettings.setEraser(newTool === "eraser")`
- `Toolbar` に `color={penSettings.color}`, `onColorChange={penSettings.setColor}` を渡す
- `onStrokeEnd` の `createStrokeCommand` 呼び出しに `strokeStyle.compositeOperation` を追加
- `onStrokeStart` で `pendingLayer.meta.compositeOperation = strokeStyle.compositeOperation` を設定
- `onStrokeEnd` で `pendingLayer.meta.compositeOperation = undefined` にリセット

#### 3-11. Web: PaintCanvas カーソル
- `tool === "eraser"` 時のカーソルを `"crosshair"` に設定

#### 3-12. Web: HistoryContent ラベル更新
- `getCommandLabel` で `command.compositeOperation === "destination-out"` なら `Eraser (N pts)` と表示

### Phase 4: アーキテクトレビュー（セルフレビュー）

`review-library-usage` スキルでセルフレビューを実施。

## 既知の制約・トレードオフ

**カラーピッカーのアルファ**: ネイティブ `<input type="color">` はアルファ非対応。`a: 255` 固定で変換。

## テスト・検証

- `pnpm test` で既存テスト通過確認
- `pnpm lint` で lint チェック
- 手動テスト:
  1. カラーピッカーで色を変更して描画 → 選択色で描画されること
  2. 消しゴムに切り替えて描画 → ストロークが消えること
  3. Undo → 消しゴムストロークが取り消され、消された部分が復元されること
  4. Redo → 消しゴムストロークが再適用されること
  5. 色変更後に Undo/Redo → 各ストロークが元の色で正しく再描画されること
  6. 履歴パネルで "Eraser" ラベルが正しく表示されること
