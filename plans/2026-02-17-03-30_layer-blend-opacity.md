# レイヤー合成モード・不透明度の設定追加

## Context

レイヤーパネルで選択レイヤーのブレンドモードと不透明度を変更できるようにした。

**既存インフラ**: `LayerMeta` に `opacity: number` と `compositeOperation?: GlobalCompositeOperation` が既にあり、描画エンジンで反映済み。足りなかったのは状態操作関数、プレ合成、UI。

**課題**: committed + pending をフラットに合成すると、ブレンドモード・不透明度・消しゴムで描画が不正確になる（重なり領域で二重適用）。→ プレ合成で解決。

## 設計方針

### プレ合成アーキテクチャ

フラット合成 `target ← committed (multiply, 50%) ← pending (multiply, 50%)` では committed と pending の空間的重なりでブレンドが二重適用される。消しゴム（destination-out）が全レイヤーに影響する潜在的バグもあった。

解決策としてエンジンの `renderLayers`/`composeLayers` を拡張し、プレ合成をエンジン内部で処理:

```
workLayer ← committed  (source-over, alpha=1)
workLayer ← pending    (pending.meta.compositeOperation)  ← ストロークレベル（ペン/消しゴム）
target    ← workLayer  (committed.meta.compositeOperation, committed.meta.opacity)  ← レイヤーレベル
```

### 最適化: プレ合成スキップ

全条件が「通常」のときはプレ合成をスキップ（フラット合成で結果同一）:
- layer opacity === 1 AND
- layer compositeOperation が normal (undefined or "source-over") AND
- pending compositeOperation が normal (undefined or "source-over")

→ デフォルトの通常ペン描画ではコストゼロ。消しゴム・ブレンドモード・不透明度変更時のみプレ合成。

### 設計上のトレードオフ

| 判断 | 選択 | 理由 |
|------|------|------|
| プレ合成の実行場所 | エンジン内部（renderLayers/composeLayers） | アプリ側に合成ロジックを持たせない |
| workLayer の確保 | usePaintEngine で useMemo | レンダリングループ毎の確保を避ける |
| layers 配列の構成 | committed のみ + PendingOverlay 分離 | フラット挿入方式はプレ合成と相性が悪い |
| 履歴記録 | opacity/blendMode 変更は記録しない | visibility/name と同じ扱い |

## Canvas 2D ブレンドモード一覧（UI選択肢）

| 値 | ラベル |
|---|---|
| `undefined` (= source-over) | Normal |
| `multiply` | Multiply |
| `screen` | Screen |
| `overlay` | Overlay |
| `darken` | Darken |
| `lighten` | Lighten |
| `color-dodge` | Color Dodge |
| `color-burn` | Color Burn |
| `hard-light` | Hard Light |
| `soft-light` | Soft Light |
| `difference` | Difference |
| `exclusion` | Exclusion |
| `hue` | Hue |
| `saturation` | Saturation |
| `color` | Color |
| `luminosity` | Luminosity |

## 実装結果

### 進捗

| Phase | 内容 | 状態 |
|-------|------|------|
| Phase 1 | API設計・ドキュメント作成 + 実装 | **完了** |
| Phase 2 | ドキュメント更新 | **完了** |
| Phase 3 | テスト | **完了** |

### 新規型

- `PendingOverlay` — pending レイヤーのプレ合成情報（`layer`, `targetLayerId`, `workLayer`）

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `packages/engine/src/types.ts` | `PendingOverlay` インターフェース追加 |
| `packages/engine/src/render.ts` | `RenderOptions.pendingOverlay` 追加、`renderLayers` にプレ合成ロジック |
| `packages/engine/src/incremental-render.ts` | `composeLayers` に第4引数 `pendingOverlay` + プレ合成ロジック |
| `packages/engine/src/index.ts` | `PendingOverlay` エクスポート |
| `packages/react/src/useLayers.ts` | `setLayerOpacity`, `setLayerBlendMode` 操作関数追加 |
| `packages/react/src/usePaintEngine.ts` | layers を committed のみに変更、`pendingOverlay`/`workLayer` 構築、新関数公開 |
| `packages/react/src/index.ts` | `PendingOverlay` re-export |
| `apps/web/src/components/PaintCanvas.tsx` | `pendingOverlay` prop 追加、`renderLayers` に渡す |
| `apps/web/src/components/LayerPanel.tsx` | ブレンドモード `<select>` + 不透明度 `<input type="range">` UI |
| `apps/web/src/components/SidebarPanel.tsx` | `onSetOpacity`, `onSetBlendMode` props 中継 |
| `apps/web/src/App.tsx` | engine → SidebarPanel/PaintCanvas への接続 |

### ドキュメント更新

| ファイル | 変更内容 |
|---------|---------|
| `packages/engine/docs/types.md` | `PendingOverlay` 型定義・プレ合成条件・使用例 |
| `packages/engine/docs/render-api.md` | `RenderOptions.pendingOverlay`、`renderLayers` 処理内容更新 |
| `packages/engine/docs/incremental-render-api.md` | `composeLayers` シグネチャ・動作説明更新 |
| `packages/react/docs/README.md` | `UseLayersResult`, `PaintEngineResult` に新関数・プロパティ、re-export テーブル |

### テスト

`packages/engine/src/incremental-render.test.ts` に4テスト追加:
- プレ合成: opacity < 1 で二重適用が起きないことを検証
- プレ合成: 消しゴム（destination-out）が対象レイヤー内のみ影響
- スキップ条件: 全設定が通常時はフラット合成と同一結果
- ブレンドモード: multiply 設定時にエラーなく描画

### 変更しなかったもの

- **`LayerMeta` 型**: 既に `opacity` / `compositeOperation` が揃っていた
- **`useStrokeSession`**: pending layer の stroke-level compositeOperation 管理はそのまま
- **`renderPendingLayer`**: pending レイヤーの描画ロジックはそのまま
- **履歴/Undo**: メタ変更は visibility/name 同様、履歴に記録しない
- **永続化**: `persistence.ts` の `cloneLayerMeta` は既に compositeOperation を処理済み
- **Minimap**: committed のみ表示する用途のため pendingOverlay 不要

## 検証

- 全パッケージビルド成功
- 全270テスト通過
- 変更ファイルにlintエラーなし
