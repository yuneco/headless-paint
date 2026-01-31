# Debug API

デバッグUI向けのAPI。

## getHistoryEntries

デバッグUI用の履歴エントリ一覧を取得。

```typescript
function getHistoryEntries(
  state: HistoryState,
): readonly HistoryEntry[]
```

### 戻り値

```typescript
interface HistoryEntry {
  readonly index: number;
  readonly command: Command;
  readonly hasCheckpoint: boolean;
  readonly thumbnailDataUrl?: string;
}
```

### 使用例

```typescript
const entries = getHistoryEntries(historyState);
entries.forEach(entry => {
  console.log(`${entry.index}: ${getCommandLabel(entry.command)}`);
  if (entry.hasCheckpoint) {
    console.log("  Has checkpoint");
  }
});
```

## estimateMemoryUsage

メモリ使用量を推定。

```typescript
function estimateMemoryUsage(
  state: HistoryState,
): MemoryUsageInfo
```

### 戻り値

```typescript
interface MemoryUsageInfo {
  readonly checkpointsBytes: number;   // Checkpoint の合計バイト数
  readonly commandsBytes: number;      // Command の概算バイト数
  readonly totalBytes: number;         // 合計
  readonly formatted: string;          // 表示用文字列 (例: "12.5 MB")
}
```

### 計算方法

- **Checkpoint**: `width × height × 4` bytes per checkpoint
- **Command**: 基本100bytes + (drawPathの場合) `points.length × 16` bytes

### 使用例

```typescript
const usage = estimateMemoryUsage(historyState);
console.log(`Total: ${usage.formatted}`);
console.log(`Checkpoints: ${usage.checkpointsBytes} bytes`);
console.log(`Commands: ${usage.commandsBytes} bytes`);
```

## generateThumbnailDataUrl

ImageDataからサムネイル用のData URLを生成。

```typescript
function generateThumbnailDataUrl(
  imageData: ImageData,
  maxWidth: number,
  maxHeight: number,
): string
```

### パラメータ

| 名前 | 型 | 説明 |
|------|-----|------|
| `imageData` | `ImageData` | 元の画像データ |
| `maxWidth` | `number` | サムネイルの最大幅 |
| `maxHeight` | `number` | サムネイルの最大高さ |

### 戻り値

`string` - `data:image/png;base64,...` 形式のData URL

### 使用例

```typescript
// 24x24px のサムネイルを生成
const thumbnailUrl = generateThumbnailDataUrl(
  checkpoint.imageData,
  24,
  24
);

// <img> タグで使用
<img src={thumbnailUrl} alt="Thumbnail" />
```

### 注意事項

- アスペクト比は維持される
- 背景は白で塗りつぶされる（透過部分を見やすく）
- PNG形式で出力
