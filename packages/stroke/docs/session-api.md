# Session API

ストロークセッションの管理を行う関数群。

## 概要

セッションAPIは以下の責務を持つ：
- 1本のストロークの進捗管理
- committed/pending点の追跡
- 前回からの差分（newlyCommitted）の計算
- 描画更新データ（RenderUpdate）の生成

### セッションのライフサイクル

```
pointerdown → startStrokeSession
    ↓
pointermove → addPointToSession (繰り返し)
    ↓
pointerup   → endStrokeSession
```

---

## startStrokeSession

新しいストロークセッションを開始する。

```typescript
function startStrokeSession(
  filterOutput: FilterOutput,
  style: StrokeStyle,
  expand: ExpandConfig
): StrokeSessionResult
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `filterOutput` | `FilterOutput` | ○ | フィルタパイプラインの出力（最初の点） |
| `style` | `StrokeStyle` | ○ | 描画スタイル |
| `expand` | `ExpandConfig` | ○ | 展開設定（@yuneco/headless-paint/core から） |

**戻り値**: `StrokeSessionResult`
- `state`: 次の呼び出しに渡すセッション状態
- `renderUpdate`: 描画更新データ

**使用例**:
```typescript
import { startStrokeSession } from "@yuneco/headless-paint/core";
import { processPoint, createFilterPipelineState } from "@yuneco/headless-paint/core";

function onPointerDown(e: PointerEvent) {
  // フィルタパイプラインで入力を処理
  const filterResult = processPoint(pipelineState, inputPoint, compiledFilter);
  pipelineState = filterResult.state;

  // ストロークセッション開始
  const result = startStrokeSession(
    filterResult.output,
    { color, lineWidth },
    expandConfig
  );
  sessionRef.current = result.state;

  // 描画更新
  onRenderUpdate(result.renderUpdate);
}
```

---

## addPointToSession

セッションに点を追加する。

```typescript
function addPointToSession(
  state: StrokeSessionState,
  filterOutput: FilterOutput
): StrokeSessionResult
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `StrokeSessionState` | ○ | 現在のセッション状態 |
| `filterOutput` | `FilterOutput` | ○ | フィルタパイプラインの出力 |

**戻り値**: `StrokeSessionResult`

**動作**:
1. filterOutput.committed を allCommitted に追加
2. filterOutput.pending を currentPending に設定
3. lastRenderedCommitIndex からオーバーラップ点（最大3点）を含めて newlyCommitted を計算
4. `committedOverlapCount = min(3, lastRenderedCommitIndex + 1)` で利用可能なオーバーラップ点数をクランプ
5. InputPointからStrokePoint（pressure保持）に変換してRenderUpdateを生成

**使用例**:
```typescript
function onPointerMove(e: PointerEvent) {
  if (!sessionRef.current) return;

  // フィルタパイプラインで入力を処理
  const filterResult = processPoint(pipelineState, inputPoint, compiledFilter);
  pipelineState = filterResult.state;

  // セッションに追加
  const result = addPointToSession(sessionRef.current, filterResult.output);
  sessionRef.current = result.state;

  // 描画更新
  onRenderUpdate(result.renderUpdate);
}
```

---

## endStrokeSession

セッションを終了し、履歴保存用のコマンドを生成する。

```typescript
function endStrokeSession(
  state: StrokeSessionState,
  layerId: string,
  inputPoints: readonly InputPoint[],
  filterPipeline: FilterPipelineConfig
): StrokeCommand | null
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `StrokeSessionState` | ○ | 現在のセッション状態 |
| `layerId` | `string` | ○ | 描画先レイヤーの ID（コマンドに記録される） |
| `inputPoints` | `readonly InputPoint[]` | ○ | フィルタ前の入力点列（履歴保存用） |
| `filterPipeline` | `FilterPipelineConfig` | ○ | 使用したフィルタパイプライン設定 |

**戻り値**: `StrokeCommand | null`
- 有効なストローク（1点以上）の場合: `StrokeCommand`（`style.compositeOperation` も含む）
- 無効なストローク（0点）の場合: `null`

**使用例**:
```typescript
function onPointerUp() {
  if (!sessionRef.current) return;

  // フィルタパイプラインを終了
  const finalOutput = finalizePipeline(pipelineState, compiledFilter);

  // 最後のpending点を確定として処理
  const finalResult = addPointToSession(sessionRef.current, {
    committed: finalOutput.committed,
    pending: []
  });

  // 最終描画
  onRenderUpdate(finalResult.renderUpdate);

  // コマンド生成
  const command = endStrokeSession(
    finalResult.state,
    layerId,           // 描画先レイヤーのID
    allInputPoints,    // フィルタ前の全入力点
    filterPipelineConfig
  );

  sessionRef.current = null;
  pipelineState = null;

  // 履歴に追加
  if (command) {
    historyState = pushCommand(historyState, command, layer, historyConfig);
  }
}
```

---

## createTransformLayerCommand

レイヤー変換コマンドを作成する。

```typescript
function createTransformLayerCommand(
  layerId: string,
  matrix: Float32Array,
): TransformLayerCommand
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `layerId` | `string` | ○ | 対象レイヤーの ID |
| `matrix` | `Float32Array` | ○ | 適用するアフィン変換行列（gl-matrix の `mat3` と互換） |

**戻り値**: `TransformLayerCommand`

**使用例**:
```typescript
import { createTransformLayerCommand } from "@yuneco/headless-paint/core";
import { mat3 } from "gl-matrix";

const m = mat3.fromTranslation(mat3.create(), [100, -50]);
const command = createTransformLayerCommand(layer.id, m);
historyState = pushCommand(historyState, command, layer, config);
```

---

## 典型的な使用パターン

```typescript
import {
  startStrokeSession,
  addPointToSession,
  endStrokeSession,
} from "@yuneco/headless-paint/core";
import {
  compileFilterPipeline,
  createFilterPipelineState,
  processPoint,
  finalizePipeline,
} from "@yuneco/headless-paint/core";
import {
  compileExpand,
  appendToCommittedLayer,
  renderPendingLayer,
  composeLayers,
} from "@yuneco/headless-paint/core";

// 設定のコンパイル（設定変更時のみ）
const compiledFilter = compileFilterPipeline(filterConfig);
const compiledExpand = compileExpand(expandConfig);

let pipelineState: FilterPipelineState | null = null;
let sessionState: StrokeSessionState | null = null;
const inputPoints: InputPoint[] = [];

// 描画更新処理
function onRenderUpdate(update: RenderUpdate) {
  if (update.newlyCommitted.length > update.committedOverlapCount) {
    appendToCommittedLayer(
      committedLayer, update.newlyCommitted, update.style, compiledExpand,
      update.committedOverlapCount,
    );
  }
  renderPendingLayer(pendingLayer, update.currentPending, update.style, compiledExpand);
  composeLayers(displayCtx, [committedLayer, pendingLayer], viewTransform);
}

// ストローク開始
function onPointerDown(e: PointerEvent) {
  const point = createInputPoint(e);
  inputPoints.length = 0;
  inputPoints.push(point);

  pipelineState = createFilterPipelineState(compiledFilter);
  const filterResult = processPoint(pipelineState, point, compiledFilter);
  pipelineState = filterResult.state;

  const result = startStrokeSession(filterResult.output, style, expandConfig);
  sessionState = result.state;
  onRenderUpdate(result.renderUpdate);
}

// ストローク中
function onPointerMove(e: PointerEvent) {
  if (!sessionState || !pipelineState) return;

  const point = createInputPoint(e);
  inputPoints.push(point);

  const filterResult = processPoint(pipelineState, point, compiledFilter);
  pipelineState = filterResult.state;

  const result = addPointToSession(sessionState, filterResult.output);
  sessionState = result.state;
  onRenderUpdate(result.renderUpdate);
}

// ストローク終了
function onPointerUp() {
  if (!sessionState || !pipelineState) return;

  // 残りの点を確定
  const finalOutput = finalizePipeline(pipelineState, compiledFilter);
  const finalResult = addPointToSession(sessionState, {
    committed: finalOutput.committed,
    pending: []
  });
  onRenderUpdate(finalResult.renderUpdate);

  // コマンド生成
  const command = endStrokeSession(finalResult.state, layer.id, inputPoints, filterConfig);

  // クリーンアップ
  sessionState = null;
  pipelineState = null;
  clearLayer(pendingLayer);

  // 履歴に追加
  if (command) {
    historyState = pushCommand(historyState, command, layer, historyConfig);
  }
}
```
