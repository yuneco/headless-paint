# command-executor 設計（WS1・Phase 1 ドラフト）

> ステータス: IF 設計ドラフト。persistence event 対応表（paint-app `plans/2026-07-04-ws1-phase1-review.md`）の
> ユーザーレビュー完了後に実装（Phase 3）へ進む。

## 目的と責務

undo/redo の「history-aware な復元オーケストレーション」を lib に一元化する。
現在 `packages/react/src/usePaintEngine.ts`（handleUndo/handleRedo, L629-884）と paint-app
`historyAtoms.ts` に二重実装されている以下の骨格を、1つの実行表に集約する:

```
ガード → undo()/redo() で index 遷移 → コマンド種別 dispatch →
レイヤー実体の復元（rebuild/再生成/メタ復元） → 結果 hints をデータで返す
```

**しないこと**: jotai/React への依存、レイヤーリスト状態の所有（app/react 層が entries を持つ）、
persistence の実行（イベントをデータで返すだけ）、custom コマンドの中身の解釈（executor 注入）。

## API 骨子

```ts
// 中核。layer のピクセル変異は deps 経由で実行し、それ以外の帰結はすべて result で返す
executeHistoryOp<TCustom>(
  op: "undo" | "redo",
  state: HistoryState<TCustom>,
  deps: ExecutorDeps<TCustom>,
): ExecutorResult<TCustom>

interface ExecutorDeps<TCustom> {
  readonly layers: readonly Layer[];          // 現在の committed layer 群（z順）
  readonly tipRegistry?: BrushTipRegistry;    // rebuild 用
  readonly customExecutor?: CustomCommandExecutor<TCustom>;
  readonly shiftTempCanvas?: Layer;           // wrap-shift 用ワーク
}

// custom コマンドは apply/unapply の純粋な実行表として注入（app 側: appCustomCommandExecutor）
interface CustomCommandExecutor<TCustom> {
  apply(command: TCustom): CustomCommandOutcome;    // redo 方向
  unapply(command: TCustom): CustomCommandOutcome;  // undo 方向
}

interface ExecutorResult<TCustom> {
  readonly ok: boolean;
  readonly failure?: { reason: "missing-checkpoint" | "apply-failed" | "guard";
                       commandType: string; layerId?: string };
  readonly next: HistoryState<TCustom>;       // ok 時のみコミットする新 state
  readonly command: Command<TCustom>;         // 対象コマンド
  readonly layerListOps: readonly LayerListOp[];  // app が entries へ反映する
  readonly activeLayerIdHint?: string;
  readonly visibilityFixLayerIds: readonly string[]; // rebuild 後に可視化すべき layer
  readonly dirty: DirtyHint;                  // pixel dirty 種別
  readonly persistence: PersistenceEvent;     // 対応表で確定（下記）
}

type LayerListOp =
  | { type: "insert"; index: number; layer: Layer }   // executor が生成・rebuild 済みの実体
  | { type: "remove"; layerId: string }
  | { type: "move"; fromIndex: number; toIndex: number }
  | { type: "replace"; layers: readonly Layer[]; activeLayerId: string }; // duplicate/merge redo

type DirtyHint =
  | { type: "none" }
  | { type: "layers"; layerIds: readonly string[] }
  | { type: "all" };

type PersistenceEvent =
  | { type: "none" }
  | { type: "append-command"; command: unknown }   // redo 非構造
  | { type: "delete-last-command" }                // undo 非構造
  | { type: "structural-checkpoint" };             // 構造 undo/redo

// push 側の対応表（歴史操作→event の一意対応を push にも適用する純粋関数）
resolvePushPersistenceEvent(command: Command<TCustom>): PersistenceEvent
//   非構造 → append-command / 構造 → structural-checkpoint
```

## dispatch 実行表（usePaintEngine/historyAtoms の現行挙動を仕様化）

| コマンド | undo | redo |
|---|---|---|
| custom | `customExecutor.unapply` | `customExecutor.apply` |
| wrap-shift | 全 layer に `wrapShiftLayer(-dx,-dy)`、dirty all | 正方向、dirty all |
| add-layer | listOp remove、active を近傍へ | layer 再生成 + insert、active=新 layer |
| remove-layer | meta から再生成 + rebuild + 元 index へ insert、active 復元、dirty layer | listOp remove、active 近傍 |
| reorder-layer | move to→from | move from→to |
| duplicate-layer | 複製 layer を remove、active=source | `applyDuplicateLayerCommand` → replace、active=新 layer、dirty layer |
| merge-layer-down | source 再生成 + target meta を before へ復元 + 両 rebuild + source を元 index へ insert、active=source、dirty 両方 | `applyMergeLayerDownCommand` → replace、active=target、dirty target |
| 上記以外の draw | `getAffectedLayerIds` で対象を `rebuildLayerFromHistory`、dirty layers/all | 同（index の向きが逆） |

- rebuild 後に対象 layer が不可視なら `visibilityFixLayerIds` に載せる（現行 usePaintEngine L747-749 の仕様化）
- ストローク中ガード（isDrawing）は **app 側の責務のまま**（executor は履歴とレイヤーしか知らない）

## 失敗セマンティクス（レビュー対象・決定事項は app 側レビュー md 参照）

`rebuildLayerFromHistory` が `missing-checkpoint` を返した場合は **全コマンド種別で統一して中断**
（`ok:false`、`next` はコミットしない）を第一候補とする。現行は remove-layer undo のみ
「warn して空レイヤーのまま続行」という非対称（usePaintEngine L667-671）があり、これを廃止する提案。

## 段階導入

- **WS1**: paint-app `historyAtoms.ts` の undo/redo action を executor の汎用ループに置換（711→約250行）。
  persistence bridge は `ExecutorResult.persistence` をデータで受ける形に再設計
- **WS5**: `usePaintEngine.ts` の handleUndo/handleRedo を executor の薄いラッパーに再実装

## 関連

- 対応表と bridge 再設計: paint-app `plans/2026-07-04-ws1-phase1-review.md`
- 既存 API: [history-api.md](history-api.md)（undo/redo は index 遷移のみの純粋関数）
- custom コマンド前例: リポジトリ直下 `plans/2026-03-08-20-05_extensible-history-commands.md`
  （旧 CustomCommandHandler は ctx 変異方式。本設計では結果を返す executor 方式に改める）
