import type {
  BackgroundSettings,
  BrushConfig,
  BrushTipRegistry,
  Layer,
} from "@headless-paint/engine";
import type { ViewTransform } from "@headless-paint/input";
import type { LayerEntry } from "@headless-paint/react";
import type { HistoryState } from "@headless-paint/stroke";
import { memo } from "react";
import type { StrokeCallMetrics } from "../hooks/useStrokeCallMetrics";
import { AccordionPanel } from "./AccordionPanel";
import { BrushEvaluationPanel } from "./BrushEvaluationPanel";
import { BrushPanel } from "./BrushPanel";
import { HistoryContent, getHistoryEntryCount } from "./HistoryContent";
import { LayerPanel } from "./LayerPanel";
import { Minimap } from "./Minimap";

interface SidebarPanelProps {
  minimapLayers: readonly Layer[];
  viewTransform: ViewTransform;
  mainCanvasWidth: number;
  mainCanvasHeight: number;
  renderVersion?: number;
  historyState: HistoryState;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Brush panel props
  brush: BrushConfig;
  onBrushChange: (brush: BrushConfig) => void;
  registry: BrushTipRegistry;
  registryReady: boolean;
  strokeCallMetrics: StrokeCallMetrics;
  onResetStrokeCallMetrics: () => void;
  // Layer panel props
  entries: readonly LayerEntry[];
  activeLayerId: string | null;
  background: BackgroundSettings;
  onSelectLayer: (id: string) => void;
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleAlphaLock: (id: string) => void;
  onToggleBackground: () => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicateLayer: (id: string) => void;
  onMergeLayerDown: (id: string) => void;
  onSetOpacity: (layerId: string, opacity: number) => void;
  onSetBlendMode: (
    layerId: string,
    blendMode: GlobalCompositeOperation | undefined,
  ) => void;
  onTransform?: (layerId: string) => void;
  // History panel props
  layerIdToName: (layerId: string) => string;
}

interface MinimapSectionProps {
  minimapLayers: readonly Layer[];
  viewTransform: ViewTransform;
  mainCanvasWidth: number;
  mainCanvasHeight: number;
  renderVersion?: number;
}

const MinimapSection = memo(function MinimapSection({
  minimapLayers,
  viewTransform,
  mainCanvasWidth,
  mainCanvasHeight,
  renderVersion,
}: MinimapSectionProps) {
  return (
    <AccordionPanel title="Minimap" defaultExpanded isFirst isLast={false}>
      <Minimap
        layers={minimapLayers}
        viewTransform={viewTransform}
        mainCanvasWidth={mainCanvasWidth}
        mainCanvasHeight={mainCanvasHeight}
        maxWidth={264}
        renderVersion={renderVersion}
      />
    </AccordionPanel>
  );
});

interface BrushSectionProps {
  brush: BrushConfig;
  onBrushChange: (brush: BrushConfig) => void;
  registry: BrushTipRegistry;
  registryReady: boolean;
}

const BrushSection = memo(function BrushSection({
  brush,
  onBrushChange,
  registry,
  registryReady,
}: BrushSectionProps) {
  return (
    <AccordionPanel
      title="Brush"
      defaultExpanded
      isFirst={false}
      isLast={false}
    >
      <BrushPanel
        brush={brush}
        onBrushChange={onBrushChange}
        registry={registry}
        registryReady={registryReady}
      />
    </AccordionPanel>
  );
});

interface EvaluationSectionProps {
  readonly brush: BrushConfig;
  readonly metrics: StrokeCallMetrics;
  readonly onResetMetrics: () => void;
}

const EvaluationSection = memo(function EvaluationSection({
  brush,
  metrics,
  onResetMetrics,
}: EvaluationSectionProps) {
  return (
    <AccordionPanel
      title="Material brush evaluation"
      defaultExpanded={false}
      isFirst={false}
      isLast={false}
    >
      <BrushEvaluationPanel
        brush={brush}
        metrics={metrics}
        onResetMetrics={onResetMetrics}
      />
    </AccordionPanel>
  );
});

interface LayersSectionProps {
  entries: readonly LayerEntry[];
  activeLayerId: string | null;
  background: BackgroundSettings;
  onSelectLayer: (id: string) => void;
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleAlphaLock: (id: string) => void;
  onToggleBackground: () => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicateLayer: (id: string) => void;
  onMergeLayerDown: (id: string) => void;
  onSetOpacity: (layerId: string, opacity: number) => void;
  onSetBlendMode: (
    layerId: string,
    blendMode: GlobalCompositeOperation | undefined,
  ) => void;
  onTransform?: (layerId: string) => void;
}

const LayersSection = memo(function LayersSection({
  entries,
  activeLayerId,
  background,
  onSelectLayer,
  onAddLayer,
  onRemoveLayer,
  onToggleVisibility,
  onToggleAlphaLock,
  onToggleBackground,
  onMoveUp,
  onMoveDown,
  onDuplicateLayer,
  onMergeLayerDown,
  onSetOpacity,
  onSetBlendMode,
  onTransform,
}: LayersSectionProps) {
  return (
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
        onToggleAlphaLock={onToggleAlphaLock}
        onToggleBackground={onToggleBackground}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDuplicateLayer={onDuplicateLayer}
        onMergeLayerDown={onMergeLayerDown}
        onSetOpacity={onSetOpacity}
        onSetBlendMode={onSetBlendMode}
        onTransform={onTransform}
      />
    </AccordionPanel>
  );
});

interface HistorySectionProps {
  historyState: HistoryState;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  layerIdToName: (layerId: string) => string;
}

const HistorySection = memo(function HistorySection({
  historyState,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  layerIdToName,
}: HistorySectionProps) {
  const entryCount = getHistoryEntryCount(historyState);
  return (
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
  );
});

function SidebarPanelComponent({
  minimapLayers,
  viewTransform,
  mainCanvasWidth,
  mainCanvasHeight,
  renderVersion,
  historyState,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  brush,
  onBrushChange,
  registry,
  registryReady,
  strokeCallMetrics,
  onResetStrokeCallMetrics,
  entries,
  activeLayerId,
  background,
  onSelectLayer,
  onAddLayer,
  onRemoveLayer,
  onToggleVisibility,
  onToggleAlphaLock,
  onToggleBackground,
  onMoveUp,
  onMoveDown,
  onDuplicateLayer,
  onMergeLayerDown,
  onSetOpacity,
  onSetBlendMode,
  onTransform,
  layerIdToName,
}: SidebarPanelProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        width: 280,
        maxHeight: "calc(100vh - 32px)",
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <MinimapSection
        minimapLayers={minimapLayers}
        viewTransform={viewTransform}
        mainCanvasWidth={mainCanvasWidth}
        mainCanvasHeight={mainCanvasHeight}
        renderVersion={renderVersion}
      />
      <BrushSection
        brush={brush}
        onBrushChange={onBrushChange}
        registry={registry}
        registryReady={registryReady}
      />
      <EvaluationSection
        brush={brush}
        metrics={strokeCallMetrics}
        onResetMetrics={onResetStrokeCallMetrics}
      />
      <LayersSection
        entries={entries}
        activeLayerId={activeLayerId}
        background={background}
        onSelectLayer={onSelectLayer}
        onAddLayer={onAddLayer}
        onRemoveLayer={onRemoveLayer}
        onToggleVisibility={onToggleVisibility}
        onToggleAlphaLock={onToggleAlphaLock}
        onToggleBackground={onToggleBackground}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDuplicateLayer={onDuplicateLayer}
        onMergeLayerDown={onMergeLayerDown}
        onSetOpacity={onSetOpacity}
        onSetBlendMode={onSetBlendMode}
        onTransform={onTransform}
      />
      <HistorySection
        historyState={historyState}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        layerIdToName={layerIdToName}
      />
    </div>
  );
}

export const SidebarPanel = memo(SidebarPanelComponent);
