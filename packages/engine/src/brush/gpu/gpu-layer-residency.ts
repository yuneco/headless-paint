import type { Layer } from "../../types";
import type { BrushAccelerator } from "./accelerator";

const layerAccelerators = new WeakMap<Layer, BrushAccelerator>();

export function registerGpuLayerResidency(
  layer: Layer,
  accelerator: BrushAccelerator,
): void {
  const previous = layerAccelerators.get(layer);
  if (previous && previous !== accelerator) previous.invalidate(layer);
  layerAccelerators.set(layer, accelerator);
}

export function unregisterGpuLayerResidency(
  layer: Layer,
  accelerator: BrushAccelerator,
): void {
  if (layerAccelerators.get(layer) === accelerator) {
    layerAccelerators.delete(layer);
  }
}

export function invalidateGpuLayerResidency(layer: Layer): void {
  layerAccelerators.get(layer)?.invalidate(layer);
}
