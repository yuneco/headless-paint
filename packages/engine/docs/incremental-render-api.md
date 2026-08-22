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

### ブラシ状態管理

差分描画 API は Expand で分岐したストロークを順に `renderBrushStroke` へ渡す。`BrushRenderState` の初期化、branch ごとの取り出し、描画後の merge、pending 描画用クローンは `packages/engine/src/brush/state.ts` が担当する。

`incremental-render.ts` は以下のブラシ内部事情を直接管理しない。

- `BrushRenderState.branches` の不足分補完と branch state の生成
- branch ごとの `accumulatedDistance` / `emissionCount` / `lastTimestamp` / `nextTimeEmissionAt` の merge
- 可変spacing有効時の `distanceEmissionProgress` の引き継ぎ
- mixing色場と有限checkpoint resourceのbranch ownership

これにより、stamp / spray / round-pen は同じ branch ループで扱われる。spray は mixing 非対応のため、pending クローンは数値 state と `tipCanvas` 参照だけを引き継ぐ軽い経路になる。

---

## RenderUpdate

描画更新のデータ構造。外部利用では `@yuneco/headless-paint/core` から import できる。
実装上は stroke パッケージで定義・エクスポートされており、engine パッケージには含まれない。

```typescript
// stroke で定義され、公開 API では @yuneco/headless-paint/core から利用できる
interface RenderUpdate {
  readonly newlyCommitted: readonly StrokePoint[];  // 今回新たに確定した点（pressure/timestamp含む）
  readonly currentPending: readonly StrokePoint[];  // 現在のpending全体（pressure/timestamp含む）
  readonly style: StrokeStyle;
  readonly expand: ExpandConfig;
  readonly committedOverlapCount: number;            // 先頭のオーバーラップ点数
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
  compiledExpand: CompiledExpand,
  overlapCount?: number,
  brushState?: BrushRenderState,
  sourceLayer?: Layer,
  alphaLocked?: boolean,
): BrushRenderState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 確定レイヤー |
| `points` | `readonly StrokePoint[]` | ○ | 新しく確定した点（pressure/timestamp含む）。先頭に `overlapCount` 個のオーバーラップ点を含む |
| `style` | `StrokeStyle` | ○ | 描画スタイル（brush.pressureDynamics含む） |
| `compiledExpand` | `CompiledExpand` | ○ | コンパイル済み展開設定 |
| `overlapCount` | `number` | - | 先頭のオーバーラップ点数。`drawVariableWidthPath` にパススルーされ、曲率計算精度を向上させる。デフォルト 0（従来互換） |
| `brushState` | `BrushRenderState` | - | ブラシレンダリング状態。`tipCanvas` と branch ごとの `accumulatedDistance` / `emissionCount` / `distanceEmissionProgress` / `lastTimestamp` / `nextTimeEmissionAt`、混色有効時の `branches[].mixing` を含む。`round-pen` では省略可 |
| `sourceLayer` | `Layer` | 条件付き | 混色有効時は必須。`layer`と異なるstroke-start snapshotを渡す。非混色では省略可 |
| `alphaLocked` | `boolean` | - | 通常描画を既存 alpha に制限するか。省略時は `layer.meta.alphaLocked` を使用する |

**動作**:
1. pointsを`expandStrokePoints`で展開（pressure/timestamp保持）
2. `brush/state.ts` で `BrushRenderState.branches` を展開数に揃え、branch ごとの開始 state を取り出す
3. 各展開ストロークを`renderBrushStroke`で描画。混色有効時は分岐ごとのtip-local色場を更新し、最初は`sourceLayer`、以後は描画済みtargetから切り出した有限checkpointを参照する
4. 描画後の branch state を `brush/state.ts` で merge する
5. `alphaLocked` が `true` かつ通常描画の場合は `source-atop` で描画し、既存 alpha のある範囲にだけ反映する
6. 既存の描画は保持される（追加描画のみ）
7. 更新された `BrushRenderState` を返す（各 branch の `accumulatedDistance` / `emissionCount` / 時間 state が進む）

**戻り値**: `BrushRenderState` — 更新されたブラシレンダリング状態。stamp / spray では branch ごとの `accumulatedDistance`、`emissionCount`、`lastTimestamp`、`nextTimeEmissionAt` が更新されている。`round-pen` では `{ seed: 0, tipCanvas: null, branches: [{ accumulatedDistance: 0, emissionCount: 0 }] }` を返す。

**消しゴムモードの動作**:
`style.compositeOperation` が `"destination-out"` の場合、committedレイヤーの既存ピクセルが直接消去される。
`alphaLocked` が `true` の場合も消しゴムは alpha lock の制約対象外で、従来通り `destination-out` として動作する。

**履歴 replay との関係**:
ライブ描画では `alphaLocked` 省略時に `layer.meta.alphaLocked` を参照する。履歴 replay では現在の `LayerMeta` ではなく、`StrokeCommand.alphaLocked` に保存された値を明示的に渡す。これにより、後からレイヤーの alpha lock 設定を変更しても過去ストロークの replay 結果は変わらない。

**使用例**:
```typescript
// 新しく確定した点を描画（オーバーラップ付き）
if (renderUpdate.newlyCommitted.length > renderUpdate.committedOverlapCount) {
  const nextBrushState = appendToCommittedLayer(
    committedLayer,
    renderUpdate.newlyCommitted,
    renderUpdate.style,
    compiledExpand,
    renderUpdate.committedOverlapCount,
    brushState,
  );
  // nextBrushState を pending 描画に渡す
}
```

---

## renderPendingLayer

作業レイヤーを再描画する（クリア→描画）。

```typescript
function renderPendingLayer(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  compiledExpand: CompiledExpand,
  brushState?: BrushRenderState,
  sourceLayer?: Layer,
  previewBaseLayer?: Layer,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layer` | `Layer` | ○ | 作業レイヤー |
| `points` | `readonly StrokePoint[]` | ○ | 未確定点全体（pressure/timestamp含む） |
| `style` | `StrokeStyle` | ○ | 描画スタイル（brush.pressureDynamics含む） |
| `compiledExpand` | `CompiledExpand` | ○ | コンパイル済み展開設定 |
| `brushState` | `BrushRenderState` | - | ブラシレンダリング状態。committed 描画から引き継いだ branch ごとの `accumulatedDistance` / `emissionCount` / `lastTimestamp` / `nextTimeEmissionAt` と混色更新状態を使用し、境界での emission と混色の連続性を保つ |
| `sourceLayer` | `Layer` | - | 非混色pendingで必要な場合のみ参照。混色pendingはno-op |
| `previewBaseLayer` | `Layer` | - | 互換引数。stateful mixingのpendingはno-opのため参照しない |

**動作**:
1. レイヤーをクリア
2. pointsを`expandStrokePoints`で展開（pressure/timestamp保持）
3. 非混色brushでは`BrushRenderState`を複製してpendingを描画する。混色brushは色場rollbackを行わず、この時点でno-opとする
4. 各展開ストロークを`renderBrushStroke`でブラシ種別に応じて描画（`compositeOperation` は適用しない、常に `source-over`）

**時間ベース emission と境界処理**:
`renderPendingLayer` は committed state を複製してから pending 点列を再描画する。`walkEmissions` は branch state の `lastTimestamp` 以前の overlap 再入力区間を時間 emission の対象外にするため、committed/pending の接続に必要な overlap 点を渡しても、静止中の吹きつけが境界で二重配置されない。距離 emission も従来通り `overlapCount` と `accumulatedDistance` により描画済み区間を再配置しない。

`renderPendingLayer` は alpha lock を評価しない。alpha lock 有効時の live preview は `renderLayers` / `composeLayers` の pending overlay 合成で committed レイヤーの alpha を使ってマスクする。pending レイヤー自体は従来通り、未確定点の pixels だけを保持する。

**混色プレビュー**:
混色ブラシはCausal input（過去情報だけの入力補正）とcommitted描画を標準とし、pending layerへ仮のmaterial結果を描かない。これにより形状pendingと色場rollbackのライフサイクルを分離する。ストローク開始時の`sourceLayer`は最初のpickupだけに使い、一定距離後は描画済みtargetの局所checkpointへ切り替わる。同一strokeの往復でも開始時の原色を毎回再導入しない。

**消しゴムモードの注意**:
pendingレイヤーは毎回クリアされるため、`destination-out` で描画しても不可視になる。消しゴムのpendingプレビューは `LayerMeta.compositeOperation` によるレイヤー合成時に実現される（→ renderLayers / composeLayers を参照）。

**使用例**:
```typescript
// 未確定点を再描画（brushState で committed からの連続性を保つ）
renderPendingLayer(
  pendingLayer,
  renderUpdate.currentPending,
  renderUpdate.style,
  compiledExpand,
  brushState,
);
```

---

## composeLayers

複数のレイヤーを表示用キャンバスに合成する。

```typescript
function composeLayers(
  target: CanvasRenderingContext2D,
  layers: readonly Layer[],
  transform?: ViewTransform,
  pendingOverlay?: PendingOverlay,
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
| `pendingOverlay` | `PendingOverlay` | - | pending レイヤーのプレ合成情報。`renderLayers` と同じプレ合成ロジックを適用する |

**動作**:
1. ターゲットキャンバスをクリア
2. 各レイヤーについて、`meta.visible` が false のものはスキップ
3. `pendingOverlay` が指定されており対象レイヤーにプレ合成が必要な場合、workLayer にプレ合成
4. `meta.opacity` を `globalAlpha` に適用
5. `meta.compositeOperation` が設定されていれば `globalCompositeOperation` に適用
6. `drawImage` でレイヤーの内容を転写

pending overlay の target レイヤーで `meta.alphaLocked` が `true` かつ pending が通常描画の場合、プレ合成時に pending を target committed レイヤーの alpha でマスクする。初回実装では `PendingOverlay.workLayer` 全体を使う。dirty rect などの転写範囲最適化は、性能測定後に必要性を判断する。

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
} from "@yuneco/headless-paint/core";
import type { BrushRenderState } from "@yuneco/headless-paint/core";

// レイヤー作成
const committedLayer = createLayer(width, height, { name: "Committed" });
const pendingLayer = createLayer(width, height, { name: "Pending" });

// 展開設定をコンパイル
const compiledExpand = compileExpand(expandConfig);

// ブラシ状態（ストローク開始時に初期化）
let brushState: BrushRenderState | undefined;

// ストローク中の描画更新
function onRenderUpdate(update: RenderUpdate) {
  // 1. 新しく確定した点を確定レイヤーに追加
  if (update.newlyCommitted.length > update.committedOverlapCount) {
    brushState = appendToCommittedLayer(
      committedLayer,
      update.newlyCommitted,
      update.style,
      compiledExpand,
      update.committedOverlapCount,
      brushState,
    );
  }

  // 2. 未確定点を作業レイヤーに再描画（brushState で連続性を保つ）
  renderPendingLayer(
    pendingLayer,
    update.currentPending,
    update.style,
    compiledExpand,
    brushState,
  );

  // 3. 合成して表示
  displayCtx.clearRect(0, 0, width, height);
  composeLayers(displayCtx, [committedLayer, pendingLayer], viewTransform);
}

// ストローク終了時
function onStrokeEnd() {
  brushState = undefined;
  clearLayer(pendingLayer);
  displayCtx.clearRect(0, 0, width, height);
  composeLayers(displayCtx, [committedLayer], viewTransform);
}
```
