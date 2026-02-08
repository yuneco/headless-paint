// Types
export type {
  Point,
  ViewTransform,
  SamplingConfig,
  SamplingState,
  TransformComponents,
  // Filter types
  InputPoint,
  FilterType,
  SmoothingConfig,
  FilterConfig,
  FilterPipelineConfig,
  CompiledFilterPipeline,
  FilterPipelineState,
  FilterOutput,
  FilterProcessResult,
  // Plugin types (for extension)
  FilterPlugin,
  FilterState,
  FilterStepResult,
} from "./types";

// Transform functions
export {
  applyDpr,
  createViewTransform,
  decomposeTransform,
  fitToView,
  invertViewTransform,
  pan,
  rotate,
  zoom,
} from "./transform";

// Coordinate functions
export { screenToLayer, layerToScreen } from "./coordinate";

// Sampling functions
export { shouldAcceptPoint, createSamplingState } from "./sampling";

// Filter Pipeline functions
export {
  compileFilterPipeline,
  createFilterPipelineState,
  processPoint,
  finalizePipeline,
  processAllPoints,
} from "./filter-pipeline";

// Plugin functions (for extension)
export { getFilterPlugin, registerFilterPlugin } from "./plugins";
