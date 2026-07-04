# stroke-machine / stroke-runtime 設計（WS2・Phase 1 ドラフト)

> ステータス: IF 設計ドラフト。「ストローク中割り込み仕様表」（paint-app
> `plans/2026-07-05-ws2-phase1-review.md`）のユーザーレビュー完了後に実装へ進む。
> 参照実装: `packages/react/src/useStrokeSession.ts`（SessionInternal）。
> 状態機械の先例: `packages/input/src/gesture.ts`（純遷移関数 `(state, event) => [next, effects]`）。

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
      readonly pointCount: number };

type StrokeMachineEvent =
  | { type: "start"; layerId: string; pendingOnly: boolean; hasEmission: boolean }
  | { type: "move" }              // 実入力・emission 合成点の区別は machine では不要
  | { type: "confirm" }           // pendingOnly → 通常 active へ（直線確定）
  | { type: "end" }
  | { type: "cancel" }
  | { type: "dispose" };

type StrokeMachineEffect =
  | { type: "snapshot-layer" }         // cancel 復元 + mixing サンプリング元の捕捉
  | { type: "append-committed" }       // チャンク追記
  | { type: "render-pending" }
  | { type: "schedule-emission" } | { type: "cancel-emission" }
  | { type: "schedule-render" }        // rAF coalesce
  | { type: "finalize-commit" }        // end: 確定描画 + StrokeCommand 生成
  | { type: "restore-snapshot" }       // cancel
  | { type: "drawing-changed"; isDrawing: boolean };

transitionStroke(state, event) => { next: StrokePhase; effects: readonly StrokeMachineEffect[] }
```

不正イベント（idle への move/end 等、active 中の start=多重開始）は「no-op + 空 effects」。
多重 start は前ストロークを auto-cancel してから開始する案もあるが、仕様表レビューで確定する。

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

### live≠replay 統一（WS0-3 既知非等価の解消・レビュー対象）

推奨案「**finalize-by-replay**」: ストローク中は現行どおりチャンク描画（書き味・性能を維持）し、
**end 時に committedSnapshot を復元してから replay と同一の一発描画で確定**する。

- ストローク中の見た目と確定結果の差は AA 縁レベル（WS0-3 実測）で、確定瞬間の変化は知覚不能
- **replay 実装は無変更** → 保存済みドキュメントの再現が変わらない（互換面で最重要）
- 確定後のレイヤー内容 = replay 結果になるため、undo→redo でピクセルが動く現象が消える。
  パリティテスト (a) の it.fails が green 化する見込み
- コスト: end 時に snapshot 復元 + 全点一発描画が1回（O(n)、直線 confirm が既にこの形）

代替案は仕様表レビュー md 参照（②replay をチャンク化に合わせる ③live を pending 蓄積化）。

## テスト計画（Phase 3 で実装）

- machine: idle/active × 全 event の遷移網羅（純関数、モックなし）
- runtime: 注入 clock/setTimeout による emission 決定化テスト（入力が rate より速い間は
  発火しない / 静止時は継続 / end・cancel・dispose 後は発火しない）
- lifecycle: dispose 後に timer が発火しない、2つの runtime が互いに干渉しない
- パリティ: finalize-by-replay 導入後、parity.test.ts の (a) it.fails を通常 it へ戻す
