import type { BackgroundSettings, Layer } from "@headless-paint/engine";
import type { ViewTransform } from "@headless-paint/input";
import type { LayerEntry } from "@headless-paint/react";
import type { HistoryState } from "@headless-paint/stroke";
import { AccordionPanel } from "./AccordionPanel";
import { HistoryContent, getHistoryEntryCount } from "./HistoryContent";
import { LayerPanel } from "./LayerPanel";
import { Minimap } from "./Minimap";

interface SidebarPanelProps {
  layers: readonly Layer[];
  viewTransform: ViewTransform;
  mainCanvasWidth: number;
  mainCanvasHeight: number;
  renderVersion?: number;
  historyState: HistoryState;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Layer panel props
  entries: readonly LayerEntry[];
  activeLayerId: string | null;
  background: BackgroundSettings;
  onSelectLayer: (id: string) => void;
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleBackground: () => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  // History panel props
  layerIdToName: (layerId: string) => string;
}

export function SidebarPanel({
  layers,
  viewTransform,
  mainCanvasWidth,
  mainCanvasHeight,
  renderVersion,
  historyState,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  entries,
  activeLayerId,
  background,
  onSelectLayer,
  onAddLayer,
  onRemoveLayer,
  onToggleVisibility,
  onToggleBackground,
  onMoveUp,
  onMoveDown,
  layerIdToName,
}: SidebarPanelProps) {
  const entryCount = getHistoryEntryCount(historyState);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        width: 280,
      }}
    >
      <AccordionPanel title="Minimap" defaultExpanded isFirst isLast={false}>
        <Minimap
          layers={layers}
          viewTransform={viewTransform}
          mainCanvasWidth={mainCanvasWidth}
          mainCanvasHeight={mainCanvasHeight}
          maxWidth={264}
          renderVersion={renderVersion}
        />
      </AccordionPanel>
      <AccordionPanel
        title="Layers"
        badge={entries.length}
        defaultExpanded
        isFirst={false}
        isLast={false}
      >
        <LayerPanel
          entries={entries}
          activeLayerId={activeLayerId}
          background={background}
          onSelectLayer={onSelectLayer}
          onAddLayer={onAddLayer}
          onRemoveLayer={onRemoveLayer}
          onToggleVisibility={onToggleVisibility}
          onToggleBackground={onToggleBackground}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
      </AccordionPanel>
      <AccordionPanel
        title="History"
        badge={entryCount}
        defaultExpanded
        isFirst={false}
        isLast
      >
        <HistoryContent
          historyState={historyState}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          layerIdToName={layerIdToName}
        />
      </AccordionPanel>
    </div>
  );
}
