# Checkpoint API

チェックポイントの作成と復元に関するAPI。

## createCheckpoint

レイヤーの現在状態からチェックポイントを作成。

```typescript
function createCheckpoint(
  layer: Layer,
  commandIndex: number,
): Checkpoint
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `layer` | `Layer` | スナップショットを取得するレイヤー |
| `commandIndex` | `number` | 対応するコマンドのインデックス |

### 戻り値

`Checkpoint` - レイヤーのImageDataを含むチェックポイント

### 使用例

```typescript
import { createCheckpoint } from "@headless-paint/history";
import { createLayer } from "@headless-paint/engine";

const layer = createLayer(1920, 1080);
// ... 描画処理 ...

const checkpoint = createCheckpoint(layer, 9);
console.log(checkpoint.id);           // "cp_1706745600000_1"
console.log(checkpoint.commandIndex); // 9
console.log(checkpoint.imageData);    // ImageData { width: 1920, height: 1080, ... }
```

### 注意事項

- 一意なIDが自動生成される
- ImageDataはレイヤーの完全なコピー
- メモリ使用量: `width × height × 4` bytes

## restoreFromCheckpoint

チェックポイントからレイヤーを復元。

```typescript
function restoreFromCheckpoint(
  layer: Layer,
  checkpoint: Checkpoint,
): void
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `layer` | `Layer` | 復元先のレイヤー |
| `checkpoint` | `Checkpoint` | 復元元のチェックポイント |

### 使用例

```typescript
import { restoreFromCheckpoint } from "@headless-paint/history";

// チェックポイントからレイヤーを復元
restoreFromCheckpoint(layer, checkpoint);
```

### 注意事項

- レイヤーの既存内容は完全に上書きされる
- レイヤーのサイズがチェックポイントと一致している必要がある
