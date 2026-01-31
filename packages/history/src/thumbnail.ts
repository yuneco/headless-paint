/**
 * ImageDataからサムネイル用のData URLを生成
 */
export function generateThumbnailDataUrl(
  imageData: ImageData,
  maxWidth: number,
  maxHeight: number,
): string {
  const { width, height } = imageData;

  // アスペクト比を維持してサイズ計算
  const scale = Math.min(maxWidth / width, maxHeight / height);
  const thumbWidth = Math.floor(width * scale);
  const thumbHeight = Math.floor(height * scale);

  // 元のImageDataをcanvasに描画
  const sourceCanvas = new OffscreenCanvas(width, height);
  const sourceCtx = sourceCanvas.getContext("2d");
  if (!sourceCtx) {
    throw new Error("Failed to get 2d context");
  }
  sourceCtx.putImageData(imageData, 0, 0);

  // サムネイル用canvasにリサイズ描画
  const thumbCanvas = new OffscreenCanvas(thumbWidth, thumbHeight);
  const thumbCtx = thumbCanvas.getContext("2d");
  if (!thumbCtx) {
    throw new Error("Failed to get 2d context");
  }

  // 背景を白で塗る（透過部分を見やすく）
  thumbCtx.fillStyle = "#ffffff";
  thumbCtx.fillRect(0, 0, thumbWidth, thumbHeight);

  thumbCtx.drawImage(sourceCanvas, 0, 0, thumbWidth, thumbHeight);

  // Data URLに変換（同期的にblobを作れないのでbase64で返す）
  const thumbImageData = thumbCtx.getImageData(0, 0, thumbWidth, thumbHeight);
  return imageDataToDataUrl(thumbImageData);
}

/**
 * ImageDataをData URLに変換
 */
function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2d context");
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
