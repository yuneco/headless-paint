# stroke-machine / stroke-runtime 設計（WS2・Phase 1 ドラフト)

> ステータス: IF 設計ドラフト。「ストローク中割り込み仕様表」（paint-app
> `plans/2026-07-05-ws2-phase1-review.md`）のユーザーレビュー完了後に実装へ進む。
> 参照実装: `packages/react/src/useStrokeSession.ts`（SessionInternal）。
> 状態機械の先例: `packages/input/src/gesture.ts`（純関数・判別共用体・phase 別 handler）。

## 層の分業

```
stroke-machine.ts   純粋遷移関数。状態は判断材料のみ（phase/点数/設定スナップショット/layerId）。
                    ピクセル・canvas・タイマー・乱数を一切持たない
stroke-runtime.ts   命令的シェル。可変セル（brushState/committedSnapshot/samplingLayer/
                    filterState/strokeSession）とタイマーを所有。deps 注入で決定化可能
```

## stroke-machine

```ts
type StrokePhase =
  | { readonly phase: "idle" }
  | { readonly phase: "active";
      readonly layerId: string;
      readonly pendingOnly: boolean;   // 直線ツール等の pending 蓄積モード
      readonly hasEmission: boolean;   // 吹きつけあり（move 時の schedule-emission 判定）
      readonly pointCount: number };

type StrokeMachineEvent =
  | { readonly type: "start"; readonly layerId: string; readonly pendingOnly: boolean; readonly hasEmission: boolean }
  | { readonly type: "move" }              // 実入力・emission 合成点の区別は machine では不要
  | { readonly type: "confirm" }           // pendingOnly → 通常 active へ（直線確定）
  | { readonly type: "end" }
  | { readonly type: "cancel" }
  | { readonly type: "dispose" };

type StrokeMachineEffect =
  | { readonly type: "snapshot-layer" }         // cancel 復元 + mixing サンプリング元の捕捉
  | { readonly type: "append-committed" }       // チャンク追記
  | { readonly type: "render-pending" }
  | { readonly type: "schedule-emission" } | { readonly type: "cancel-emission" }
  | { readonly type: "schedule-render" }        // rAF coalesce
  | { readonly type: "finalize-commit" }        // end: 確定描画 + StrokeCommand 生成
  | { readonly type: "restore-snapshot" }       // cancel
  | { readonly type: "drawing-changed"; readonly isDrawing: boolean };

interface StrokeTransitionResult {
  readonly next: StrokePhase;
  readonly effects: readonly StrokeMachineEffect[];
}

function createInitialStrokePhase(): StrokePhase;
function transitionStroke(state: StrokePhase, event: StrokeMachineEvent): StrokeTransitionResult;
```

不正イベント（idle への move/end/cancel/confirm 等）は「no-op + 空 effects」。
active 中の start（多重開始）は前ストロークを auto-cancel（`cancel-emission` + `restore-snapshot`）
してから新規 start の effects を続ける。

## stroke-runtime

```ts
createStrokeRuntime(deps: StrokeRuntimeDeps): StrokeRuntime

interface StrokeRuntimeDeps {
  readonly setTimeout: (fn, ms) => unknown;   // 決定的テスト用に注入
  readonly clearTimeout: (id) => void;
  readonly now: () => number;                  // emission 合成点の timestamp
  readonly requestRender: () => void;          // rAF coalesce は呼び出し側実装でも可
  readonly onCommit: (command: StrokeCommand) => void;
  readonly onDrawingChanged: (isDrawing: boolean) => void;
  readonly randomSeed?: () => number;          // brushSeed 省略時の seed 生成を注入
}

interface StrokeRuntime {
  start(point: InputPoint, config: StrokeStartConfig): void;
  move(point: InputPoint): void;
  confirm(): void;
  end(): void;
  cancel(): void;
  dispose(): void;    // timer/rAF/セッション/スナップショットを確実に破棄
  readonly isDrawing: boolean;
}

interface StrokeStartConfig {
  readonly layer: Layer;              // ★参照ごと凍結（layerId 引き直しをやめる）
  readonly pendingLayer: Layer;
  readonly style: StrokeStyle;
  readonly filterPipeline: FilterPipelineConfig;   // compile はruntime内
  readonly expand: ExpandConfig;
  readonly alphaLocked: boolean;
  readonly brushSeed?: number;        // 省略時 runtime が生成。テストでは固定注入
  readonly pendingOnly?: boolean;
}
```

### 設計判断

- **layer 参照は start 時に凍結**: 現行 app はストローク中も layerId で active entry を
  引き直すため、レイヤー選択切替で「コミットも復元もされない宙ぶらりん」が起きる。
  runtime が Layer 参照を保持することで、割り込み仕様「凍結続行」が構造的に成立する
- **emission timer は runtime 所有**: 現行の「モジュールグローバル + 自己 set 回避ハック」を
  廃止。runtime インスタンスは document session 単位で生成し、close/reset/unmount で必ず
  `dispose()`（旧 doc のタイマーが新 doc に触るクロス汚染を構造的に排除）
- **brushSeed / 合成点 timestamp は deps 経由**で決定化（パリティ・emission テスト用）
- **style/pipeline/expand/alphaLocked は start 時にスナップショット**（現行と同じ凍結仕様）

### live≠replay 統一: canonical incremental path（WS0-3 既知非等価の解消・レビュー対象）

runtime に「**1点ずつ feed するインクリメンタル描画関数**」を1つ定義し、live（入力到着ごと）と
replay（記録済み inputPoints のループ）が**同じ関数を通る**構成にする。

- 非等価の真因は、live のチャンク境界が入力イベントのタイミング依存で replay から
  再現不能なこと。分割を `addPointToSession` の決定的ロジック（点数・幾何のみ）に
  一本化すれば、描画呼び出し列が構造的に同一になり seed 固定でビット一致する
- 成立根拠: 合成点（emission）は inputPoints に記録済み / brushSeed 記録済み /
  フィルタは両側とも逐次処理（processPoint + finalizePipeline）に統一 / コマンド JSON 無変更
- `replayCommand` の stroke 処理はこのインクリメンタル関数のループ呼び出しに置き換える
  （processAllPoints + 一発 appendToCommittedLayer を廃止）
- ストローク終了時に描線が動かない（finalize-by-replay 案はこの点で棄却、レビュー質疑参照）
- 影響: 過去に保存されたドキュメントの再構築結果が1回だけ AA 縁レベルで変わる（承認事項）。
  rebuild コストは live 実描画と同オーダー
- move(point) は**単一点 feed を canonical** とする（coalesced events は呼び出し側で1点ずつ渡す）

## テスト計画（Phase 3 で実装）

- machine: idle/active × 全 event の遷移網羅（純関数、モックなし）
- runtime: 注入 clock/setTimeout による emission 決定化テスト（入力が rate より速い間は
  発火しない / 静止時は継続 / end・cancel・dispose 後は発火しない）
- lifecycle: dispose 後に timer が発火しない、2つの runtime が互いに干渉しない
- パリティ: canonical path 導入後、parity.test.ts の (a) it.fails を「ビット一致の通常 it」へ昇格
