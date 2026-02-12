import { createLayer } from "@headless-paint/engine";
import type { Layer, LayerMeta } from "@headless-paint/engine";
import { useCallback, useRef, useState } from "react";

export interface LayerEntry {
  readonly id: string;
  readonly committedLayer: Layer;
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
  readonly renderVersion: number;
  readonly bumpRenderVersion: () => void;
}

export function useLayers(width: number, height: number): UseLayersResult {
  const [renderVersion, setRenderVersion] = useState(0);
  const bumpRenderVersion = useCallback(
    () => setRenderVersion((n) => n + 1),
    [],
  );

  const [entries, setEntries] = useState<LayerEntry[]>(() => {
    const layer = createLayer(width, height, { name: "Layer 1" });
    return [{ id: layer.id, committedLayer: layer }];
  });

  const [activeLayerId, setActiveLayerId] = useState<string | null>(
    () => entries[0]?.id ?? null,
  );

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const activeLayerIdRef = useRef(activeLayerId);
  activeLayerIdRef.current = activeLayerId;

  const layerCounterRef = useRef(1);

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
    setRenderVersion((n) => n + 1);

    return { entry, insertIndex };
  }, [width, height]);

  const removeLayer = useCallback((layerId: string) => {
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
    setRenderVersion((n) => n + 1);
  }, []);

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
      setRenderVersion((n) => n + 1);

      return entry;
    },
    [width, height],
  );

  const renameLayer = useCallback((layerId: string, name: string) => {
    const entry = entriesRef.current.find((e) => e.id === layerId);
    if (!entry) return;
    entry.committedLayer.meta.name = name;
    setEntries([...entriesRef.current]);
  }, []);

  const toggleVisibility = useCallback((layerId: string) => {
    // direct mutation + direct set: StrictMode で updater が2回呼ばれても冪等
    const entry = entriesRef.current.find((e) => e.id === layerId);
    if (!entry) return;
    entry.committedLayer.meta.visible = !entry.committedLayer.meta.visible;
    setEntries([...entriesRef.current]);
    setRenderVersion((n) => n + 1);
  }, []);

  const setLayerVisible = useCallback((layerId: string, visible: boolean) => {
    const entry = entriesRef.current.find((e) => e.id === layerId);
    if (entry) {
      entry.committedLayer.meta.visible = visible;
      setRenderVersion((n) => n + 1);
    }
  }, []);

  const moveLayerUp = useCallback((layerId: string) => {
    const currentEntries = entriesRef.current;
    const fromIndex = currentEntries.findIndex((e) => e.id === layerId);
    if (fromIndex === -1 || fromIndex >= currentEntries.length - 1) return null;

    const toIndex = fromIndex + 1;
    const newEntries = [...currentEntries];
    const [removed] = newEntries.splice(fromIndex, 1);
    newEntries.splice(toIndex, 0, removed);
    setEntries(newEntries);
    setRenderVersion((n) => n + 1);

    return { fromIndex, toIndex };
  }, []);

  const moveLayerDown = useCallback((layerId: string) => {
    const currentEntries = entriesRef.current;
    const fromIndex = currentEntries.findIndex((e) => e.id === layerId);
    if (fromIndex <= 0) return null;

    const toIndex = fromIndex - 1;
    const newEntries = [...currentEntries];
    const [removed] = newEntries.splice(fromIndex, 1);
    newEntries.splice(toIndex, 0, removed);
    setEntries(newEntries);
    setRenderVersion((n) => n + 1);

    return { fromIndex, toIndex };
  }, []);

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
    findEntry,
    getLayerIndex,
    renderVersion,
    bumpRenderVersion,
  };
}
