import type { Layer } from "@headless-paint/engine";

interface GpuLayerResidencyBridge {
  invalidateLayerResidency(layer: Layer): void;
}

export function invalidateGpuLayerResidency(layer: Layer): void {
  (
    globalThis as typeof globalThis & {
      __hpGpuStrokeRuntime?: GpuLayerResidencyBridge;
    }
  ).__hpGpuStrokeRuntime?.invalidateLayerResidency(layer);
}
