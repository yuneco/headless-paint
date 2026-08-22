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
  CustomCommandContext,
  CustomCommandHandler,
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
  BrushBranchRenderState,
  BrushConfig,
  BristleBrushConfig,
  BristleDynamics,
  BristlePressureDynamics,
  BristleSurfaceGrain,
  BrushDynamics,
  BrushMixing,
  BrushRenderState,
  BrushTipConfig,
  BrushTipRegistry,
  CausalAdaptiveConfig,
  Color,
  Command,
  CompiledExpand,
  CompiledFilterPipeline,
  ContentBounds,
  DensityProfileCurve,
  ExpandConfig,
  ExpandMode,
  FilterPipelineConfig,
  HistoryConfig,
  HistoryState,
  InputPoint,
  Layer,
  LayerMeta,
  LayerTransformPreview,
  PendingOverlay,
  Point,
  PressureCurve,
  PressureDynamics,
  SamplingConfig,
  SprayBrushConfig,
  SprayDynamics,
  SprayPressureDynamics,
  SpraySizeJitterMode,
  StampBrushConfig,
  StraightLineConfig,
  StrokeStyle,
  TransformLayerCommand,
  ViewTransform,
} from "@headless-paint/core";

export {
  AIRBRUSH,
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_BRISTLE_DYNAMICS,
  DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_DYNAMICS,
  DEFAULT_RADIAL_DISTRIBUTION,
  DEFAULT_SPRAY_DYNAMICS,
  DEFAULT_SPRAY_PRESSURE_DYNAMICS,
  MARKER,
  PENCIL,
  ROUND_PEN,
  ROUGH_BRISTLE,
  SPRAY_AIRBRUSH,
  SPRAY_MAX_PARTICLES_PER_EMISSION,
} from "@headless-paint/core";
