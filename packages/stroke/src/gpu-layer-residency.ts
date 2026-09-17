import type {
  BrushAccelerator,
  GpuResidencyInvalidationReason,
  Layer,
} from "@headless-paint/engine";

export function invalidateGpuLayerResidency(
  layer: Layer,
  accelerator?: BrushAccelerator | null,
  reason: GpuResidencyInvalidationReason = "external",
): void {
  accelerator?.invalidate(layer, reason);
}
