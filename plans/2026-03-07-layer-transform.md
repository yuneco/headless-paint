# レイヤー変換（Layer Transform）機能

## Context

レイヤーの移動・リサイズを実現する機能。当初の translate-only 計画を汎用アフィン変換アプローチに置き換えた。
移動・リサイズ・反転・回転はすべて mat3 で表現でき、1つの API で全カバーできる。

**設計方針**:
- ライブラリ（engine/stroke/react）はヘッドレス。UI なし
- ライブラリは「正しい z-order でのプレビュー描画」と「ピクセル焼き込み」を提供
- デモアプリ（apps/web）が DOM ベースの変換 UI（ハンドル・確定/キャンセル）を実装
- `composeLayers`（incremental-render.ts）はアプリ未使用のため変更対象外
- **TODO（別作業）**: `composeLayers` は `renderLayers` に機能的に置き換えられており、アプリで未使用。本作業とは別に廃止を検討する

---

## API 設計

### Engine: 型定義

| 型 | 概要 |
|---|---|
| `ContentBounds` | レイヤー内容の非透明ピクセル境界矩形（`x`, `y`, `width`, `height`） |
| `LayerTransformPreview` | 一時的レンダリング状態。`layerId` と `matrix: Float32Array`（gl-matrix `mat3` 互換） |

### Engine: 関数

| 関数 | 概要 | 詳細 |
|---|---|---|
| `getContentBounds(layer)` | 非透明ピクセルの境界矩形を返す。空レイヤーは `null` | Uint32Array + 4辺収束スキャンで最適化 |
| `transformLayer(layer, matrix, temp?)` | アフィン変換をピクセルに焼き込む | temp canvas にコピー → clear → setTransform で drawImage |

→ 詳細: `packages/engine/docs/transform-api.md`

### Engine: レンダリング

`RenderOptions` に `layerTransformPreview` を追加。`renderLayers` 内で対象レイヤーのビュー変換にローカル変換を合成。

| パス | 適用 |
|---|---|
| pre-composite: committed → workLayer | YES（ローカル変換を直接適用） |
| pre-composite: workLayer → ctx | NO（workLayer 内で適用済み） |
| flat: committed → ctx | YES |
| flat: pending → ctx | YES（pending も同レイヤーなので一緒に移動） |

→ 詳細: `packages/engine/docs/render-api.md`

### Stroke: コマンド

| 型 / 関数 | 概要 |
|---|---|
| `TransformLayerCommand` | `type: "transform-layer"`, `layerId`, `matrix: readonly number[]` |
| `createTransformLayerCommand(layerId, matrix)` | ファクトリ関数 |

`LayerDrawCommand` union に追加。`isDrawCommand` / `isLayerDrawCommand` の type guard も対応。
`replayCommand` で `transformLayer` を呼び出し、undo/redo は既存のチェックポイント + リプレイで処理。

→ 詳細: `packages/stroke/docs/types.md`, `packages/stroke/docs/session-api.md`

### React: usePaintEngine

`commitTransform(layerId, matrix)` を追加。`handleWrapShiftEnd` と同じパターンで焼き込み + 履歴追加 + 再描画をカプセル化。

### デモアプリ

- `useTransformMode` フック: 変換状態管理。`start` / `updateMatrix` / `confirm` / `cancel` / `preview`
- `TransformOverlay` コンポーネント: SymmetryOverlay パターンに従った DOM オーバーレイ
  - SVG 点線矩形 + 4隅リサイズハンドル + 確定/キャンセルボタン
  - 移動: `mat3.fromTranslation`、リサイズ: アンカー基準の scale
  - pointer capture でドラッグ追跡
- `App.tsx`: `isTransformLocked` でキャンバス操作を無効化

---

## 実装時の調整内容（補足）

### 1. `mat3` → `Float32Array`

公開 API（`LayerTransformPreview.matrix`, `createTransformLayerCommand`）で gl-matrix の `mat3` 型エイリアスではなく `Float32Array` を採用。互換性に問題なく、消費者が gl-matrix に依存しなくて済む。

### 2. `bumpRenderVersion` 依存の除去

`useTransformMode` は `bumpRenderVersion` を受け取らない。`useState` の更新が React の再レンダーをトリガーし、`layerTransformPreview` prop 変更で `PaintCanvas` が再描画されるため不要。

### 3. `gl-matrix` を `apps/web` に追加

`useTransformMode` と `TransformOverlay` で `mat3` / `vec2` を使用するため依存追加。

### 4. render テスト省略

`renderLayers` は OffscreenCanvas + CanvasRenderingContext2D に依存しており、ピクセル検証が複雑なため省略。デモアプリでの動作確認で代替。

### 5. `detectTransformClipping` の削除

計画時に含めていたが、`getContentBounds` で取得した境界矩形を使えばアプリ側で容易に判定できるため、ライブラリに含める必要なしと判断し削除。

---

## 検証

### 確認済み項目
- `getContentBounds`: 空/非空レイヤーの判定
- `transformLayer`: translation, scale のピクセル移動
- `renderLayers`: `layerTransformPreview` の z-order 反映（pre-composite / flat 両パス）
- `TransformLayerCommand`: type guard, replay, undo/redo
- `commitTransform`: 焼き込み + 履歴追加 + 再描画
- デモアプリ: 変換モード中のロックアウト、ドラッグ移動/リサイズ、確定/キャンセル、空レイヤー警告
- 既存テスト全 pass（`pattern-preview` の1件は既存の問題）
- lint / build 全 pass
- ドキュメント ↔ 実装の整合性確認済み

### 既知の制限（デモアプリ）
- トランスフォーム中の Undo / レイヤー削除は完全にはブロックしていない
- ライブラリ側は安全（`commitTransform` は対象レイヤー不在時に早期 return、`renderLayers` は不在の preview を無視）
- 最悪のケースでも「変換が静かに捨てられる」だけで、データ破壊やクラッシュは起きない
