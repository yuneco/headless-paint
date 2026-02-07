# 型定義リファレンス

## 依存する外部型

このパッケージは以下の型を他のパッケージからインポートする：

```typescript
// @headless-paint/input から
import type { InputPoint, FilterPipelineConfig, FilterOutput } from "@headless-paint/input";

// @headless-paint/engine から
import type { ExpandConfig, Color, StrokePoint } from "@headless-paint/engine";
// re-export
export type { StrokeStyle } from "@headless-paint/engine";
```

---

## StrokeStyle

`@headless-paint/engine` からの re-export。詳細は [engine/docs/types.md](../../engine/docs/types.md#strokestyle) を参照。

```typescript
interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity?: number;  // 0.0=均一, 1.0=最大感度
  readonly pressureCurve?: PressureCurve; // 筆圧カーブ（undefined=線形）
  readonly compositeOperation?: GlobalCompositeOperation; // 合成モード（undefined="source-over"）
}
```

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
| `expand` | `ExpandConfig` | 展開設定（@headless-paint/engine から） |

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
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `newlyCommitted` | `readonly StrokePoint[]` | 今回新たに確定した点（差分、pressure含む） |
| `currentPending` | `readonly StrokePoint[]` | 現在のpending全体（pressure含む） |
| `style` | `StrokeStyle` | 描画スタイル |
| `expand` | `ExpandConfig` | 展開設定 |

**newlyCommittedとcurrentPendingの違い**:
- `newlyCommitted`: 前回の `addPointToSession` 以降に新しく確定した点のみ
- `currentPending`: 現在のpending全体（毎回全て再描画するため）

**StrokePoint型への変更理由**: 筆圧情報（pressure）をengineの描画関数まで伝達するため。InputPointからpressureを保持したままStrokePointに変換される。

---

## StrokeCommand

ストローク描画コマンド。履歴に保存される。

```typescript
interface StrokeCommand {
  readonly type: "stroke";
  readonly inputPoints: readonly InputPoint[];
  readonly filterPipeline: FilterPipelineConfig;
  readonly expand: ExpandConfig;
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity?: number;
  readonly pressureCurve?: PressureCurve;
  readonly compositeOperation?: GlobalCompositeOperation;
  readonly timestamp: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `"stroke"` | コマンド種別 |
| `inputPoints` | `readonly InputPoint[]` | 変換前の入力点列 |
| `filterPipeline` | `FilterPipelineConfig` | フィルタパイプライン設定 |
| `expand` | `ExpandConfig` | 展開設定 |
| `color` | `Color` | 描画色 |
| `lineWidth` | `number` | 線の太さ |
| `pressureSensitivity` | `number` | 筆圧感度（optional、undefined→0扱い） |
| `pressureCurve` | `PressureCurve` | 筆圧カーブ（optional、undefined→線形） |
| `compositeOperation` | `GlobalCompositeOperation` | 合成モード（optional、undefined→`"source-over"`）。消しゴムストロークでは `"destination-out"` |
| `timestamp` | `number` | 作成時刻 |

**特徴**:
- 入力点（フィルタ前）のみを保存
- リプレイ時にフィルタ→展開を再適用
- データサイズが小さい

---

## ClearCommand

クリアコマンド。

```typescript
interface ClearCommand {
  readonly type: "clear";
  readonly timestamp: number;
}
```

---

## Command

コマンドのUnion型。

```typescript
type Command = StrokeCommand | ClearCommand | WrapShiftCommand;
```

---

## Checkpoint

チェックポイント。N操作ごとにレイヤーのスナップショットを保存。

```typescript
interface Checkpoint {
  readonly id: string;
  readonly commandIndex: number;
  readonly imageData: ImageData;
  readonly createdAt: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | `string` | 一意な識別子 |
| `commandIndex` | `number` | 対応するコマンドのインデックス |
| `imageData` | `ImageData` | レイヤーのスナップショット |
| `createdAt` | `number` | 作成時刻（タイムスタンプ） |

---

## HistoryState

履歴の状態。

```typescript
interface HistoryState {
  readonly commands: readonly Command[];
  readonly checkpoints: readonly Checkpoint[];
  readonly currentIndex: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `commands` | `readonly Command[]` | 記録されたコマンド一覧 |
| `checkpoints` | `readonly Checkpoint[]` | チェックポイント一覧 |
| `currentIndex` | `number` | 現在位置（-1 は空の状態） |
| `layerWidth` | `number` | レイヤーの幅 |
| `layerHeight` | `number` | レイヤーの高さ |

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
| `maxHistorySize` | `number` | 100 | 最大履歴数 |
| `checkpointInterval` | `number` | 10 | チェックポイント作成間隔 |
| `maxCheckpoints` | `number` | 10 | 最大チェックポイント数 |

### DEFAULT_HISTORY_CONFIG

```typescript
const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
};
```
