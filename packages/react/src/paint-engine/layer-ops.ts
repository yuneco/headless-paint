import {
  createAddLayerCommand,
  createRemoveLayerCommand,
  createReorderLayerCommand,
  duplicateLayerAtomic,
  mergeLayerDownAtomic,
  pushCommand,
} from "@headless-paint/core";
import type {
  HistoryConfig,
  HistoryState,
  Layer,
  LayerListOp,
} from "@headless-paint/core";
import { useCallback } from "react";
import type { LayerEntry, UseLayersResult } from "../useLayers";

export function createDuplicateLayerName(
  sourceName: string,
  entries: readonly LayerEntry[],
): string {
  const existing = new Set(
    entries.map((entry) => entry.committedLayer.meta.name),
  );
  const baseName = `${sourceName} copy`;
  if (!existing.has(baseName)) return baseName;
  let index = 2;
  while (existing.has(`${baseName} ${index}`)) {
    index += 1;
  }
  return `${baseName} ${index}`;
}

interface LayerActionOptions<TCustom> {
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly entriesRef: UseLayersResult["entriesRef"];
  readonly addLayer: UseLayersResult["addLayer"];
  readonly removeLayer: UseLayersResult["removeLayer"];
  readonly replaceEntries: UseLayersResult["replaceEntries"];
  readonly moveLayerUp: UseLayersResult["moveLayerUp"];
  readonly moveLayerDown: UseLayersResult["moveLayerDown"];
  readonly findEntry: UseLayersResult["findEntry"];
  readonly getLayerIndex: UseLayersResult["getLayerIndex"];
  readonly beginForLayers: (layers: readonly Layer[]) => void;
  readonly historyStateRef: React.RefObject<HistoryState<TCustom>>;
  readonly historyConfigRef: React.RefObject<HistoryConfig>;
  readonly commitHistoryState: (state: HistoryState<TCustom>) => void;
}

export interface LayerActions {
  readonly addLayer: () => void;
  readonly removeLayer: (layerId: string) => void;
  readonly moveLayerUp: (layerId: string) => void;
  readonly moveLayerDown: (layerId: string) => void;
  readonly duplicateLayer: (layerId: string) => void;
  readonly mergeLayerDown: (layerId: string) => void;
}

export function useLayerActions<TCustom>(
  options: LayerActionOptions<TCustom>,
): LayerActions {
  const handleAddLayer = useCallback(() => {
    const { entry, insertIndex } = options.addLayer();
    const command = createAddLayerCommand(
      entry.id,
      insertIndex,
      options.layerWidth,
      options.layerHeight,
      entry.committedLayer.meta,
    );
    const next = pushCommand(
      options.historyStateRef.current,
      command,
      { layerCount: options.entriesRef.current.length },
      options.historyConfigRef.current,
    );
    options.commitHistoryState(next);
  }, [
    options.addLayer,
    options.commitHistoryState,
    options.entriesRef,
    options.historyConfigRef,
    options.historyStateRef,
    options.layerHeight,
    options.layerWidth,
  ]);

  const handleRemoveLayer = useCallback(
    (layerId: string) => {
      const entry = options.findEntry(layerId);
      if (!entry) return;
      const removedIndex = options.getLayerIndex(layerId);
      const command = createRemoveLayerCommand(
        layerId,
        removedIndex,
        entry.committedLayer.meta,
      );
      options.beginForLayers([entry.committedLayer]);
      const next = pushCommand(
        options.historyStateRef.current,
        command,
        {
          afterLayer: entry.committedLayer,
          layerCount: options.entriesRef.current.length,
        },
        options.historyConfigRef.current,
      );
      options.commitHistoryState(next);
      options.removeLayer(layerId);
    },
    [
      options.beginForLayers,
      options.commitHistoryState,
      options.entriesRef,
      options.findEntry,
      options.getLayerIndex,
      options.historyConfigRef,
      options.historyStateRef,
      options.removeLayer,
    ],
  );

  const handleMoveLayerUp = useCallback(
    (layerId: string) => {
      const result = options.moveLayerUp(layerId);
      if (!result) return;
      const command = createReorderLayerCommand(
        layerId,
        result.fromIndex,
        result.toIndex,
      );
      const next = pushCommand(
        options.historyStateRef.current,
        command,
        { layerCount: options.entriesRef.current.length },
        options.historyConfigRef.current,
      );
      options.commitHistoryState(next);
    },
    [
      options.commitHistoryState,
      options.entriesRef,
      options.historyConfigRef,
      options.historyStateRef,
      options.moveLayerUp,
    ],
  );

  const handleMoveLayerDown = useCallback(
    (layerId: string) => {
      const result = options.moveLayerDown(layerId);
      if (!result) return;
      const command = createReorderLayerCommand(
        layerId,
        result.fromIndex,
        result.toIndex,
      );
      const next = pushCommand(
        options.historyStateRef.current,
        command,
        { layerCount: options.entriesRef.current.length },
        options.historyConfigRef.current,
      );
      options.commitHistoryState(next);
    },
    [
      options.commitHistoryState,
      options.entriesRef,
      options.historyConfigRef,
      options.historyStateRef,
      options.moveLayerDown,
    ],
  );

  const handleDuplicateLayer = useCallback(
    (layerId: string) => {
      const entry = options.findEntry(layerId);
      if (!entry) return;
      const name = createDuplicateLayerName(
        entry.committedLayer.meta.name,
        options.entriesRef.current,
      );
      options.beginForLayers([entry.committedLayer]);
      const result = duplicateLayerAtomic(
        options.entriesRef.current.map((item) => item.committedLayer),
        { sourceLayerId: layerId, meta: { name } },
      );
      if (!result) return;
      const next = pushCommand(
        options.historyStateRef.current,
        result.command,
        { layerCount: result.layers.length },
        options.historyConfigRef.current,
      );
      options.commitHistoryState(next);
      options.replaceEntries(result.layers, result.layer.id);
    },
    [
      options.beginForLayers,
      options.commitHistoryState,
      options.entriesRef,
      options.findEntry,
      options.historyConfigRef,
      options.historyStateRef,
      options.replaceEntries,
    ],
  );

  const handleMergeLayerDown = useCallback(
    (layerId: string) => {
      const currentEntries = options.entriesRef.current;
      const sourceIndex = currentEntries.findIndex(
        (entry) => entry.id === layerId,
      );
      const targetIndex = sourceIndex - 1;
      if (sourceIndex < 0 || targetIndex < 0) return;
      const sourceEntry = currentEntries[sourceIndex];
      const targetEntry = currentEntries[targetIndex];
      options.beginForLayers([
        sourceEntry.committedLayer,
        targetEntry.committedLayer,
      ]);
      const result = mergeLayerDownAtomic(
        currentEntries.map((entry) => entry.committedLayer),
        { sourceLayerId: layerId },
      );
      if (!result) return;
      const next = pushCommand(
        options.historyStateRef.current,
        result.command,
        { layerCount: result.layers.length },
        options.historyConfigRef.current,
      );
      options.commitHistoryState(next);
      options.replaceEntries(result.layers, result.targetLayerId);
    },
    [
      options.beginForLayers,
      options.commitHistoryState,
      options.entriesRef,
      options.historyConfigRef,
      options.historyStateRef,
      options.replaceEntries,
    ],
  );

  return {
    addLayer: handleAddLayer,
    removeLayer: handleRemoveLayer,
    moveLayerUp: handleMoveLayerUp,
    moveLayerDown: handleMoveLayerDown,
    duplicateLayer: handleDuplicateLayer,
    mergeLayerDown: handleMergeLayerDown,
  };
}

interface LayerListOpsOptions {
  readonly entriesRef: UseLayersResult["entriesRef"];
  readonly removeLayer: UseLayersResult["removeLayer"];
  readonly replaceEntries: UseLayersResult["replaceEntries"];
  readonly moveLayerUp: UseLayersResult["moveLayerUp"];
  readonly moveLayerDown: UseLayersResult["moveLayerDown"];
}

export function useLayerListOps(options: LayerListOpsOptions) {
  const applyMoveLayerListOp = useCallback(
    (fromIndex: number, toIndex: number) => {
      const currentEntries = options.entriesRef.current;
      const movedEntry = currentEntries[fromIndex];
      if (!movedEntry || toIndex < 0 || toIndex >= currentEntries.length)
        return;

      if (toIndex === fromIndex + 1) {
        options.moveLayerUp(movedEntry.id);
        return;
      }
      if (toIndex === fromIndex - 1) {
        options.moveLayerDown(movedEntry.id);
        return;
      }

      const layers = currentEntries.map((entry) => entry.committedLayer);
      const [movedLayer] = layers.splice(fromIndex, 1);
      layers.splice(toIndex, 0, movedLayer);
      options.replaceEntries(layers);
    },
    [
      options.entriesRef,
      options.moveLayerDown,
      options.moveLayerUp,
      options.replaceEntries,
    ],
  );

  return useCallback(
    (ops: readonly LayerListOp[]) => {
      for (const listOp of ops) {
        switch (listOp.type) {
          case "insert": {
            const layers = options.entriesRef.current.map(
              (entry) => entry.committedLayer,
            );
            const index = Math.max(0, Math.min(listOp.index, layers.length));
            layers.splice(index, 0, listOp.layer);
            options.replaceEntries(layers);
            break;
          }
          case "remove":
            options.removeLayer(listOp.layerId);
            break;
          case "move":
            applyMoveLayerListOp(listOp.fromIndex, listOp.toIndex);
            break;
          case "replace":
            options.replaceEntries(listOp.layers, listOp.activeLayerId);
            break;
        }
      }
    },
    [
      applyMoveLayerListOp,
      options.entriesRef,
      options.removeLayer,
      options.replaceEntries,
    ],
  );
}
