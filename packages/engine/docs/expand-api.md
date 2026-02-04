# Expand API

入力点を対称展開する関数群。描画時に適用される。

## 概要

### 設計思想

Expandは「1点→N点」の展開処理であり、描画時に適用される。これはフィルタ処理（N点→M点、入力時に適用）とは根本的に異なる処理モデル。

```
入力点 → filter（入力時） → 1ストローク → expand（描画時） → N本の描画
```

WebGLで例えると：
- **filter**: 頂点シェーダー的（入力の前処理）
- **expand**: 描画パイプライン内処理（出力の展開）

### 遅延適用の利点

- セッション管理がシンプル（常に1本のストローク）
- pending/committed の管理が容易
- 履歴には入力点のみ保存し、リプレイ時に再展開

---

## compileExpand

展開設定を事前コンパイルする。設定変更時に1回だけ呼び出す。

```typescript
function compileExpand(config: ExpandConfig): CompiledExpand
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `config` | `ExpandConfig` | ○ | 展開設定 |

**戻り値**: `CompiledExpand` - コンパイル済み展開設定

**使用例**:
```typescript
import { compileExpand } from "@headless-paint/engine";

// 6分割の回転対称
const compiled = compileExpand({
  mode: "radial",
  origin: { x: 500, y: 500 },
  angle: 0,
  divisions: 6,
});

// 展開なし
const noExpand = compileExpand({
  mode: "none",
  origin: { x: 0, y: 0 },
  angle: 0,
  divisions: 1,
});
```

---

## expandPoint

単一の点を展開する。

```typescript
function expandPoint(point: Point, compiled: CompiledExpand): Point[]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `point` | `Point` | ○ | 入力点（Layer Space） |
| `compiled` | `CompiledExpand` | ○ | コンパイル済み展開設定 |

**戻り値**: `Point[]` - 展開された点の配列

**使用例**:
```typescript
const expandedPoints = expandPoint({ x: 100, y: 100 }, compiled);
// 6分割対称なら6点の配列が返る
```

---

## expandStroke

ストローク全体を展開する。

```typescript
function expandStroke(
  points: readonly Point[],
  compiled: CompiledExpand
): Point[][]
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `points` | `readonly Point[]` | ○ | 入力点列 |
| `compiled` | `CompiledExpand` | ○ | コンパイル済み展開設定 |

**戻り値**: `Point[][]` - 展開されたストローク群（各ストロークは点の配列）

**使用例**:
```typescript
// 元のストローク
const inputPoints = [
  { x: 100, y: 100 },
  { x: 150, y: 120 },
  { x: 200, y: 110 },
];

// 展開（6分割対称なら6本のストロークになる）
const strokes = expandStroke(inputPoints, compiled);

// 各ストロークを描画
for (const stroke of strokes) {
  drawPath(layer, stroke, color, lineWidth);
}
```

---

## getExpandCount

展開設定の出力数を取得する。

```typescript
function getExpandCount(config: ExpandConfig): number
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `config` | `ExpandConfig` | ○ | 展開設定 |

**戻り値**: `number` - 1入力あたりの出力数

**モード別出力数**:
| モード | 出力数 |
|--------|--------|
| `none` | 1 |
| `axial` | 2 |
| `radial` | divisions |
| `kaleidoscope` | divisions × 2 |

---

## createDefaultExpandConfig

デフォルトの展開設定を作成する。

```typescript
function createDefaultExpandConfig(width: number, height: number): ExpandConfig
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `width` | `number` | ○ | レイヤーの幅 |
| `height` | `number` | ○ | レイヤーの高さ |

**戻り値**: `ExpandConfig` - mode="none"、origin=中心点の設定

**使用例**:
```typescript
const config = createDefaultExpandConfig(1920, 1080);
// { mode: "none", origin: { x: 960, y: 540 }, angle: 0, divisions: 1 }
```
