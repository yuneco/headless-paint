# Filter Pipeline API

入力点にフィルタ処理（スムージング等）を適用するパイプライン。

## 概要

### 設計思想

フィルタパイプラインは入力点の前処理を行う。処理結果は「確定点」と「未確定点」に分離される。

```
入力点 (InputPoint)
       │
       ▼
 ┌─────────────────────────────────────────────────┐
 │     Filter Pipeline (filters: [...])            │
 │  ┌─────────┐   ┌─────────┐   ┌─────────┐        │
 │  │filter[0]│ → │filter[1]│ → │filter[2]│ → ...  │
 │  └─────────┘   └─────────┘   └─────────┘        │
 └─────────────────────────────────────────────────┘
       │
       ▼
   FilterOutput { committed, pending }
```

### committed と pending

- **committed**: 座標確定済み。以降の入力で座標が変わることはない。
- **pending**: 未確定。後続の入力により座標が変わる可能性がある。

スムージングの場合、直近の数点が pending となる：

```
入力: ●──●──●──●──●──●──●
              └──committed──┘ └─pending─┘
                 (確定)         (未確定)
```

### expand との違い

| | filter | expand |
|---|---|---|
| 処理 | N点 → M点 | 1点 → K点 |
| タイミング | 入力時 | 描画時 |
| 状態 | ステートフル | ステートレス |
| 出力 | committed/pending分離 | 単純な配列 |
| 担当パッケージ | input | engine |

---

## compileFilterPipeline

フィルタパイプライン設定をコンパイルする。設定変更時に1回だけ呼び出す。

```typescript
function compileFilterPipeline(config: FilterPipelineConfig): CompiledFilterPipeline
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `config` | `FilterPipelineConfig` | ○ | パイプライン設定 |

**戻り値**: `CompiledFilterPipeline` - コンパイル済みパイプライン

**使用例**:
```typescript
import { compileFilterPipeline } from "@headless-paint/input";

// スムージングを含むパイプライン
const compiled = compileFilterPipeline({
  filters: [
    { type: "smoothing", config: { windowSize: 5 } }
  ]
});

// フィルタなし（通常ペイント）
const noFilter = compileFilterPipeline({ filters: [] });
```

---

## createFilterPipelineState

パイプラインの初期状態を作成する。ストローク開始時に呼び出す。

```typescript
function createFilterPipelineState(compiled: CompiledFilterPipeline): FilterPipelineState
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `compiled` | `CompiledFilterPipeline` | ○ | コンパイル済みパイプライン |

**戻り値**: `FilterPipelineState` - 初期状態

**使用例**:
```typescript
// ストローク開始時
let pipelineState = createFilterPipelineState(compiled);
```

---

## processPoint

入力点をパイプラインで処理する。

```typescript
function processPoint(
  state: FilterPipelineState,
  point: InputPoint,
  compiled: CompiledFilterPipeline
): FilterProcessResult
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `FilterPipelineState` | ○ | 現在の状態 |
| `point` | `InputPoint` | ○ | 入力点 |
| `compiled` | `CompiledFilterPipeline` | ○ | コンパイル済みパイプライン |

**戻り値**: `FilterProcessResult`
- `state`: 次の呼び出しに渡す状態
- `output`: `{ committed, pending }` - 確定点と未確定点

**使用例**:
```typescript
const result = processPoint(pipelineState, {
  x: 100,
  y: 100,
  pressure: 0.8,
  timestamp: Date.now()
}, compiled);

pipelineState = result.state;
// result.output.committed - 新しく確定した点
// result.output.pending - 現在未確定の点
```

---

## finalizePipeline

パイプラインを終了し、残りの未確定点を確定する。ストローク終了時に呼び出す。

```typescript
function finalizePipeline(
  state: FilterPipelineState,
  compiled: CompiledFilterPipeline
): FilterOutput
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `FilterPipelineState` | ○ | 現在の状態 |
| `compiled` | `CompiledFilterPipeline` | ○ | コンパイル済みパイプライン |

**戻り値**: `FilterOutput` - 全ての点が committed に入り、pending は空

**使用例**:
```typescript
// ストローク終了時
const finalOutput = finalizePipeline(pipelineState, compiled);
// finalOutput.committed - 全ての確定点
// finalOutput.pending - []（空）
```

---

## processAllPoints

全ての入力点を一括処理する。履歴リプレイ用。

```typescript
function processAllPoints(
  points: readonly InputPoint[],
  compiled: CompiledFilterPipeline
): InputPoint[]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `points` | `readonly InputPoint[]` | ○ | 入力点列 |
| `compiled` | `CompiledFilterPipeline` | ○ | コンパイル済みパイプライン |

**戻り値**: `InputPoint[]` - 処理後の点列（全て確定済み）

**使用例**:
```typescript
// 履歴からリプレイ
const filteredPoints = processAllPoints(command.inputPoints, compiled);
```

---

## 典型的な使用パターン

```typescript
import {
  compileFilterPipeline,
  createFilterPipelineState,
  processPoint,
  finalizePipeline,
} from "@headless-paint/input";

// パイプラインをコンパイル（設定変更時のみ）
const compiled = useMemo(() => {
  return compileFilterPipeline({
    filters: smoothingEnabled
      ? [{ type: "smoothing", config: { windowSize: 5 } }]
      : []
  });
}, [smoothingEnabled]);

let pipelineState: FilterPipelineState | null = null;

// ストローク開始
function onPointerDown(e: PointerEvent) {
  pipelineState = createFilterPipelineState(compiled);

  const result = processPoint(pipelineState, {
    x: e.offsetX,
    y: e.offsetY,
    pressure: e.pressure,
    timestamp: e.timeStamp
  }, compiled);

  pipelineState = result.state;
  // result.output を stroke パッケージに渡す
}

// ストローク中
function onPointerMove(e: PointerEvent) {
  if (!pipelineState) return;

  const result = processPoint(pipelineState, {
    x: e.offsetX,
    y: e.offsetY,
    pressure: e.pressure,
    timestamp: e.timeStamp
  }, compiled);

  pipelineState = result.state;
  // result.output を stroke パッケージに渡す
}

// ストローク終了
function onPointerUp() {
  if (!pipelineState) return;

  const finalOutput = finalizePipeline(pipelineState, compiled);
  pipelineState = null;
  // finalOutput を stroke パッケージに渡す
}
```

---

## 型定義

### FilterType / FilterConfig

```typescript
type FilterType = "smoothing" | "straight-line";

type FilterConfig =
  | { type: "smoothing"; config: SmoothingConfig }
  | { type: "straight-line"; config: StraightLineConfig };

interface FilterPipelineConfig {
  readonly filters: readonly FilterConfig[];
}
```

---

## プラグインシステム

新しいフィルタの追加は `plugins/` ディレクトリにファイルを追加し、レジストリに登録するだけ。

### FilterPlugin インターフェース

```typescript
interface FilterPlugin {
  readonly type: string;
  createState(config: unknown): FilterState;
  process(state: FilterState, point: InputPoint): FilterStepResult;
  finalize(state: FilterState): FilterStepResult;
}

interface FilterState {
  // フィルタ固有の状態
}

interface FilterStepResult {
  readonly state: FilterState;
  readonly committed: readonly InputPoint[];
  readonly pending: readonly InputPoint[];
}
```

### プラグイン登録

```typescript
// plugins/index.ts
import { smoothingPlugin } from "./smoothing-plugin";

const plugins = new Map<string, FilterPlugin>();
plugins.set("smoothing", smoothingPlugin);

export function getFilterPlugin(type: string): FilterPlugin {
  const plugin = plugins.get(type);
  if (!plugin) throw new Error(`Unknown filter type: ${type}`);
  return plugin;
}

export function registerFilterPlugin(plugin: FilterPlugin): void {
  plugins.set(plugin.type, plugin);
}
```

### 組み込みプラグイン

#### smoothing

入力点に移動平均を適用してストロークを滑らかにする。window 内の点を重み付き平均で計算し、window を超えた点から順に committed として確定する。

```typescript
// FilterType: "smoothing"
interface SmoothingConfig {
  /** 移動平均のウィンドウサイズ（3以上の奇数推奨） */
  readonly windowSize: number;
}
```

#### straight-line

入力点を直線（始点→終点の2点）に集約する。描画中は committed を空に保ち、pending に始点→現在点のプレビューを出力する。finalize 時に2点を committed として確定する。

筆圧はストローク中に蓄積した全入力の中央値を適用する。外れ値に強く、安定した太さの直線が得られる。

```typescript
// FilterType: "straight-line"
interface StraightLineConfig {}
```

| フェーズ | committed | pending | 説明 |
|----------|-----------|---------|------|
| 1点目 | `[]` | `[p1']` | 点を pending に保持 |
| N点目 | `[]` | `[start', pN']` | 始点→現在点のプレビュー |
| finalize | `[start', end']` | `[]` | 2点を確定（中央値筆圧） |

`p'` = 筆圧を中央値に置換した点。

**Replay（Undo/Redo）**: `processAllPoints` に全 raw inputPoints を通すと finalize まで実行され、2点だけ返る。既存の replay 関数は変更不要。

### プラグイン実装例（smoothing）

```typescript
// plugins/smoothing-plugin.ts
import type { FilterPlugin, InputPoint, FilterState, FilterStepResult } from "../types";

interface SmoothingState extends FilterState {
  buffer: InputPoint[];
  windowSize: number;
}

export const smoothingPlugin: FilterPlugin = {
  type: "smoothing",

  createState(config: { windowSize: number }): SmoothingState {
    return {
      buffer: [],
      windowSize: config.windowSize,
    };
  },

  process(state: SmoothingState, point: InputPoint): FilterStepResult {
    const buffer = [...state.buffer, point];
    const committed: InputPoint[] = [];

    // windowSizeを超えた点は確定
    while (buffer.length > state.windowSize) {
      const oldest = buffer.shift()!;
      // 移動平均を計算して確定点を生成
      committed.push(calculateSmoothed(buffer, oldest));
    }

    return {
      state: { ...state, buffer },
      committed,
      pending: calculatePendingSmoothed(buffer),
    };
  },

  finalize(state: SmoothingState): FilterStepResult {
    // 残りのバッファを全て確定
    return {
      state: { ...state, buffer: [] },
      committed: flushBuffer(state.buffer),
      pending: [],
    };
  },
};
```
