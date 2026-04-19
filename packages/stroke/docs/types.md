# 型定義リファレンス

## 依存する外部型

このパッケージは以下の型を他のパッケージからインポートする：

```typescript
// @yuneco/headless-paint/core から
import type { InputPoint, FilterPipelineConfig, FilterOutput } from "@yuneco/headless-paint/core";

// @yuneco/headless-paint/core から
import type { ExpandConfig, Color, StrokePoint, PressureCurve, StrokeStyle, BrushConfig } from "@yuneco/headless-paint/core";
// re-export
export type { StrokeStyle } from "@yuneco/headless-paint/core";
```

---

## StrokeStyle

`@yuneco/headless-paint/core` からの re-export。詳細は [engine/docs/types.md](../../engine/docs/types.md#strokestyle) を参照。

```typescript
interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity: number;           // 0.0=均一, 1.0=最大感度
  readonly pressureCurve: PressureCurve;          // 筆圧カーブ（DEFAULT_PRESSURE_CURVE=線形）
  readonly compositeOperation: GlobalCompositeOperation; // 合成モード（"source-over" が通常）
  readonly brush: BrushConfig;                    // ブラシ設定（ROUND_PEN が従来方式）
}
```

全フィールド required。詳細は [engine/docs/types.md](../../engine/docs/types.md#strokestyle) を参照。

---

## StrokeSessionState

ストロークセッションの状態。

```typescript
interface StrokeSessionState {
  readonly allCommitted: readonly InputPoint[];
  readonly currentPending: readonly InputPoint[];
  readonly lastRenderedCommitIndex: number;
  readonly style: StrokeStyle;
  readonly expand: ExpandConfig;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `allCommitted` | `readonly InputPoint[]` | これまでの全確定点 |
| `currentPending` | `readonly InputPoint[]` | 現在の未確定点 |
| `lastRenderedCommitIndex` | `number` | 前回描画した確定点のインデックス |
| `style` | `StrokeStyle` | 描画スタイル |
| `expand` | `ExpandConfig` | 展開設定（@yuneco/headless-paint/core から） |

---

## StrokeSessionResult

セッション操作の結果。

```typescript
interface StrokeSessionResult {
  readonly state: StrokeSessionState;
  readonly renderUpdate: RenderUpdate;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `state` | `StrokeSessionState` | 次の呼び出しに渡す状態 |
| `renderUpdate` | `RenderUpdate` | 描画更新データ |

---

## RenderUpdate

描画更新のデータ。engineに渡して描画を行う。

```typescript
interface RenderUpdate {
  readonly newlyCommitted: readonly StrokePoint[];
  readonly currentPending: readonly StrokePoint[];
  readonly style: StrokeStyle;
  readonly expand: ExpandConfig;
  readonly committedOverlapCount: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `newlyCommitted` | `readonly StrokePoint[]` | 今回新たに確定した点（差分、pressure含む）。先頭に `committedOverlapCount` 個のオーバーラップ点を含む |
| `currentPending` | `readonly StrokePoint[]` | 現在のpending全体（pressure含む） |
| `style` | `StrokeStyle` | 描画スタイル |
| `expand` | `ExpandConfig` | 展開設定 |
| `committedOverlapCount` | `number` | `newlyCommitted` 先頭に含まれる描画済みオーバーラップ点の数。Catmull-Rom の曲率計算に使用され、描画はスキップされる |

**newlyCommittedとcurrentPendingの違い**:
- `newlyCommitted`: 前回の `addPointToSession` 以降に新しく確定した点のみ。先頭に最大3点のオーバーラップ（描画済み点）を含み、Catmull-Romスプラインのブリッジ部分の曲率計算精度を向上させる
- `currentPending`: 現在のpending全体（毎回全て再描画するため）

**committedOverlapCount の値**:
| 経路 | 値 | 理由 |
|---|---|---|
| `startStrokeSession` | 0 | 初回描画、オーバーラップなし |
| `addPointToSession` | `min(3, 前回までの committed 点数)` | 利用可能な点数でクランプ |
| `onDrawConfirm`（全フラッシュ） | 呼び出し側で 0 を指定（デフォルト） | allCommitted を一括描画 |

**ゼロ新規点ガード**: `newlyCommitted.length === committedOverlapCount` の場合、新規点がないため `appendToCommittedLayer` の呼び出しをスキップすること。

**StrokePoint型への変更理由**: 筆圧情報（pressure）をengineの描画関数まで伝達するため。InputPointからpressureを保持したままStrokePointに変換される。

---

## StrokeCommand

ストローク描画コマンド。履歴に保存される。

```typescript
interface StrokeCommand {
  readonly type: "stroke";
  readonly layerId: string;
  readonly inputPoints: readonly InputPoint[];
  readonly filterPipeline: FilterPipelineConfig;
  readonly expand: ExpandConfig;
  readonly style: StrokeStyle;
  readonly brushSeed: number;
  readonly timestamp: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"stroke"` | コマンド種別 |
| `layerId` | `string` | 対象レイヤーのID |
| `inputPoints` | `readonly InputPoint[]` | 変換前の入力点列 |
| `filterPipeline` | `FilterPipelineConfig` | フィルタパイプライン設定 |
| `expand` | `ExpandConfig` | 展開設定 |
| `style` | `StrokeStyle` | 描画スタイル（色、線幅、筆圧、合成モード、ブラシ設定を含む）。全フィールド required のため replay 時の解釈不一致がない |
| `brushSeed` | `number` | ブラシの PRNG シード。スタンプブラシの jitter を決定論的にリプレイするために使用。`round-pen` では `0` |
| `timestamp` | `number` | 作成時刻 |

**特徴**:
- 入力点（フィルタ前）のみを保存
- リプレイ時にフィルタ→展開を再適用
- `style: StrokeStyle` に集約することで、従来の個別フィールド展開（`color`, `lineWidth`, `pressureSensitivity?` 等）を廃止。command 保存と replay で optional の解釈不一致を構造的に排除

---

## ClearCommand

クリアコマンド。

```typescript
interface ClearCommand {
  readonly type: "clear";
  readonly layerId: string;
  readonly timestamp: number;
}
```

---

## WrapShiftCommand

ラップシフトコマンド。レイヤー全体をタイル状にシフトする。

```typescript
interface WrapShiftCommand {
  readonly type: "wrap-shift";
  readonly dx: number;
  readonly dy: number;
  readonly timestamp: number;
}
```

---

## TransformLayerCommand

レイヤー変換コマンド。アフィン変換（移動・リサイズ・回転・反転）を記録する。

```typescript
interface TransformLayerCommand {
  readonly type: "transform-layer";
  readonly layerId: string;
  readonly matrix: readonly number[];
  readonly timestamp: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"transform-layer"` | コマンド種別 |
| `layerId` | `string` | 対象レイヤーの ID |
| `matrix` | `readonly number[]` | mat3 のフラット配列（9要素）。gl-matrix の mat3 をシリアライズした形式 |
| `timestamp` | `number` | 作成時刻 |

**特徴**:
- `LayerDrawCommand` に含まれるため、`getCommandsToReplayForLayer`、`getAffectedLayerIds`、`pushCommand` のチェックポイント生成が自動的に動作する
- リプレイ時は engine の `transformLayer` を呼び出してピクセルに焼き込む

---

## LayerDrawCommand

レイヤーに紐づく描画コマンド。`layerId` を持つ。

```typescript
type LayerDrawCommand = StrokeCommand | ClearCommand | TransformLayerCommand;
```

---

## DrawCommand

描画コマンドのUnion型。レイヤーのピクセルに影響する操作。`LayerDrawCommand` はレイヤー固有、`WrapShiftCommand` はグローバル（全レイヤーに適用）。

```typescript
type DrawCommand = StrokeCommand | ClearCommand | WrapShiftCommand | TransformLayerCommand;
```

---

## Structural Commands（構造コマンド）

レイヤーの構造（追加・削除・並び替え）を操作するコマンド。描画コマンドと同じ履歴に記録される。

### AddLayerCommand

```typescript
interface AddLayerCommand {
  readonly type: "add-layer";
  readonly layerId: string;
  readonly insertIndex: number;
  readonly width: number;
  readonly height: number;
  readonly meta: LayerMeta;
  readonly timestamp: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `layerId` | `string` | 新しいレイヤーのID |
| `insertIndex` | `number` | レイヤースタックへの挿入位置 |
| `width` / `height` | `number` | レイヤーサイズ |
| `meta` | `LayerMeta` | 作成時のメタデータ（name, visible, opacity等） |

### RemoveLayerCommand

```typescript
interface RemoveLayerCommand {
  readonly type: "remove-layer";
  readonly layerId: string;
  readonly removedIndex: number;
  readonly meta: LayerMeta;
  readonly timestamp: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `layerId` | `string` | 削除するレイヤーのID |
| `removedIndex` | `number` | 削除前のスタック位置（Undo復元用） |
| `meta` | `LayerMeta` | 削除時のメタデータスナップショット（Undo復元用） |

**設計意図**: 削除時の `meta`（name, visible, opacity, compositeOperation）をスナップショットすることで、Undo時にメタデータを含めて完全復元できる。メタデータ変更（リネーム、表示切替等）はコマンド化されないため、削除コマンドでの保存が復元の唯一の手段となる。

### ReorderLayerCommand

```typescript
interface ReorderLayerCommand {
  readonly type: "reorder-layer";
  readonly layerId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly timestamp: number;
}
```

### StructuralCommand

```typescript
type StructuralCommand = AddLayerCommand | RemoveLayerCommand | ReorderLayerCommand;
```

---

## PixelScope

単一コマンドのピクセル影響スコープ。コマンドがどの範囲のピクセルに影響するかを分類する。

```typescript
type PixelScope<TCustom = never> =
  | { readonly type: "layer"; readonly layerId: string }
  | { readonly type: "all" }
  | { readonly type: "structural" }
  | { readonly type: "custom"; readonly command: TCustom };
```

| バリアント | 該当コマンド | 説明 |
|---|---|---|
| `layer` | `stroke`, `clear`, `transform-layer` | 特定レイヤーのピクセルのみ影響 |
| `all` | `wrap-shift` | 全レイヤーのピクセルに影響 |
| `structural` | `add-layer`, `remove-layer`, `reorder-layer` | ピクセル変更なし（レイヤー構造の変更） |
| `custom` | `TCustom` | アプリ定義。影響判定はアプリ側で行う |

---

## AffectedLayers

コマンド範囲のピクセル影響を集約した結果。`getAffectedLayerIds` の戻り値。

```typescript
type AffectedLayers =
  | { readonly type: "partial"; readonly layerIds: ReadonlySet<string> }
  | { readonly type: "all" };
```

| バリアント | 説明 |
|---|---|
| `partial` | 特定レイヤーのみ影響。`layerIds` が空の場合はピクセル変更なし |
| `all` | 全レイヤーに影響（範囲内に `wrap-shift` が含まれる場合） |

---

## Command

コマンドのUnion型。描画コマンド・構造コマンド・カスタムコマンドを含む。

```typescript
type Command<TCustom = never> = DrawCommand | StructuralCommand | TCustom;
```

| 型パラメータ | デフォルト | 説明 |
|---|---|---|
| `TCustom` | `never` | アプリ定義のカスタムコマンド型。省略時はライブラリ組み込みコマンドのみ |

`TCustom = never` の場合、`Command` は従来通り `DrawCommand | StructuralCommand` と等価になる（後方互換）。

### 型ガード

```typescript
function isDrawCommand<TCustom>(cmd: Command<TCustom>): cmd is DrawCommand;
function isLayerDrawCommand<TCustom>(cmd: Command<TCustom>): cmd is LayerDrawCommand;
function isStructuralCommand<TCustom>(cmd: Command<TCustom>): cmd is StructuralCommand;
function isCustomCommand<TCustom>(cmd: Command<TCustom>): cmd is TCustom;
```

`isDrawCommand` と `isLayerDrawCommand` は `"transform-layer"` を含む。

`isCustomCommand` は `isDrawCommand` と `isStructuralCommand` のどちらにも該当しないコマンドを `TCustom` と判定する。

---

## Checkpoint

チェックポイント。N操作ごとにレイヤーのスナップショットを保存。

```typescript
interface Checkpoint {
  readonly id: string;
  readonly layerId: string;
  readonly commandIndex: number;
  readonly imageData: ImageData;
  readonly createdAt: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | `string` | 一意な識別子 |
| `layerId` | `string` | 対象レイヤーのID |
| `commandIndex` | `number` | 対応するコマンドのインデックス |
| `imageData` | `ImageData` | レイヤーのスナップショット |
| `createdAt` | `number` | 作成時刻（タイムスタンプ） |

---

## HistoryState

履歴の状態。

```typescript
interface HistoryState<TCustom = never> {
  readonly commands: readonly Command<TCustom>[];
  readonly checkpoints: readonly Checkpoint[];
  readonly currentIndex: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly drawsSinceCheckpoint: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `commands` | `readonly Command<TCustom>[]` | 記録されたコマンド一覧 |
| `checkpoints` | `readonly Checkpoint[]` | チェックポイント一覧 |
| `currentIndex` | `number` | 現在位置（-1 は空の状態） |
| `layerWidth` | `number` | レイヤーの幅 |
| `layerHeight` | `number` | レイヤーの高さ |
| `drawsSinceCheckpoint` | `number` | 最後のチェックポイント以降の DrawCommand 数。チェックポイント作成間隔の判定に使用 |

`TCustom = never` の場合、従来の `HistoryState` と等価（後方互換）。

---

## HistoryConfig

履歴の設定。

```typescript
interface HistoryConfig {
  readonly maxHistorySize: number;
  readonly checkpointInterval: number;
  readonly maxCheckpoints: number;
}
```

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `maxHistorySize` | `number` | 100 | 最大履歴数（DrawCommand のみカウント） |
| `checkpointInterval` | `number` | 10 | チェックポイント作成間隔（DrawCommand のみカウント） |
| `maxCheckpoints` | `number` | 10 | 最大チェックポイント数 |

**カウント対象**: `maxHistorySize` と `checkpointInterval` は DrawCommand の数に基づいてカウントされる。StructuralCommand やカスタムコマンドはカウントに含まれない。

### DEFAULT_HISTORY_CONFIG

```typescript
const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
};
```
