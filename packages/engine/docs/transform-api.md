# Transform API

レイヤーのアフィン変換（移動・リサイズ・回転・反転）を行う関数群です。

## getContentBounds

レイヤーの非透明ピクセルの境界矩形を返す。空レイヤーは `null`。

```typescript
function getContentBounds(layer: Layer): ContentBounds | null
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 対象レイヤー |

**戻り値**: `ContentBounds | null`
- 非透明ピクセルが存在する場合: 境界矩形
- 全ピクセルが透明の場合: `null`

**最適化**:
- `Uint32Array` ビュー: `ImageData.data.buffer` を `Uint32Array` で参照し、1要素=1ピクセルで判定（ループ回数 1/4）。非透明判定は `u32[i] !== 0`（RGBA いずれかが非ゼロ）
- 4辺収束スキャン: 上→下→左→右の順に辺から内側へ走査し、非透明ピクセル発見で早期終了。左右は上下で確定した範囲内のみ走査

**使用例**:
```typescript
import { getContentBounds } from "@headless-paint/engine";

const bounds = getContentBounds(layer);
if (!bounds) {
  console.log("Layer is empty");
  return;
}
console.log(`Content: (${bounds.x}, ${bounds.y}) ${bounds.width}x${bounds.height}`);
```

---

## transformLayer

アフィン変換をレイヤーのピクセルに焼き込む。

```typescript
function transformLayer(
  layer: Layer,
  matrix: mat3,
  temp?: OffscreenCanvas,
): void
```

**引数**:
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `layer` | `Layer` | ○ | 変換対象レイヤー |
| `matrix` | `mat3` | ○ | 適用するアフィン変換行列 |
| `temp` | `OffscreenCanvas` | - | 一時的な描画バッファ。省略時は内部で作成。再利用でメモリ効率向上 |

**処理内容**:
1. レイヤーの内容を `temp` canvas にコピー
2. レイヤーをクリア
3. `ctx.setTransform(matrix)` で変換を適用して `temp` を描画

`wrapShiftLayer` と同じ temp canvas パターンを使用。

**使用例**:
```typescript
import { transformLayer } from "@headless-paint/engine";
import { mat3 } from "gl-matrix";

// 100px 右、50px 上に移動
const m = mat3.fromTranslation(mat3.create(), [100, -50]);
transformLayer(layer, m);

// temp canvas を再利用（連続呼び出し時）
const temp = new OffscreenCanvas(layer.width, layer.height);
transformLayer(layer1, m1, temp);
transformLayer(layer2, m2, temp);
```

