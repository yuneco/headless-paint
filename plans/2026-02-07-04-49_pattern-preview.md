# パターンプレビュー機能

## Context

レイヤーの外側（UI背景色の薄いグレー領域）にレイヤー内容をパターンとして半透明描画する機能を追加する。パターンエディタとしてレイヤーを使う際のプレビュー機能。

パターンの種類: なし（現行）・グリッド・ライン縦・ライン横。グリッドはxy平面全体を敷き詰め、ラインは縦or横のみの繰り返し。グリッドの場合はx or yオフセット（%指定）で格子ずらしが可能。

## 設計方針

### 配置: engine内の独立モジュール

`packages/engine/src/pattern-preview.ts` に型・関数を全て集約。既存APIに変更なし。非パターンユースケースではインポート不要でノイズにならない。

### パフォーマンス: Canvas2D `createPattern()` + `setTransform()`

- `createPattern()` によるタイリングはブラウザのGPU描画に委譲される
- オフセットグリッドは2倍サイズのメタタイルを生成し `"repeat"` で敷き詰め
- タイル生成と描画を分離したAPIにより、アプリ側でタイルキャッシュ可能（初期実装ではキャッシュなし）

### 描画順序

```
1. viewport全体をUI背景色(#f0f0f0)で塗りつぶし
2. パターンプレビューをレイヤー領域外に半透明描画  ← NEW
3. renderLayers: レイヤー領域に背景色+レイヤー描画
4. レイヤー境界線を描画
```

### レイヤー領域の除外（クリップパス）

`renderPatternPreview` 内で evenodd クリップパスを使い、パターンをレイヤー領域外のみに描画する。回転時も四隅を個別変換するため正しく動作する。

### DPR対応

`renderPatternPreview` は `pattern.setTransform()` を使用し、これは `ctx` の既存 `scale(dpr, dpr)` と合成される。そのため関数にはオリジナルの `transform`（DPR未調整）とCSS pixel単位のviewport寸法を渡す。

## 影響ファイルと変更内容

### packages/engine

| ファイル | 変更 |
|---|---|
| 新規: src/pattern-preview.ts | 型定義 + createPatternTile + renderPatternPreview |
| src/index.ts | 新型・関数エクスポート追加 |
| 新規: docs/pattern-preview-api.md | APIドキュメント |
| docs/README.md | Pattern Previewへのリンク追加 |

### apps/web

| ファイル | 変更 |
|---|---|
| 新規: src/hooks/usePatternPreview.ts | パターン設定state管理フック |
| src/components/PaintCanvas.tsx | patternPreview prop追加、描画統合 |
| src/components/DebugPanel.tsx | Pattern Previewフォルダ追加 |
| src/App.tsx | usePatternPreview接続 |

### 変更なし

packages/input, packages/stroke, 既存の engine types.ts / render.ts / layer.ts / draw.ts

## 外部仕様

### 型

```typescript
type PatternMode = "none" | "grid" | "repeat-x" | "repeat-y";

interface PatternPreviewConfig {
  readonly mode: PatternMode;
  readonly opacity: number;     // 0.0 - 1.0
  readonly offsetX: number;     // 0.0 - 1.0, gridのみ有効
  readonly offsetY: number;     // 0.0 - 1.0, gridのみ有効
}
```

### API

```typescript
function createPatternTile(layers: readonly Layer[], config: PatternPreviewConfig): OffscreenCanvas | null;
function renderPatternPreview(ctx, tile, config, transform, viewportWidth, viewportHeight, layerWidth, layerHeight): void;
```

詳細は `packages/engine/docs/pattern-preview-api.md` を参照。

## 実装結果

- 全88テスト通過、lint/build OK
- 既存APIへの変更なし、engineの独立モジュールとしてパッケージ責務分離を維持

## 実装時の調整内容（補足）

- `offsetX`/`offsetY` の排他制御: 計画では「UIで排他制御」としていたが、hook側（`setOffsetX` 時に `offsetY` を0にリセット、逆も同様）で実装。より安全な設計。ドキュメントも「アプリ側のsetter等で排他制御」に修正済み。
