import { getImageData } from "./layer";
import type { ContentBounds, Layer } from "./types";

/**
 * レイヤーの非透明ピクセルの境界矩形を返す。空レイヤーは null。
 *
 * 最適化:
 * - Uint32Array ビュー: ImageData.data.buffer を Uint32Array で参照し、
 *   1要素=1ピクセルで判定（ループ回数 1/4）。
 *   非透明判定は u32[i] !== 0（RGBA いずれかが非ゼロ）。
 * - 4辺収束スキャン: 上→下→左→右の順に辺から内側へ走査し、
 *   非透明ピクセル発見で早期終了。左右は上下で確定した範囲内のみ走査。
 */
export function getContentBounds(layer: Layer): ContentBounds | null {
  const { width, height } = layer;
  const imageData = getImageData(layer);
  const u32 = new Uint32Array(imageData.data.buffer);

  let top = -1;
  let bottom = -1;
  let left = width;
  let right = -1;

  // 上辺: 上から走査して最初の非透明行を見つける
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (u32[rowStart + x] !== 0) {
        top = y;
        break;
      }
    }
    if (top !== -1) break;
  }

  // 空レイヤー
  if (top === -1) return null;

  // 下辺: 下から走査して最初の非透明行を見つける
  for (let y = height - 1; y >= top; y--) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (u32[rowStart + x] !== 0) {
        bottom = y;
        break;
      }
    }
    if (bottom !== -1) break;
  }

  // 左辺: 確定した上下範囲内で左から走査
  for (let x = 0; x < width; x++) {
    for (let y = top; y <= bottom; y++) {
      if (u32[y * width + x] !== 0) {
        left = x;
        break;
      }
    }
    if (left !== width) break;
  }

  // 右辺: 確定した上下範囲内で右から走査
  for (let x = width - 1; x >= left; x--) {
    for (let y = top; y <= bottom; y++) {
      if (u32[y * width + x] !== 0) {
        right = x;
        break;
      }
    }
    if (right !== -1) break;
  }

  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}
