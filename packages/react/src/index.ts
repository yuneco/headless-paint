// ── Hooks ──

export { useStrokeSession } from "./useStrokeSession";
export { usePaintEngine } from "./usePaintEngine";
export { useLayers } from "./useLayers";
export { useViewTransform } from "./useViewTransform";
export { usePenSettings } from "./usePenSettings";
export { useSmoothing } from "./useSmoothing";
export { useExpand } from "./useExpand";
export { usePointerHandler } from "./usePointerHandler";
export { useTouchGesture } from "./useTouchGesture";
export { useWindowSize } from "./useWindowSize";
export {
  PAINT_SNAPSHOT_VERSION,
  createLayerFromInitialData,
  exportPaintDocument,
  exportPaintSettings,
  importPaintDocument,
  importPaintSettings,
  parsePaintDocumentSnapshot,
} from "./persistence";

// ── Types (this package) ──

export type {
  StrokeCompleteData,
  StrokeStartOptions,
  UseStrokeSessionConfig,
  UseStrokeSessionResult,
} from "./useStrokeSession";
export type {
  PaintEngineConfig,
  PaintEngineInitialDocument,
  PaintEngineInitialLayer,
  PaintEngineResult,
} from "./usePaintEngine";
export type {
  InitialLayer,
  LayerEntry,
  UseLayersOptions,
  UseLayersResult,
} from "./useLayers";
export type { UseViewTransformResult } from "./useViewTransform";
export type { PenSettingsConfig, UsePenSettingsResult } from "./usePenSettings";
export type { SmoothingConfig, UseSmoothingResult } from "./useSmoothing";
export type { UseExpandResult } from "./useExpand";
export type {
  ExportPaintDocumentInput,
  ExportPaintSettingsInput,
  PaintDocumentLayerSnapshot,
  PaintDocumentLayerSource,
  PaintDocumentSnapshot,
  PaintInitialDocument,
  PaintInitialLayer,
  PaintPenSettingsSnapshot,
  PaintSettingsSnapshot,
  PaintSmoothingSettingsSnapshot,
} from "./persistence";
export type {
  ToolType,
  UsePointerHandlerOptions,
  PointerHandlers,
} from "./usePointerHandler";
export type {
  UseTouchGestureOptions,
  UseTouchGestureResult,
} from "./useTouchGesture";
export type { WindowSize } from "./useWindowSize";

// ── Re-exports from core packages ──

export type {
  BrushConfig,
  BrushDynamics,
  BrushRenderState,
  BrushTipConfig,
  BrushTipRegistry,
  Color,
  CompiledExpand,
  ContentBounds,
  ExpandConfig,
  ExpandMode,
  Layer,
  LayerMeta,
  LayerTransformPreview,
  PendingOverlay,
  Point,
  PressureCurve,
  StampBrushConfig,
  StrokeStyle,
} from "@headless-paint/engine";

export {
  AIRBRUSH,
  DEFAULT_BRUSH_DYNAMICS,
  MARKER,
  PENCIL,
  ROUND_PEN,
} from "@headless-paint/engine";

export type {
  CompiledFilterPipeline,
  FilterPipelineConfig,
  InputPoint,
  SamplingConfig,
  StraightLineConfig,
  ViewTransform,
} from "@headless-paint/input";

export type {
  HistoryConfig,
  HistoryState,
  TransformLayerCommand,
} from "@headless-paint/stroke";
