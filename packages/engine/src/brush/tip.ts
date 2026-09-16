import { colorToStyle } from "../layer";
import type { BristleHeightMap, BrushTipConfig, Color } from "../types";
import { validateHeightMap } from "./height-map";

// ============================================================
// BrushAssetRegistry
// ============================================================

export interface BrushAssetRegistry {
  readonly getTip: (imageId: string) => ImageBitmap | undefined;
  readonly setTip: (imageId: string, image: ImageBitmap) => void;
  readonly getHeightMap: (heightMapId: string) => BristleHeightMap | undefined;
  readonly setHeightMap: (heightMapId: string, map: BristleHeightMap) => void;
}

export function createBrushAssetRegistry(): BrushAssetRegistry {
  const images = new Map<string, ImageBitmap>();
  const heightMaps = new Map<string, BristleHeightMap>();
  return {
    getTip: (imageId) => images.get(imageId),
    setTip: (imageId, image) => {
      images.set(imageId, image);
    },
    getHeightMap: (heightMapId) => heightMaps.get(heightMapId),
    setHeightMap: (heightMapId, map) => {
      validateHeightMap(map);
      heightMaps.set(heightMapId, map);
    },
  };
}

// ============================================================
// Tip generation
// ============================================================

/**
 * ブラシチップ画像を生成する。
 * CircleTipConfig: hardness に応じた radialGradient
 * ImageTipConfig: registry から画像を取得し指定色で着色
 */
export function generateBrushTip(
  config: BrushTipConfig,
  size: number,
  color: Color,
  registry?: BrushAssetRegistry,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context for brush tip");

  switch (config.type) {
    case "circle":
      generateCircleTip(ctx, size, color, config.hardness);
      break;
    case "image":
      generateImageTip(ctx, size, color, config.imageId, registry);
      break;
  }

  return canvas;
}

function generateCircleTip(
  ctx: OffscreenCanvasRenderingContext2D,
  size: number,
  color: Color,
  hardness: number,
): void {
  const center = size / 2;
  const radius = size / 2;

  if (hardness >= 1.0) {
    ctx.fillStyle = colorToStyle(color);
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const gradient = ctx.createRadialGradient(
      center,
      center,
      0,
      center,
      center,
      radius,
    );
    const style = colorToStyle(color);
    const transparent = colorToStyle({ ...color, a: 0 });

    gradient.addColorStop(0, style);
    if (hardness > 0) {
      gradient.addColorStop(hardness, style);
    }
    gradient.addColorStop(1, transparent);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
}

function generateImageTip(
  ctx: OffscreenCanvasRenderingContext2D,
  size: number,
  color: Color,
  imageId: string,
  registry?: BrushAssetRegistry,
): void {
  if (!registry) throw new Error("BrushAssetRegistry required for image tip");
  const image = registry.getTip(imageId);
  if (!image) throw new Error(`Image tip not found: ${imageId}`);

  ctx.drawImage(image, 0, 0, size, size);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = colorToStyle(color);
  ctx.fillRect(0, 0, size, size);
}
