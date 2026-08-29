import type { Layer } from "../../types";
import type { GpuStrokeSurface } from "./gpu-stroke-surface";

interface GpuLayerResidency {
  surface: GpuStrokeSurface;
  valid: boolean;
  width: number;
  height: number;
}

const gpuLayerResidencies = new WeakMap<Layer, GpuLayerResidency>();
let residentLayer: Layer | null = null;

export function prepareGpuLayerResidency(
  layer: Layer,
  surface: GpuStrokeSurface,
): boolean {
  const previous = residentLayer;
  if (previous && previous !== layer) {
    invalidateGpuLayerResidency(previous);
  }

  residentLayer = layer;
  const residency = gpuLayerResidencies.get(layer);
  const hit =
    residency?.valid === true &&
    residency.surface === surface &&
    residency.width === layer.width &&
    residency.height === layer.height &&
    surface.width === layer.width &&
    surface.height === layer.height;

  if (!hit) {
    gpuLayerResidencies.set(layer, {
      surface,
      valid: false,
      width: layer.width,
      height: layer.height,
    });
  }
  return hit;
}

export function validateGpuLayerResidency(
  layer: Layer,
  surface: GpuStrokeSurface,
): void {
  const previous = residentLayer;
  if (previous && previous !== layer) {
    invalidateGpuLayerResidency(previous);
  }
  residentLayer = layer;
  gpuLayerResidencies.set(layer, {
    surface,
    valid: true,
    width: layer.width,
    height: layer.height,
  });
}

export function invalidateGpuLayerResidency(layer: Layer): void {
  const residency = gpuLayerResidencies.get(layer);
  if (residency) residency.valid = false;
}
