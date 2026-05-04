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
  readonly pressureCurve: PressureCurve;          // 筆圧カーブ（DEFAULT_PRESSURE_CURVE=線形）
  readonly compositeOperation: GlobalCompositeOperation; // 合成モード（"source-over" が通常）
  readonly brush: BrushConfig;                    // ブラシ設定（pressureDynamics含む）
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
| `style` | `StrokeStyle` | 描画スタイル（色、線幅、筆圧カーブ、合成モード、ブラシ設定を含む）。筆圧のサイズ/flow反映は `style.brush.pressureDynamics` に保存する |
| `brushSeed` | `number` | ブラシの PRNG シード。スタンプブラシの jitter を決定論的にリプレイするために使用。`round-pen` では `0` |
| `timestamp` | `number` | 作成時刻 |

**特徴**:
- 入力点（フィルタ前）のみを保存
- リプレイ時にフィルタ→展開を再適用
- `style: StrokeStyle` に集約することで、従来の個別フィールド展開（`color`, `lineWidth`, `pressureSensitivity?` 等）を廃止。command 保存と replay で optional の解釈不一致を構造的に排除
- 新形式では `pressureSensitivity` を保存せず、ブラシごとの `pressureDynamics` を保存する。旧コマンドや旧設定を読み込む場合は、`pressureSensitivity` を `pressureDynamics.size` に補完してよい。旧形式との replay 等価性は保証しない

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

レイヤーの構造（追加・削除・並び替え・複製・下統合）を操作するコマンド。描画コマンドと同じ履歴に記録される。

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

### DuplicateLayerCommand

レイヤー複製を記録する構造コマンド。複製先 pixels は source layer の duplicate 時点の pixels に依存するため、`pushCommand()` 前に source layer の checkpoint coverage が必要。

```typescript
interface DuplicateLayerCommand {
  readonly type: "duplicate-layer";
  readonly sourceLayerId: string;
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
| `sourceLayerId` | `string` | 複製元レイヤーの ID |
| `layerId` | `string` | 複製先レイヤーの ID |
| `insertIndex` | `number` | 複製先の挿入位置 |
| `width` / `height` | `number` | 複製先レイヤーサイズ |
| `meta` | `LayerMeta` | 複製先のメタデータ |

### MergeLayerDownCommand

レイヤー下統合を記録する構造コマンド。source / target の pixels を target に焼き込み、source layer を削除する。統合後 target は `targetMetaAfter` に更新される。

```typescript
interface MergeLayerDownCommand {
  readonly type: "merge-layer-down";
  readonly sourceLayerId: string;
  readonly targetLayerId: string;
  readonly sourceIndex: number;
  readonly targetIndex: number;
  readonly sourceMeta: LayerMeta;
  readonly targetMetaBefore: LayerMeta;
  readonly targetMetaAfter: LayerMeta;
  readonly timestamp: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `sourceLayerId` | `string` | 統合元レイヤーの ID |
| `targetLayerId` | `string` | 統合先レイヤーの ID |
| `sourceIndex` | `number` | 統合前の source 位置 |
| `targetIndex` | `number` | 統合前の target 位置 |
| `sourceMeta` | `LayerMeta` | Undo 復元用の source meta |
| `targetMetaBefore` | `LayerMeta` | Undo 復元用の target meta |
| `targetMetaAfter` | `LayerMeta` | Redo / replay 用の統合後 target meta |

`merge-layer-down` は source / target 両方の checkpoint coverage が必要。target pixels は source / target 両方の merge 時点の pixels に依存する。

### StructuralCommand

```typescript
type StructuralCommand =
  | AddLayerCommand
  | RemoveLayerCommand
  | ReorderLayerCommand
  | DuplicateLayerCommand
  | MergeLayerDownCommand;
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
| `structural` | `add-layer`, `remove-layer`, `reorder-layer`, `duplicate-layer`, `merge-layer-down` | レイヤー構造の変更。duplicate / merge は checkpoint 依存の pixel effect も持つ |
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

## Atomic Layer Operation Types

レイヤー複製・下統合の低レベル API が返す型。アプリは UI 都合の active layer 更新や名前採番を行い、atomic API の結果として返る `layers` と `command` を同じ操作として反映する。

```typescript
interface DuplicateLayerOptions {
  readonly sourceLayerId: string;
  readonly insertIndex?: number;
  readonly layerId?: string;
  readonly meta?: Partial<LayerMeta>;
}

interface DuplicateLayerResult {
  readonly layers: readonly Layer[];
  readonly layer: Layer;
  readonly insertIndex: number;
  readonly command: DuplicateLayerCommand;
}

interface MergeLayerDownAtomicOptions {
  readonly sourceLayerId: string;
  readonly resultMeta?: Partial<LayerMeta>;
}

interface MergeLayerDownResult {
  readonly layers: readonly Layer[];
  readonly sourceLayerId: string;
  readonly targetLayerId: string;
  readonly sourceIndex: number;
  readonly targetIndex: number;
  readonly command: MergeLayerDownCommand;
}
```

`duplicateLayerAtomic()` は既定で source の直上（`sourceIndex + 1`）に複製する。`mergeLayerDownAtomic()` は source の直下（`sourceIndex - 1`）を target とし、source が最背面の場合は `null` を返す。

---

## Checkpoint

チェックポイント。pre-write checkpoint としてレイヤーのスナップショットを保存する。payload は内部表現であり、通常利用では直接操作せず `beginHistoryMutation()` / `rebuildLayerFromHistory()` / `getHistoryMetrics()` を使う。

```typescript
interface Checkpoint {
  readonly id: string;
  readonly layerId: string;
  readonly commandIndex: number;
  readonly createdAt: number;
  readonly payload: CheckpointPayload;
}

type CheckpointPayload =
  | { readonly type: "empty" }
  | { readonly type: "raw"; readonly imageData: ImageData }
  | {
      readonly type: "encoded";
      readonly width: number;
      readonly height: number;
      readonly codec: "fflate";
      readonly bytes: Uint8Array;
    };
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | `string` | 一意な識別子 |
| `layerId` | `string` | 対象レイヤーのID |
| `commandIndex` | `number` | checkpoint 作成時点の絶対 command index |
| `createdAt` | `number` | 作成時刻（タイムスタンプ） |
| `payload` | `CheckpointPayload` | 内部 checkpoint payload |

---

## HistoryState

履歴の状態。

```typescript
interface HistoryState<TCustom = never> {
  readonly commands: readonly Command<TCustom>[];
  readonly checkpoints: readonly Checkpoint[];
  readonly historyStartIndex: number;
  readonly currentIndex: number;
  readonly undoFloorIndex: number;
  readonly baseCumulativeOffset: {
    readonly x: number;
    readonly y: number;
  };
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly layerCount: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `commands` | `readonly Command<TCustom>[]` | 記録されたコマンド一覧 |
| `checkpoints` | `readonly Checkpoint[]` | チェックポイント一覧 |
| `historyStartIndex` | `number` | `commands[0]` に対応する絶対 command index |
| `currentIndex` | `number` | 現在位置の絶対 command index（-1 は空の状態） |
| `undoFloorIndex` | `number` | Undo 不可境界。`canUndo` は `currentIndex > undoFloorIndex` |
| `baseCumulativeOffset` | `{ readonly x: number; readonly y: number }` | pruning 済み prefix 内の wrap-shift 累積値 |
| `layerWidth` | `number` | レイヤーの幅 |
| `layerHeight` | `number` | レイヤーの高さ |
| `layerCount` | `number` | checkpoint 上限の実効下限に使う現在レイヤー数 |

`HistoryState` は plain readonly object。checkpoint payload は含まれるが安定 public API として直接操作しない。

---

## HistoryConfig

履歴の設定。

```typescript
interface HistoryConfig {
  readonly checkpointInterval: number;
  readonly maxCheckpoints: number;
  readonly checkpointCompression?: "none" | "fast";
}
```

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `checkpointInterval` | `number` | 10 | 対象レイヤーの最後の checkpoint から現在位置までの commandIndex 距離 |
| `maxCheckpoints` | `number` | 10 | 保持する checkpoint 数の目標上限。実効上限は `Math.max(maxCheckpoints, layerCount)` |
| `checkpointCompression` | `"none" \| "fast"` | `"fast"` | checkpoint 圧縮プリセット |

`maxHistorySize` は廃止。Undo 保持範囲は checkpoint eviction によって更新される `undoFloorIndex` で決まる。

### DEFAULT_HISTORY_CONFIG

```typescript
const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  checkpointInterval: 10,
  maxCheckpoints: 10,
  checkpointCompression: "fast",
};
```

---

## PushCommandOptions

```typescript
interface PushCommandOptions {
  readonly afterLayer?: Layer;
  readonly affectedLayerIds?: readonly string[];
  readonly layerCount?: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `afterLayer` | `Layer` | layer 固有 command の対象レイヤー |
| `affectedLayerIds` | `readonly string[]` | `wrap-shift` など全レイヤー command の検証対象 |
| `layerCount` | `number` | checkpoint 上限の実効下限に使う現在レイヤー数 |

---

## RebuildLayerResult

```typescript
type RebuildLayerResult =
  | { readonly ok: true; readonly source: "checkpoint" | "empty" }
  | {
      readonly ok: false;
      readonly reason: "missing-checkpoint";
      readonly layerId: string;
    };
```

`ok: false` の場合、`rebuildLayerFromHistory()` は対象レイヤーを変更しない。

---

## HistoryMetrics

```typescript
interface HistoryMetrics {
  readonly commandCount: number;
  readonly historyStartIndex: number;
  readonly currentIndex: number;
  readonly undoFloorIndex: number;
  readonly undoableCommandCount: number;
  readonly redoableCommandCount: number;
  readonly checkpointCount: number;
  readonly effectiveMaxCheckpoints: number;
  readonly rawCheckpointCount: number;
  readonly encodedCheckpointCount: number;
  readonly rawCheckpointBytes: number;
  readonly encodedCheckpointBytes: number;
  readonly totalCheckpointBytes: number;
  readonly checkpointsByLayer: readonly {
    readonly layerId: string;
    readonly count: number;
    readonly rawBytes: number;
    readonly encodedBytes: number;
  }[];
}
```
