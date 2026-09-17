import type { BrushAssetRegistry } from "@headless-paint/engine";
import { createHeightMapFromImageData } from "@headless-paint/engine";
import fabric031Url from "./paper-textures/fabric-031-displacement-512.jpg";
import fabric036Url from "./paper-textures/fabric-036-displacement-512.jpg";
import fabric061Url from "./paper-textures/fabric-061-displacement-512.jpg";
import { generatePencilGrainBitmap, generateStarBitmap } from "./textures";

const TIP_SIZE = 128;

/** テクスチャを生成し registry に登録。非同期・冪等 */
export async function registerAppBrushAssets(
  registry: BrushAssetRegistry,
): Promise<void> {
  const [pencil, star] = await Promise.all([
    generatePencilGrainBitmap(TIP_SIZE),
    generateStarBitmap(TIP_SIZE, 5),
  ]);
  registry.setTip("pencil-grain", pencil);
  registry.setTip("star", star);
  await Promise.all([
    registerPaperTexture(registry, "paper-fabric-031", fabric031Url, true),
    registerPaperTexture(registry, "paper-fabric-036", fabric036Url, false),
    registerPaperTexture(registry, "paper-fabric-061", fabric061Url, false),
  ]);
}

async function registerPaperTexture(
  registry: BrushAssetRegistry,
  id: string,
  url: string,
  normalize: boolean,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load paper texture: ${id} (${response.status})`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Failed to get 2d context for paper texture");
    context.drawImage(bitmap, 0, 0);
    registry.setHeightMap(
      id,
      createHeightMapFromImageData(
        context.getImageData(0, 0, canvas.width, canvas.height),
        { normalize, invert: false, contrast: 1 },
      ),
    );
  } finally {
    bitmap.close();
  }
}
