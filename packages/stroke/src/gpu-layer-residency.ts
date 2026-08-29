import type { BrushAccelerator, Layer } from "@headless-paint/engine";

export function invalidateGpuLayerResidency(
  layer: Layer,
  accelerator?: BrushAccelerator | null,
): void {
  accelerator?.invalidate(layer);
}
