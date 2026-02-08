# App コード複雑さの調査レポート

## 概要

apps/web の App.tsx とその hooks/components を分析し、ライブラリ側に移譲可能な処理を抽出・整理した。
ライブラリとしての基本的な責務・立ち位置は変更せず、確実に移せるものを厳選する方針。

## 複雑さの源泉

| 源泉 | 場所 | 行数(概算) | 性質 |
|-------|------|-----------|------|
| DPR・座標系の橋渡し | PaintCanvas:70-101, useViewTransform:50-65 | ~40行 | 純粋計算、全クライアント共通 |
| ストロークライフサイクル | App.tsx:169-323 | ~155行 | 3パッケージ横断の統合コード |
| Undo/Redo オーケストレーション | App.tsx:427-582 | ~155行 | History×Layer状態の同期 |

## A. ライブラリ本体に移せるもの (最優先)

確実に移せるのは **純粋関数で、フレームワーク非依存、全クライアント共通** なもの。厳選すると2つ。

### 1. `fitToView` → `@headless-paint/input`

useViewTransform.ts:50-65 の `setInitialFit` に埋まっているロジック:

```typescript
function fitToView(
  viewW: number, viewH: number,
  layerW: number, layerH: number,
): ViewTransform
```

レイヤーをビューポートにフィットさせるViewTransformを返す。pan/zoom/rotateと同列の変換操作。全クライアントが初期表示やリセット時に必要とする。

### 2. `applyDpr` → `@headless-paint/input`

PaintCanvas.tsx:95-101 にインラインで書かれているDPRスケーリング:

```typescript
function applyDpr(transform: ViewTransform, dpr: number): ViewTransform
```

ViewTransformにDevice Pixel Ratioを適用した新しい行列を返す。Canvas APIで実際に描画するときは必ずこの変換が必要。現状クライアントが行列の各要素を手動で `*= dpr` している部分を置き換える。

これら2つは `@headless-paint/input` の transform.ts に自然に追加できる。

## B. ファサード/ユーティリティ層の候補 (中間層)

ライブラリ本体に入れるには統合度が高すぎるが、全クライアント共通のパターン。

### 1. ストロークオーケストレーター

App.tsx:169-323 の `onStrokeStart/Move/End` は3パッケージ(input + engine + stroke)を横断する固定パターン:

```
FilterPipeline → StrokeSession → appendToCommitted/renderPending → Command作成 → History push
```

フレームワーク非依存のステートマシンとして切り出せる可能性がある。ただし mutable な Layer への書き込みと history state の更新を含むため、API設計は要検討。

### 2. Undo/Redo エグゼキューター

App.tsx:427-582 の handleUndo/handleRedo は最も複雑で最もミスしやすい箇所。コマンドの型ごとに異なるリバート操作が必要:

- `wrap-shift`: 全レイヤーに逆シフト
- `add-layer` / `remove-layer` / `reorder-layer`: レイヤー構造の復元
- `stroke` / `clear`: 影響レイヤーのリビルド

「HistoryState + レイヤーへの副作用」のセットは全クライアント共通。ただし現状のレイヤー管理は useLayers (React state) に結合しているため、フレームワーク非依存で切り出すにはレイヤーコレクションへのアクセスインターフェースが必要。

### 3. レイヤー構造コマンドの統合ヘルパー

App.tsx:360-420 で `addLayer` → `createAddLayerCommand` → `pushCommand` を毎回3ステップ書いている。stroke パッケージの session.ts にヘルパーを追加することで簡略化できるかもしれないが、レイヤー実体の生成と履歴の管理の責務境界が曖昧になるリスクもある。

## C. React パッケージ候補 (`@headless-paint/react` 等)

現状の hooks の多くは、ライブラリの state を React state に橋渡ししているだけ。

| hook | 性質 | 移行価値 |
|------|------|---------|
| `useViewTransform` | input の transform 関数の React ラッパー | 高 |
| `useLayers` | engine の Layer を React state で管理 | 高 |
| `usePointerHandler` | PointerEvent → InputPoint 変換 + sampling | 高 |
| `usePenSettings` | StrokeStyle の React state 管理 | 中 |
| `useSmoothing` | FilterPipeline の React state 管理 | 中 |
| `useExpand` | ExpandConfig の React state 管理 | 中 |
| `useKeyboardShortcuts` | ペイントツール用キーバインド | 低 (アプリ固有度高) |

特に `useViewTransform` + `usePointerHandler` + `useLayers` の3つは、ペイントアプリを作る人がほぼ確実に必要とするもの。

## 推奨アクション

| 優先度 | アクション | 効果 |
|--------|-----------|------|
| **今すぐ** | `fitToView` + `applyDpr` を input に追加 | 全クライアントの定型コード削減 |
| **本体安定後** | Undo/Redo エグゼキューターの設計検討 | 最も複雑な統合コードの移譲 |
| **本体安定後** | `@headless-paint/react` の検討 | hooks の再利用性向上 |
