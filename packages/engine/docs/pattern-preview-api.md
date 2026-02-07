# Pattern Preview API

レイヤーの外側（UI背景色の領域）にレイヤー内容をパターンとしてタイル状に半透明描画する機能です。パターンエディタとしてレイヤーを使う際のプレビューに利用します。

## 型定義

### PatternMode

```typescript
type PatternMode = "none" | "grid" | "repeat-x" | "repeat-y";
```

| 値 | 説明 |
|---|---|
| `"none"` | パターンプレビュー無効 |
| `"grid"` | xy平面全体にタイル敷き詰め（Canvas `"repeat"`） |
| `"repeat-x"` | 横方向のみ繰り返し = ライン横（Canvas `"repeat-x"`） |
| `"repeat-y"` | 縦方向のみ繰り返し = ライン縦（Canvas `"repeat-y"`） |

### PatternPreviewConfig

```typescript
interface PatternPreviewConfig {
  readonly mode: PatternMode;
  readonly opacity: number;   // 0.0 - 1.0
  readonly offsetX: number;   // 0.0 - 1.0, gridのみ有効（交互行の水平ずらし）
  readonly offsetY: number;   // 0.0 - 1.0, gridのみ有効（交互列の垂直ずらし）
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `mode` | `PatternMode` | パターンの繰り返しモード |
| `opacity` | `number` | パターンの不透明度（0.0-1.0） |
| `offsetX` | `number` | gridモードでの交互行水平オフセット（0.0-1.0、タイル幅に対する割合） |
| `offsetY` | `number` | gridモードでの交互列垂直オフセット（0.0-1.0、タイル高さに対する割合） |

- `offsetX` / `offsetY` はどちらか一方のみ非ゼロにする（アプリ側のsetter等で排他制御）
- `offsetX`: 奇数行を右にずらす（レンガ積みパターン）
- `offsetY`: 奇数列を下にずらす

### DEFAULT_PATTERN_PREVIEW_CONFIG

```typescript
const DEFAULT_PATTERN_PREVIEW_CONFIG: PatternPreviewConfig = {
  mode: "none",
  opacity: 0.3,
  offsetX: 0,
  offsetY: 0,
};
```

---

## createPatternTile

レイヤー内容からパターンタイルを生成する。

```typescript
function createPatternTile(
  layers: readonly Layer[],
  config: PatternPreviewConfig,
): OffscreenCanvas | null;
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layers` | `readonly Layer[]` | ○ | タイル化するレイヤー群 |
| `config` | `PatternPreviewConfig` | ○ | パターン設定 |

**戻り値**: `OffscreenCanvas | null`
- `mode === "none"` または visible レイヤーなし → `null`
- それ以外 → パターンタイル用の OffscreenCanvas

**処理内容**:
1. 全 visible レイヤーを合成して1枚のタイルを生成（背景色なし = ストロークのみ）
2. grid + `offsetX > 0`: W × 2H のメタタイルを生成（行0に基本タイル、行1に水平オフセット+ラップアラウンド）
3. grid + `offsetY > 0`: 2W × H のメタタイルを生成（列0に基本タイル、列1に垂直オフセット+ラップアラウンド）
4. それ以外: 基本タイルをそのまま返す

**オフセットメタタイル**:
- x-offset: W × 2H のメタタイル。行0に基本タイル、行1にずらしタイル（ラップアラウンド込み）
- y-offset: 2W × H のメタタイル。列0に基本タイル、列1にずらしタイル

---

## renderPatternPreview

パターンプレビューをviewport全体に描画する（レイヤー領域は除外）。

```typescript
function renderPatternPreview(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  tile: OffscreenCanvas,
  config: PatternPreviewConfig,
  transform: mat3,
  viewportWidth: number,
  viewportHeight: number,
  layerWidth: number,
  layerHeight: number,
): void;
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `ctx` | `CanvasRenderingContext2D \| OffscreenCanvasRenderingContext2D` | ○ | 描画先のコンテキスト |
| `tile` | `OffscreenCanvas` | ○ | `createPatternTile` で生成したタイル |
| `config` | `PatternPreviewConfig` | ○ | パターン設定 |
| `transform` | `mat3` | ○ | ビュー変換（DPR未調整のオリジナル） |
| `viewportWidth` | `number` | ○ | ビューポート幅（CSS pixel） |
| `viewportHeight` | `number` | ○ | ビューポート高さ（CSS pixel） |
| `layerWidth` | `number` | ○ | レイヤー幅 |
| `layerHeight` | `number` | ○ | レイヤー高さ |

**処理内容**:
1. `tile` から `ctx.createPattern(tile, repetition)` でCanvasPatternを生成
   - `grid` → `"repeat"`, `repeat-x` → `"repeat-x"`, `repeat-y` → `"repeat-y"`
2. `pattern.setTransform()` に `transform`（mat3→DOMMatrix変換）を適用
3. evenodd クリップパスでレイヤー領域を除外
   - 外枠: viewport全体の矩形
   - 内枠: transformで変換したレイヤー四隅
4. `ctx.globalAlpha = config.opacity` で半透明描画
5. `ctx.fillRect(0, 0, viewportWidth, viewportHeight)` でパターン塗りつぶし（レイヤー外のみ）

**DPR対応**:
`pattern.setTransform()` は `ctx` の既存 `scale(dpr, dpr)` と合成されるため、`transform` にはDPR未調整のオリジナルを渡す。viewportサイズもCSS pixel単位。

---

## 描画順序

Pattern Previewを組み込んだ描画パイプライン:

```
1. viewport全体をUI背景色(#f0f0f0)で塗りつぶし
2. renderPatternPreview: レイヤー領域外にパターンを半透明描画  ← NEW
3. renderLayers: レイヤー領域に背景色+レイヤー描画
4. レイヤー境界線を描画
```

**使用例**:
```typescript
import {
  createPatternTile,
  renderPatternPreview,
  renderLayers,
} from "@headless-paint/engine";

// 1. UI背景
ctx.fillStyle = "#f0f0f0";
ctx.fillRect(0, 0, viewportWidth, viewportHeight);

// 2. パターンプレビュー（レイヤー外のみ）
const tile = createPatternTile(layers, patternConfig);
if (tile) {
  renderPatternPreview(
    ctx, tile, patternConfig,
    transform,       // DPR未調整のオリジナル
    viewportWidth,   // CSS pixel
    viewportHeight,
    layerWidth, layerHeight,
  );
}

// 3. レイヤー描画
renderLayers(layers, ctx, dprTransform, { background });

// 4. 境界線
// ...
```
