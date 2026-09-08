const SECTION_CACHE_LIMIT = 32;
const sectionCache = new Map<number, OffscreenCanvas>();

/** Uniform alpha mask and color-field carrier used only by bristle mixing. */
export function getBristleSectionCanvas(brushSize: number): OffscreenCanvas {
  const height = Math.max(8, Math.ceil(brushSize * 2));
  const cached = sectionCache.get(height);
  if (cached) return cached;
  const canvas = new OffscreenCanvas(2, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Bristle section requires Canvas2D");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  sectionCache.set(height, canvas);
  if (sectionCache.size > SECTION_CACHE_LIMIT) {
    const oldest = sectionCache.keys().next().value;
    if (oldest !== undefined) sectionCache.delete(oldest);
  }
  return canvas;
}
