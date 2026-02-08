# Incremental Render API

確定点と未確定点を分離して描画する差分描画API。

## 概要

### 背景

スムージング処理では、直近の数点が「未確定」（後から座標が変わる可能性がある）となる。未確定点を描画しないとペン位置より手前までしか線が出ず「もっさり」するが、未確定点は座標変更時に再描画が必要になる。

### 二層レンダリング

この問題を解決するため、2つのレイヤーを使い分ける：

```
┌─────────────────────────────────────┐
│         Committed Layer             │  確定レイヤー
│  座標確定済みの点を追加描画         │  （永続的）
└─────────────────────────────────────┘
              ↓ 合成
┌─────────────────────────────────────┐
│          Pending Layer              │  作業レイヤー
│  未確定点を毎回クリア→再描画        │  （一時的）
└─────────────────────────────────────┘
              ↓ 合成
┌─────────────────────────────────────┐
│         Display Canvas              │  表示用キャンバス
└─────────────────────────────────────┘
```

### パフォーマンス

- **確定点**: 追加描画のみ（既存描画を保持）
- **未確定点**: クリア→再描画（点数が少ないので高速）
- **合成**: Canvas to Canvas転写（GPU最適化されている）

---

## RenderUpdate

描画更新のデータ構造。`@headless-paint/stroke` パッケージで定義・エクスポートされている（engine パッケージには含まれない）。

```typescript
// @headless-paint/stroke で定義
interface RenderUpdate {
  readonly newlyCommitted: readonly StrokePoint[];  // 今回新たに確定した点（pressure含む）
  readonly currentPending: readonly StrokePoint[];  // 現在のpending全体（pressure含む）
  readonly style: StrokeStyle;
  readonly expand: ExpandConfig;
}
```

---

## appendToCommittedLayer

確定レイヤーに新しく確定した点を追加描画する。

```typescript
function appendToCommittedLayer(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  compiledExpand: CompiledExpand
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 確定レイヤー |
| `points` | `readonly StrokePoint[]` | ○ | 新しく確定した点（pressure含む） |
| `style` | `StrokeStyle` | ○ | 描画スタイル（pressureSensitivity含む） |
| `compiledExpand` | `CompiledExpand` | ○ | コンパイル済み展開設定 |

**動作**:
1. pointsを`expandStrokePoints`で展開（pressure保持）
2. 各展開ストロークを`drawVariableWidthPath`で可変太さ描画（`style.compositeOperation` を適用）
3. 既存の描画は保持される（追加描画のみ）

**消しゴムモードの動作**:
`style.compositeOperation` が `"destination-out"` の場合、committedレイヤーの既存ピクセルが直接消去される。

**使用例**:
```typescript
// 新しく確定した点を描画
appendToCommittedLayer(
  committedLayer,
  renderUpdate.newlyCommitted,
  renderUpdate.style,
  compiledExpand
);
```

---

## renderPendingLayer

作業レイヤーを再描画する（クリア→描画）。

```typescript
function renderPendingLayer(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  compiledExpand: CompiledExpand
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 作業レイヤー |
| `points` | `readonly StrokePoint[]` | ○ | 未確定点全体（pressure含む） |
| `style` | `StrokeStyle` | ○ | 描画スタイル（pressureSensitivity含む） |
| `compiledExpand` | `CompiledExpand` | ○ | コンパイル済み展開設定 |

**動作**:
1. レイヤーをクリア
2. pointsを`expandStrokePoints`で展開（pressure保持）
3. 各展開ストロークを`drawVariableWidthPath`で可変太さ描画（`compositeOperation` は適用しない、常に `source-over`）

**消しゴムモードの注意**:
pendingレイヤーは毎回クリアされるため、`destination-out` で描画しても不可視になる。消しゴムのpendingプレビューは `LayerMeta.compositeOperation` によるレイヤー合成時に実現される（→ renderLayers / composeLayers を参照）。

**使用例**:
```typescript
// 未確定点を再描画
renderPendingLayer(
  pendingLayer,
  renderUpdate.currentPending,
  renderUpdate.style,
  compiledExpand
);
```

---

## composeLayers

複数のレイヤーを表示用キャンバスに合成する。

```typescript
function composeLayers(
  target: CanvasRenderingContext2D,
  layers: readonly Layer[],
  transform?: ViewTransform
): void
```

`ViewTransform` は `incremental-render.ts` で定義される独自型で、render-api.md の `mat3` ベースのビュー変換とは異なる:

```typescript
interface ViewTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `target` | `CanvasRenderingContext2D` | ○ | 出力先のコンテキスト |
| `layers` | `readonly Layer[]` | ○ | 合成するレイヤー（下から順） |
| `transform` | `ViewTransform` | - | ビュー変換（省略時は変換なし）。`{ scale, offsetX, offsetY }` 形式 |

**動作**:
1. ターゲットキャンバスをクリア
2. 各レイヤーについて、`meta.visible` が false のものはスキップ
3. `meta.opacity` を `globalAlpha` に適用
4. `meta.compositeOperation` が設定されていれば `globalCompositeOperation` に適用
5. `drawImage` でレイヤーの内容を転写

**使用例**:
```typescript
// 確定レイヤー + 作業レイヤーを合成
composeLayers(displayCtx, [committedLayer, pendingLayer], viewTransform);
```

---

## 典型的な使用パターン

```typescript
import {
  createLayer,
  compileExpand,
  appendToCommittedLayer,
  renderPendingLayer,
  composeLayers,
} from "@headless-paint/engine";

// レイヤー作成
const committedLayer = createLayer(width, height, { name: "Committed" });
const pendingLayer = createLayer(width, height, { name: "Pending" });

// 展開設定をコンパイル
const compiledExpand = compileExpand(expandConfig);

// ストローク中の描画更新
function onRenderUpdate(update: RenderUpdate) {
  // 1. 新しく確定した点を確定レイヤーに追加
  if (update.newlyCommitted.length > 0) {
    appendToCommittedLayer(
      committedLayer,
      update.newlyCommitted,
      update.style,
      compiledExpand
    );
  }

  // 2. 未確定点を作業レイヤーに再描画
  renderPendingLayer(
    pendingLayer,
    update.currentPending,
    update.style,
    compiledExpand
  );

  // 3. 合成して表示
  displayCtx.clearRect(0, 0, width, height);
  composeLayers(displayCtx, [committedLayer, pendingLayer], viewTransform);
}

// ストローク終了時
function onStrokeEnd() {
  // 作業レイヤーをクリア
  clearLayer(pendingLayer);

  // 最終合成
  displayCtx.clearRect(0, 0, width, height);
  composeLayers(displayCtx, [committedLayer], viewTransform);
}
```
