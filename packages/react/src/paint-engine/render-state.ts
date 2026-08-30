import { computeCumulativeOffset, createLayer } from "@headless-paint/core";
import type { HistoryState, Layer, PendingOverlay } from "@headless-paint/core";
import { useMemo } from "react";
import type { LayerEntry } from "../useLayers";

export function usePaintRenderState<TCustom>(options: {
  readonly entries: readonly LayerEntry[];
  readonly activeLayerId: string | null;
  readonly pendingLayer: Layer;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly layerRenderVersion: number;
  readonly sessionRenderVersion: number;
  readonly historyState: HistoryState<TCustom>;
  readonly dragShift: { readonly x: number; readonly y: number };
}): {
  readonly layers: readonly Layer[];
  readonly pendingOverlay: PendingOverlay | undefined;
  readonly renderVersion: number;
  readonly cumulativeOffset: { readonly x: number; readonly y: number };
} {
  const layers = useMemo(
    () => options.entries.map((entry) => entry.committedLayer),
    [options.entries],
  );
  const workLayer = useMemo(
    () =>
      createLayer(options.layerWidth, options.layerHeight, { name: "__work" }),
    [options.layerHeight, options.layerWidth],
  );
  const pendingOverlay = options.activeLayerId
    ? {
        layer: options.pendingLayer,
        targetLayerId: options.activeLayerId,
        workLayer,
      }
    : undefined;
  const historyOffset = computeCumulativeOffset(options.historyState);
  const cumulativeX = historyOffset.x + options.dragShift.x;
  const cumulativeY = historyOffset.y + options.dragShift.y;
  const cumulativeOffset = useMemo(
    () => ({ x: cumulativeX, y: cumulativeY }),
    [cumulativeX, cumulativeY],
  );
  return {
    layers,
    pendingOverlay,
    renderVersion: options.layerRenderVersion + options.sessionRenderVersion,
    cumulativeOffset,
  };
}
