# History API

履歴管理（Undo/Redo）を行う関数群。履歴は checkpoint を起点に command を replay する。復元済みドキュメントや checkpoint eviction 後の非 undo 対象ピクセルを失わないため、ピクセルを書き換える直前に `beginHistoryMutation()` で pre-write checkpoint を確保する。

## 基本フロー

```typescript
let history = createHistoryState(width, height, { layerCount: layers.length });

history = beginHistoryMutation(
  history,
  { affectedLayers: [layer], layerCount: layers.length },
  historyConfig,
);

applyPixels(layer);

history = pushCommand(
  history,
  command,
  { afterLayer: layer, layerCount: layers.length },
  historyConfig,
);
```

`beginHistoryMutation()` は操作開始ではなく、実際に対象レイヤーのピクセルまたは削除対象レイヤーが不可逆に変わる直前に呼ぶ。`pushCommand()` は checkpoint coverage がない undoable command を検出すると `console.warn` を出し、その command を undoable 履歴へ追加しない。

レイヤー複製・下統合は structural command だが pixels の復元に checkpoint coverage が必要。`duplicate-layer` は source layer、`merge-layer-down` は source / target 両方を、atomic operation の直前に `beginHistoryMutation()` へ渡す。

## createHistoryState

```typescript
function createHistoryState<TCustom = never>(
  width: number,
  height: number,
  options?: { readonly layerCount?: number },
): HistoryState<TCustom>;
```

`historyStartIndex = 0`、`currentIndex = -1`、`undoFloorIndex = -1` の空履歴を作成する。`layerCount` は `maxCheckpoints` の実効下限に使われる。

## beginHistoryMutation

```typescript
function beginHistoryMutation<TCustom = never>(
  state: HistoryState<TCustom>,
  options: {
    readonly affectedLayers: readonly Layer[];
    readonly layerCount?: number;
  },
  config?: HistoryConfig,
): HistoryState<TCustom>;
```

対象レイヤーに有効 checkpoint がない、または最後の checkpoint から `checkpointInterval` 以上 commandIndex が進んでいる場合、現在のピクセルを `commandIndex = currentIndex` の checkpoint として保存する。`wrap-shift` は全レイヤーへの書き込みなので、実行直前に全レイヤーを渡す。

`beginHistoryMutation()` 単体では redo branch を破棄しない。cancel / abort でピクセルを元に戻す可能性がある場合、呼び出し前の `HistoryState` を保持しておき、command を push しないならその state に戻す。

## pushCommand

```typescript
function pushCommand<TCustom = never>(
  state: HistoryState<TCustom>,
  command: Command<TCustom>,
  options: PushCommandOptions,
  config?: HistoryConfig,
): HistoryState<TCustom>;
```

`options.afterLayer` は layer 固有の draw/remove 系 command の診断文脈として渡す。`wrap-shift` のような全レイヤー操作では `affectedLayerIds` を渡し、全対象レイヤーに checkpoint coverage があることを検証する。`layerCount` は checkpoint eviction の実効上限に使う。

Redo branch の破棄、checkpoint 圧縮、checkpoint eviction、`undoFloorIndex` 更新、不要 command prefix の pruning は command 確定時に行われる。

checkpoint coverage 判定は command 種別ごとに次のレイヤーを対象にする。

| command | coverage 対象 |
|---|---|
| layer draw command | `command.layerId` |
| `wrap-shift` | `options.affectedLayerIds` |
| `remove-layer` | `command.layerId` |
| `duplicate-layer` | `command.sourceLayerId` |
| `merge-layer-down` | `command.sourceLayerId`, `command.targetLayerId` |

## undo / redo / canUndo / canRedo

```typescript
function canUndo<TCustom = never>(state: HistoryState<TCustom>): boolean;
function canRedo<TCustom = never>(state: HistoryState<TCustom>): boolean;
function undo<TCustom = never>(state: HistoryState<TCustom>): HistoryState<TCustom>;
function redo<TCustom = never>(state: HistoryState<TCustom>): HistoryState<TCustom>;
```

`canUndo(state)` は `state.currentIndex > state.undoFloorIndex` で判定する。`undoFloorIndex` 以前の command は replay-only prefix として残る場合があるが、ユーザーがそこへ Undo することはできない。

## command index helpers

```typescript
function getCommandOffset<TCustom = never>(
  state: HistoryState<TCustom>,
  absoluteIndex: number,
): number;

function getCommandAt<TCustom = never>(
  state: HistoryState<TCustom>,
  absoluteIndex: number,
): Command<TCustom> | undefined;

function getLastCommandIndex<TCustom = never>(
  state: HistoryState<TCustom>,
): number;

function getCommandsInRange<TCustom = never>(
  state: HistoryState<TCustom>,
  fromAbsoluteIndex: number,
  toAbsoluteIndex: number,
): readonly Command<TCustom>[];
```

`currentIndex`、checkpoint の `commandIndex`、範囲指定はすべて絶対 index。`commands[absoluteIndex]` のような直接アクセスはしない。

## structural command と rebuild

`duplicate-layer` と `merge-layer-down` は layer topology と pixels の両方に影響する。`getCommandPixelScope()` は構造変更として `{ type: "structural" }` を返すが、checkpoint eviction と `getAffectedLayerIds()` は pixel dependency を考慮する。

- `duplicate-layer`: 複製先 layer は source layer の duplicate 時点の pixels に依存する。影響集約では複製先 layer id を partial affected に含める。
- `merge-layer-down`: target layer は source / target 両方の merge 時点の pixels に依存する。影響集約では source / target の両方を partial affected に含める。

依存 checkpoint が eviction される場合、`undoFloorIndex` は unrebuildable な duplicate / merge を跨がない位置まで進む。

## rebuildLayerFromHistory

```typescript
function rebuildLayerFromHistory<TCustom = never>(
  layer: Layer,
  state: HistoryState<TCustom>,
  registry?: BrushTipRegistry,
): RebuildLayerResult;
```

対象レイヤーの `currentIndex` 以下で最も新しい checkpoint を復元し、そこから `currentIndex` まで該当レイヤーの draw command と `wrap-shift` を replay する。checkpoint がなく安全に rebuild できない場合はレイヤーを変更せず、`{ ok: false, reason: "missing-checkpoint", layerId }` を返す。通常の `beginHistoryMutation()` / `pushCommand()` フローではこの結果に到達しない。

stroke replay では `StrokeCommand.alphaLocked` を使って描画し、現在の `LayerMeta.alphaLocked` は参照しない。`LayerMeta.alphaLocked` を後から切り替えても、過去 stroke の rebuild 結果は変わらない。

## getHistoryMetrics

```typescript
function getHistoryMetrics<TCustom = never>(
  state: HistoryState<TCustom>,
): HistoryMetrics;
```

command 数、Undo/Redo 可能数、checkpoint 数、raw/encoded checkpoint byte 数、layer 別 checkpoint 集計を返す。checkpoint payload は内部表現なので、通常利用ではこの API で観測する。

## HistoryConfig

```typescript
interface HistoryConfig {
  readonly checkpointInterval: number;
  readonly maxCheckpoints: number;
  readonly checkpointCompression?: "none" | "fast";
}
```

`maxHistorySize` は廃止。Undo 保持範囲は checkpoint の保持状況により決まる。`maxCheckpoints` は全体上限の目標値だが、実効上限は `Math.max(maxCheckpoints, layerCount)`。`checkpointCompression` のデフォルトは `"fast"` で、内部 codec として `fflate` を使う。
