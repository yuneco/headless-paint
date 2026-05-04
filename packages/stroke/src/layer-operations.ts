import {
  cloneLayer,
  getLayerIndex,
  mergeLayerDown,
} from "@headless-paint/engine";
import type { Layer } from "@headless-paint/engine";
import {
  createDuplicateLayerCommand,
  createMergeLayerDownCommand,
} from "./session";
import type {
  DuplicateLayerCommand,
  DuplicateLayerOptions,
  DuplicateLayerResult,
  MergeLayerDownAtomicOptions,
  MergeLayerDownCommand,
  MergeLayerDownResult,
} from "./types";

function insertLayer(
  layers: readonly Layer[],
  layer: Layer,
  insertIndex: number,
): readonly Layer[] {
  return [...layers.slice(0, insertIndex), layer, ...layers.slice(insertIndex)];
}

function removeLayerAt(
  layers: readonly Layer[],
  index: number,
): readonly Layer[] {
  return [...layers.slice(0, index), ...layers.slice(index + 1)];
}

export function duplicateLayerAtomic(
  layers: readonly Layer[],
  options: DuplicateLayerOptions,
): DuplicateLayerResult | null {
  const sourceIndex = getLayerIndex(layers, options.sourceLayerId);
  if (sourceIndex < 0) return null;

  const source = layers[sourceIndex];
  const requestedIndex = options.insertIndex ?? sourceIndex + 1;
  const insertIndex = Math.max(0, Math.min(requestedIndex, layers.length));
  const layer = cloneLayer(source, {
    id: options.layerId,
    meta: options.meta,
  });
  const updatedLayers = insertLayer(layers, layer, insertIndex);
  const command = createDuplicateLayerCommand(
    source.id,
    layer.id,
    insertIndex,
    layer.width,
    layer.height,
    layer.meta,
  );

  return { layers: updatedLayers, layer, insertIndex, command };
}

export function mergeLayerDownAtomic(
  layers: readonly Layer[],
  options: MergeLayerDownAtomicOptions,
): MergeLayerDownResult | null {
  const sourceIndex = getLayerIndex(layers, options.sourceLayerId);
  const targetIndex = sourceIndex - 1;
  if (sourceIndex < 0 || targetIndex < 0) return null;

  const sourceLayer = layers[sourceIndex];
  const targetLayer = layers[targetIndex];
  const sourceMeta = { ...sourceLayer.meta };
  const targetMetaBefore = { ...targetLayer.meta };
  mergeLayerDown(targetLayer, sourceLayer, {
    resultMeta: options.resultMeta,
  });
  const targetMetaAfter = { ...targetLayer.meta };
  const updatedLayers = removeLayerAt(layers, sourceIndex);
  const command = createMergeLayerDownCommand(
    sourceLayer.id,
    targetLayer.id,
    sourceIndex,
    targetIndex,
    sourceMeta,
    targetMetaBefore,
    targetMetaAfter,
  );

  return {
    layers: updatedLayers,
    sourceLayerId: sourceLayer.id,
    targetLayerId: targetLayer.id,
    sourceIndex,
    targetIndex,
    command,
  };
}

export function applyDuplicateLayerCommand(
  layers: readonly Layer[],
  command: DuplicateLayerCommand,
): DuplicateLayerResult | null {
  if (layers.some((layer) => layer.id === command.layerId)) return null;
  if (command.insertIndex < 0 || command.insertIndex > layers.length) {
    return null;
  }
  const result = duplicateLayerAtomic(layers, {
    sourceLayerId: command.sourceLayerId,
    insertIndex: command.insertIndex,
    layerId: command.layerId,
    meta: command.meta,
  });
  return result ? { ...result, command } : null;
}

export function applyMergeLayerDownCommand(
  layers: readonly Layer[],
  command: MergeLayerDownCommand,
): MergeLayerDownResult | null {
  if (command.targetIndex !== command.sourceIndex - 1) return null;
  if (layers[command.sourceIndex]?.id !== command.sourceLayerId) return null;
  if (layers[command.targetIndex]?.id !== command.targetLayerId) return null;
  const result = mergeLayerDownAtomic(layers, {
    sourceLayerId: command.sourceLayerId,
    resultMeta: command.targetMetaAfter,
  });
  return result ? { ...result, command } : null;
}
