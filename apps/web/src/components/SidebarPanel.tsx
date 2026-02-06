import type { Layer } from "@headless-paint/engine";
import type { ViewTransform } from "@headless-paint/input";
import type { HistoryState } from "@headless-paint/stroke";
import { AccordionPanel } from "./AccordionPanel";
import { HistoryContent, getHistoryEntryCount } from "./HistoryContent";
import { Minimap } from "./Minimap";

interface SidebarPanelProps {
  layer: Layer;
  viewTransform: ViewTransform;
  mainCanvasWidth: number;
  mainCanvasHeight: number;
  renderVersion?: number;
  historyState: HistoryState;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function SidebarPanel({
  layer,
  viewTransform,
  mainCanvasWidth,
  mainCanvasHeight,
  renderVersion,
  historyState,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
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
          layer={layer}
          viewTransform={viewTransform}
          mainCanvasWidth={mainCanvasWidth}
          mainCanvasHeight={mainCanvasHeight}
          maxWidth={264}
          renderVersion={renderVersion}
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
        />
      </AccordionPanel>
    </div>
  );
}
