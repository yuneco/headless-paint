import { createLayer } from "@headless-paint/core";
import type { Layer, LayerMeta } from "@headless-paint/core";
import { useCallback, useRef, useState } from "react";
import { useRafRenderVersion } from "./useRafRenderVersion";

export interface LayerEntry {
  readonly id: string;
  readonly committedLayer: Layer;
}

export interface InitialLayer {
  readonly id: string;
  readonly meta: LayerMeta;
  readonly imageData: ImageData;
}

export interface UseLayersOptions {
  readonly initialLayers?: readonly InitialLayer[];
  readonly initialActiveLayerId?: string | null;
}

export interface UseLayersResult {
  readonly entries: readonly LayerEntry[];
  readonly entriesRef: React.RefObject<LayerEntry[]>;
  readonly activeLayerId: string | null;
  readonly activeEntry: LayerEntry | undefined;
  readonly addLayer: () => { entry: LayerEntry; insertIndex: number };
  readonly removeLayer: (layerId: string) => void;
  readonly reinsertLayer: (
    layerId: string,
    index: number,
    meta?: LayerMeta,
  ) => LayerEntry;
  readonly setActiveLayerId: (id: string | null) => void;
  readonly renameLayer: (layerId: string, name: string) => void;
  readonly toggleVisibility: (layerId: string) => void;
  readonly setLayerVisible: (layerId: string, visible: boolean) => void;
  readonly moveLayerUp: (
    layerId: string,
  ) => { fromIndex: number; toIndex: number } | null;
  readonly moveLayerDown: (
    layerId: string,
  ) => { fromIndex: number; toIndex: number } | null;
  readonly findEntry: (layerId: string) => LayerEntry | undefined;
  readonly getLayerIndex: (layerId: string) => number;
  readonly setLayerOpacity: (layerId: string, opacity: number) => void;
  readonly setLayerBlendMode: (
    layerId: string,
    blendMode: GlobalCompositeOperation | undefined,
  ) => void;
  readonly renderVersion: number;
  readonly bumpRenderVersion: () => void;
}

function createInitialEntries(
  width: number,
  height: number,
  initialLayers?: readonly InitialLayer[],
): LayerEntry[] {
  if (!initialLayers || initialLayers.length < 1) {
    const layer = createLayer(width, height, { name: "Layer 1" });
    return [{ id: layer.id, committedLayer: layer }];
  }

  const entries: LayerEntry[] = [];
  for (const initial of initialLayers) {
    if (
      initial.imageData.width !== width ||
      initial.imageData.height !== height ||
      initial.id.length < 1
    ) {
      continue;
    }
    const layer = createLayer(width, height, initial.meta);
    layer.ctx.putImageData(initial.imageData, 0, 0);
    (layer as { id: string }).id = initial.id;
    entries.push({ id: initial.id, committedLayer: layer });
  }

  if (entries.length < 1) {
    const layer = createLayer(width, height, { name: "Layer 1" });
    return [{ id: layer.id, committedLayer: layer }];
  }
  return entries;
}

export function useLayers(
  width: number,
  height: number,
  options?: UseLayersOptions,
): UseLayersResult {
  const [renderVersion, bumpRenderVersion] = useRafRenderVersion();

  const [entries, setEntries] = useState<LayerEntry[]>(() =>
    createInitialEntries(width, height, options?.initialLayers),
  );

  const [activeLayerId, setActiveLayerId] = useState<string | null>(() => {
    const requested = options?.initialActiveLayerId;
    if (requested && entries.some((entry) => entry.id === requested)) {
      return requested;
    }
    return entries[0]?.id ?? null;
  });

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const activeLayerIdRef = useRef(activeLayerId);
  activeLayerIdRef.current = activeLayerId;

  const layerCounterRef = useRef(entries.length);

  const findEntry = useCallback(
    (layerId: string) => entriesRef.current.find((e) => e.id === layerId),
    [],
  );

  const getLayerIndex = useCallback(
    (layerId: string) => entriesRef.current.findIndex((e) => e.id === layerId),
    [],
  );

  const activeEntry = entries.find((e) => e.id === activeLayerId);

  const addLayer = useCallback(() => {
    layerCounterRef.current += 1;
    const name = `Layer ${layerCounterRef.current}`;
    const layer = createLayer(width, height, { name });
    const entry: LayerEntry = { id: layer.id, committedLayer: layer };
    const insertIndex = entriesRef.current.length;

    setEntries((prev) => [...prev, entry]);
    setActiveLayerId(entry.id);
    bumpRenderVersion();

    return { entry, insertIndex };
  }, [width, height, bumpRenderVersion]);

  const removeLayer = useCallback(
    (layerId: string) => {
      const currentEntries = entriesRef.current;
      const index = currentEntries.findIndex((e) => e.id === layerId);
      if (index === -1) return;

      const newEntries = currentEntries.filter((e) => e.id !== layerId);
      setEntries(newEntries);

      if (activeLayerIdRef.current === layerId) {
        if (newEntries.length === 0) {
          setActiveLayerId(null);
        } else {
          const newIndex = Math.min(index, newEntries.length - 1);
          setActiveLayerId(newEntries[newIndex].id);
        }
      }
      bumpRenderVersion();
    },
    [bumpRenderVersion],
  );

  const reinsertLayer = useCallback(
    (layerId: string, index: number, meta?: LayerMeta) => {
      const layer = createLayer(width, height, meta);
      (layer as { id: string }).id = layerId;
      const entry: LayerEntry = { id: layerId, committedLayer: layer };

      // direct set: StrictMode で updater が2回呼ばれても冪等
      const currentEntries = entriesRef.current;
      const clampedIndex = Math.max(0, Math.min(index, currentEntries.length));
      const newEntries = [
        ...currentEntries.slice(0, clampedIndex),
        entry,
        ...currentEntries.slice(clampedIndex),
      ];
      setEntries(newEntries);
      setActiveLayerId(layerId);
      bumpRenderVersion();

      return entry;
    },
    [width, height, bumpRenderVersion],
  );

  const renameLayer = useCallback((layerId: string, name: string) => {
    const entry = entriesRef.current.find((e) => e.id === layerId);
    if (!entry) return;
    entry.committedLayer.meta.name = name;
    setEntries([...entriesRef.current]);
  }, []);

  const toggleVisibility = useCallback(
    (layerId: string) => {
      // direct mutation + direct set: StrictMode で updater が2回呼ばれても冪等
      const entry = entriesRef.current.find((e) => e.id === layerId);
      if (!entry) return;
      entry.committedLayer.meta.visible = !entry.committedLayer.meta.visible;
      setEntries([...entriesRef.current]);
      bumpRenderVersion();
    },
    [bumpRenderVersion],
  );

  const setLayerVisible = useCallback(
    (layerId: string, visible: boolean) => {
      const entry = entriesRef.current.find((e) => e.id === layerId);
      if (entry) {
        entry.committedLayer.meta.visible = visible;
        bumpRenderVersion();
      }
    },
    [bumpRenderVersion],
  );

  const moveLayerUp = useCallback(
    (layerId: string) => {
      const currentEntries = entriesRef.current;
      const fromIndex = currentEntries.findIndex((e) => e.id === layerId);
      if (fromIndex === -1 || fromIndex >= currentEntries.length - 1)
        return null;

      const toIndex = fromIndex + 1;
      const newEntries = [...currentEntries];
      const [removed] = newEntries.splice(fromIndex, 1);
      newEntries.splice(toIndex, 0, removed);
      setEntries(newEntries);
      bumpRenderVersion();

      return { fromIndex, toIndex };
    },
    [bumpRenderVersion],
  );

  const moveLayerDown = useCallback(
    (layerId: string) => {
      const currentEntries = entriesRef.current;
      const fromIndex = currentEntries.findIndex((e) => e.id === layerId);
      if (fromIndex <= 0) return null;

      const toIndex = fromIndex - 1;
      const newEntries = [...currentEntries];
      const [removed] = newEntries.splice(fromIndex, 1);
      newEntries.splice(toIndex, 0, removed);
      setEntries(newEntries);
      bumpRenderVersion();

      return { fromIndex, toIndex };
    },
    [bumpRenderVersion],
  );

  const setLayerOpacity = useCallback(
    (layerId: string, opacity: number) => {
      const entry = entriesRef.current.find((e) => e.id === layerId);
      if (!entry) return;
      entry.committedLayer.meta.opacity = Math.max(0, Math.min(1, opacity));
      setEntries([...entriesRef.current]);
      bumpRenderVersion();
    },
    [bumpRenderVersion],
  );

  const setLayerBlendMode = useCallback(
    (layerId: string, blendMode: GlobalCompositeOperation | undefined) => {
      const entry = entriesRef.current.find((e) => e.id === layerId);
      if (!entry) return;
      entry.committedLayer.meta.compositeOperation = blendMode;
      setEntries([...entriesRef.current]);
      bumpRenderVersion();
    },
    [bumpRenderVersion],
  );

  return {
    entries,
    entriesRef,
    activeLayerId,
    activeEntry,
    addLayer,
    removeLayer,
    reinsertLayer,
    setActiveLayerId,
    renameLayer,
    toggleVisibility,
    setLayerVisible,
    moveLayerUp,
    moveLayerDown,
    setLayerOpacity,
    setLayerBlendMode,
    findEntry,
    getLayerIndex,
    renderVersion,
    bumpRenderVersion,
  };
}
