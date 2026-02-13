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

// ── Types (this package) ──

export type {
  StrokeCompleteData,
  StrokeStartOptions,
  UseStrokeSessionConfig,
  UseStrokeSessionResult,
} from "./useStrokeSession";
export type { PaintEngineConfig, PaintEngineResult } from "./usePaintEngine";
export type { LayerEntry, UseLayersResult } from "./useLayers";
export type { UseViewTransformResult } from "./useViewTransform";
export type { PenSettingsConfig, UsePenSettingsResult } from "./usePenSettings";
export type { SmoothingConfig, UseSmoothingResult } from "./useSmoothing";
export type { UseExpandResult } from "./useExpand";
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
  Color,
  CompiledExpand,
  ExpandConfig,
  ExpandMode,
  Layer,
  LayerMeta,
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

export type { HistoryConfig, HistoryState } from "@headless-paint/stroke";
