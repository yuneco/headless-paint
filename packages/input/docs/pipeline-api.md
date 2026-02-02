# ストローク変換パイプライン API

入力点を複数のストロークに展開する変換パイプラインです。対称ペイント、スムージングなどの変換を直列に適用できます。

## 概要

### 設計思想

全てのペイント操作を「座標変換のバリエーション」として統一的に扱います：

- **通常ペイント** = identity 変換（変換なし）
- **対称ペイント** = 1入力 → N出力 の変換
- **スムージング** = 点列の平滑化（将来）
- **パターン描画** = 繰り返し変換（将来）

これにより、変換の種類が増えてもアプリ層のコードは変わらず、変換設定をシリアライズして履歴に保存できます。

### パイプラインの流れ

```
User Input (Point)
       │
       ▼
 ┌─────────────────────────────────────────────────┐
 │     Stroke Pipeline (transforms: [...])          │
 │  ┌─────────┐   ┌─────────┐   ┌─────────┐        │
 │  │ trans[0]│ → │ trans[1]│ → │ trans[2]│ → ...  │
 │  └─────────┘   └─────────┘   └─────────┘        │
 └─────────────────────────────────────────────────┘
       │
       ▼
   Point[][] (展開されたストローク群)
       │
       ▼
   StrokeSession (ストローク管理)
       │
       ▼
   StrokeCommand (履歴保存: 入力ストローク + 設定のみ)
```

---

## コンパイル関数

### compilePipeline

パイプライン設定を事前コンパイルする。設定変更時に1回だけ呼び出す。

```typescript
function compilePipeline(config: PipelineConfig): CompiledPipeline
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `config` | `PipelineConfig` | ○ | パイプライン設定 |

**戻り値**: `CompiledPipeline` - コンパイル済みパイプライン

**使用例**:
```typescript
import { compilePipeline } from "@headless-paint/input";

// 対称変換を含むパイプライン
const compiled = compilePipeline({
  transforms: [
    { type: "symmetry", config: symmetryConfig }
  ]
});

// 変換なしのパイプライン（通常ペイント）
const identityPipeline = compilePipeline({ transforms: [] });
```

---

## 展開関数

### expandPoint

単一の点をパイプラインで展開する。ストローク中の各点で呼び出す（高速）。

```typescript
function expandPoint(point: Point, compiled: CompiledPipeline): Point[]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `point` | `Point` | ○ | 入力点（Layer Space） |
| `compiled` | `CompiledPipeline` | ○ | コンパイル済みパイプライン |

**戻り値**: `Point[]` - 展開された点の配列（変換なしの場合は1要素）

**使用例**:
```typescript
const expandedPoints = expandPoint({ x: 100, y: 100 }, compiled);
// 6分割の対称なら6点に展開される
```

### expandStroke

ストローク全体をパイプラインで展開する。履歴リプレイ時に使用。

```typescript
function expandStroke(
  inputPoints: readonly Point[],
  compiled: CompiledPipeline
): Point[][]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `inputPoints` | `readonly Point[]` | ○ | 入力点列 |
| `compiled` | `CompiledPipeline` | ○ | コンパイル済みパイプライン |

**戻り値**: `Point[][]` - 展開されたストローク群

**使用例**:
```typescript
// 履歴からリプレイ
const strokes = expandStroke(command.inputPoints, compiled);
for (const stroke of strokes) {
  drawPath(layer, stroke, color, lineWidth);
}
```

---

## セッション管理

ストローク中の状態管理を行う関数群です。展開された複数のストロークを追跡し、最終的に有効なストロークのみを返します。

### startStrokeSession

新しいストロークセッションを開始する。

```typescript
function startStrokeSession(
  point: Point,
  compiled: CompiledPipeline
): StrokeSessionResult
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `point` | `Point` | ○ | 最初の入力点（Layer Space） |
| `compiled` | `CompiledPipeline` | ○ | コンパイル済みパイプライン |

**戻り値**: `StrokeSessionResult`
- `state`: 次の呼び出しに渡すセッション状態
- `expandedStrokes`: 現在の展開済みストローク群（描画用）

### addPointToSession

セッションに点を追加する。

```typescript
function addPointToSession(
  state: StrokeSessionState,
  point: Point,
  compiled: CompiledPipeline
): StrokeSessionResult
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `StrokeSessionState` | ○ | 現在のセッション状態 |
| `point` | `Point` | ○ | 追加する入力点（Layer Space） |
| `compiled` | `CompiledPipeline` | ○ | コンパイル済みパイプライン |

**戻り値**: `StrokeSessionResult`

### endStrokeSession

セッションを終了し、履歴保存用のデータを取得する。

```typescript
function endStrokeSession(state: StrokeSessionState): StrokeSessionEndResult
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `state` | `StrokeSessionState` | ○ | 現在のセッション状態 |

**戻り値**: `StrokeSessionEndResult`
- `inputPoints`: 元の入力点列（履歴保存用）
- `validStrokes`: 有効な（2点以上の）ストローク群
- `pipelineConfig`: 使用したパイプライン設定

---

## アプリ層での使用例

```typescript
import {
  compilePipeline,
  startStrokeSession,
  addPointToSession,
  endStrokeSession,
  screenToLayer,
} from "@headless-paint/input";
import { createStrokeCommand, pushCommand } from "@headless-paint/history";

// パイプラインをコンパイル（設定変更時のみ）
const compiled = useMemo(() => {
  const transforms: TransformConfig[] = [];
  if (symmetryConfig.mode !== "none") {
    transforms.push({ type: "symmetry", config: symmetryConfig });
  }
  return compilePipeline({ transforms });
}, [symmetryConfig]);

// ストローク開始
function onPointerDown(e: PointerEvent) {
  const point = screenToLayer({ x: e.offsetX, y: e.offsetY }, transform);
  if (!point) return;

  const result = startStrokeSession(point, compiled);
  sessionRef.current = result.state;
  drawStrokes(result.expandedStrokes);
}

// ストローク中
function onPointerMove(e: PointerEvent) {
  if (!sessionRef.current) return;

  const point = screenToLayer({ x: e.offsetX, y: e.offsetY }, transform);
  if (!point) return;

  const result = addPointToSession(sessionRef.current, point, compiled);
  sessionRef.current = result.state;
  drawStrokes(result.expandedStrokes);
}

// ストローク終了
function onPointerUp() {
  if (!sessionRef.current) return;

  const { inputPoints, validStrokes, pipelineConfig } = endStrokeSession(sessionRef.current);
  sessionRef.current = null;

  if (validStrokes.length > 0) {
    // 履歴に保存（入力点とパイプライン設定のみ）
    const command = createStrokeCommand(inputPoints, pipelineConfig, color, lineWidth);
    pushCommand(historyState, command, layer, config);
  }
}
```

---

## 履歴保存の効率性

従来の方式では展開後の全点を保存していましたが、パイプラインAPIでは：

| 項目 | 従来（BatchCommand） | 新方式（StrokeCommand） |
|------|---------------------|------------------------|
| 保存データ | 展開後の全ストローク | 入力点 + パイプライン設定 |
| 6分割対称の場合 | 6倍のデータ | 1倍 + 設定オブジェクト |
| 再計算 | 不可能 | 可能（リプレイ時に展開） |

---

## 将来の拡張

パイプラインは以下の変換を追加可能な設計です：

```typescript
type TransformConfig =
  | { type: "symmetry"; config: SymmetryConfig }
  | { type: "smoothing"; config: SmoothingConfig }  // 将来
  | { type: "pattern"; config: PatternConfig }      // 将来
```

変換は配列の順序で直列適用されます：

```typescript
compilePipeline({
  transforms: [
    { type: "smoothing", config: { strength: 0.5 } },  // 1. まず平滑化
    { type: "symmetry", config: symmetryConfig },       // 2. 次に対称展開
  ]
});
```

---

## 設計上の注記

### Samplingとの関係

現状、`shouldAcceptPoint()` による間引きとパイプラインは独立したAPIです。
将来的に間引きをパイプラインの一段階として統合する可能性がありますが、
現時点では間引きはアプリ層で明示的に呼び出す設計としています。

### historyパッケージとの依存関係

`StrokeCommand` のリプレイには `compilePipeline()` と `expandStroke()` が必要です。
これによりhistory → inputの依存が生じますが、設計上意図的な依存です。
