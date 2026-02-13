import type { BrushTipRegistry } from "@headless-paint/engine";
import { generatePencilGrainBitmap, generateStarBitmap } from "./textures";

const TIP_SIZE = 128;

/** テクスチャを生成し registry に登録。非同期・冪等 */
export async function registerAppBrushTips(
  registry: BrushTipRegistry,
): Promise<void> {
  const [pencil, star] = await Promise.all([
    generatePencilGrainBitmap(TIP_SIZE),
    generateStarBitmap(TIP_SIZE, 5),
  ]);
  registry.set("pencil-grain", pencil);
  registry.set("star", star);
}
