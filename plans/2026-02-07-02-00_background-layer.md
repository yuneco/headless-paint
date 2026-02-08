# 背景レイヤー機能の追加

## 要件

- レイヤー領域に背景色を設定できる機能を追加
- 背景はピクセルを持たない（色と visible のみ）
- デモアプリでは白背景をデフォルトに
- 将来レイヤーパネルで表示/非表示・色変更可能にする想定

---

## 設計方針

**オプション3.5: ハイブリッドアプローチ** を採用

既存の `Layer` 構造は変更せず、新しい `BackgroundSettings` 型で背景を管理する。

### 選定理由

1. **シンプル**: 既存コードへの影響が最小限
2. **効率的**: ピクセルデータを持たないのでメモリ消費なし
3. **拡張性**: 将来レイヤーパネルで管理可能

### 背景適用範囲

- **レイヤー領域のみ** に背景色を適用
- キャンバスUI背景（`#f0f0f0`）は「アプリUI」として維持

---

## Phase 2: API設計

### 1. packages/engine/src/types.ts — 型追加

```typescript
export interface BackgroundSettings {
  readonly color: Color;
  readonly visible: boolean;
}

export const DEFAULT_BACKGROUND_COLOR: Color = { r: 255, g: 255, b: 255, a: 255 };
```

### 2. packages/engine/src/render.ts — `renderLayers` 拡張

現在の `renderLayers` に `RenderOptions` を追加して背景描画を組み込む。

```typescript
export interface RenderOptions {
  background?: BackgroundSettings;
}

export function renderLayers(
  layers: readonly Layer[],
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  transform: mat3,
  options?: RenderOptions,
): void
```

**変更内容**:
- レイヤー描画前に、`options?.background?.visible` の場合、transformを適用した上で `layers[0]` のサイズで背景色 `fillRect` を描画
- 既存シグネチャとの後方互換性あり（`options` はオプショナル）

**`composeLayers`（incremental-render.ts）は変更しない**: `composeLayers` はストローク中の差分描画合成用であり、背景はその文脈で不要。表示時の `renderLayers` で描画すれば十分。

### 3. packages/engine/src/index.ts — エクスポート追加

- `BackgroundSettings` 型
- `DEFAULT_BACKGROUND_COLOR`
- `RenderOptions` 型

### 4. apps/web/src/components/PaintCanvas.tsx — background prop

```typescript
interface PaintCanvasProps {
  background?: BackgroundSettings;  // 追加
  // ...既存props
}
```

`renderLayers` 呼び出し時:
```typescript
renderLayers(layers, ctx, dprTransform, { background });
```

### 5. apps/web/src/App.tsx — background state

```typescript
const [background] = useState<BackgroundSettings>({
  color: DEFAULT_BACKGROUND_COLOR,
  visible: true,
});

<PaintCanvas background={background} ... />
```

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `packages/engine/src/types.ts` | `BackgroundSettings`, `DEFAULT_BACKGROUND_COLOR` 追加 |
| `packages/engine/src/render.ts` | `RenderOptions` 型追加、`renderLayers` に `options` 引数追加 |
| `packages/engine/src/index.ts` | エクスポート追加 |
| `apps/web/src/components/PaintCanvas.tsx` | `background` prop 追加 |
| `apps/web/src/App.tsx` | `background` state 追加 |

**変更しないファイル**:
| ファイル | 理由 |
|---------|------|
| `packages/engine/src/incremental-render.ts` | `composeLayers` はストローク差分描画合成用。背景は表示レンダリング時（`renderLayers`）で描くため不要 |

---

## Phase 3: 利用イメージ

### PaintCanvas.tsx での利用

```typescript
// renderLayers にオプションとして背景を渡すだけ
renderLayers(layers, ctx, dprTransform, { background });
```

これにより、ビュー変換が適用されたレイヤー領域に背景色が描画され、その上にレイヤーが合成される。キャンバスUI背景（`#f0f0f0`）は既存のまま維持。

### App.tsx での利用

```typescript
const [background] = useState<BackgroundSettings>({
  color: DEFAULT_BACKGROUND_COLOR,  // 白
  visible: true,
});

<PaintCanvas background={background} ... />
```

将来はこの `background` state を操作するUIを追加するだけで拡張可能。

---

## ドキュメント更新対象

- `packages/engine/docs/types.md` — `BackgroundSettings` 型を追記
- `packages/engine/docs/render-api.md` — `RenderOptions` 型・`renderLayers` のオプション引数を追記
- `packages/engine/docs/README.md` — 型一覧にBackgroundSettings追加

---

## 検証方法

1. `pnpm build` - ビルドエラーがないこと
2. `pnpm test` - 既存テストが通ること
3. `pnpm dev` でアプリ起動
4. レイヤー領域が白背景で表示されること（以前は透過）
5. 既存の描画機能（ストローク、Undo/Redo）が正常動作すること
