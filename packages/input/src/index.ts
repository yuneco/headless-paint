// Types
export type {
  Point,
  ViewTransform,
  SamplingConfig,
  SamplingState,
  TransformComponents,
  SymmetryMode,
  SymmetryConfig,
  CompiledSymmetry,
  // Pipeline types
  TransformConfig,
  PipelineConfig,
  CompiledPipeline,
  StrokeSessionState,
  StrokeSessionResult,
  StrokeSessionEndResult,
  // Plugin types
  TransformPlugin,
  CompiledTransform,
} from "./types";

// Transform functions
export {
  createViewTransform,
  pan,
  zoom,
  rotate,
  invertViewTransform,
  decomposeTransform,
} from "./transform";

// Coordinate functions
export { screenToLayer, layerToScreen } from "./coordinate";

// Sampling functions
export { shouldAcceptPoint, createSamplingState } from "./sampling";

// Symmetry functions
export {
  createDefaultSymmetryConfig,
  compileSymmetry,
  expandSymmetry,
  getSymmetryCount,
} from "./symmetry";

// Pipeline functions
export { compilePipeline, expandPoint, expandStroke } from "./pipeline";

// Plugin functions (for extension)
export { registerPlugin } from "./plugins";

// Session functions
export {
  startStrokeSession,
  addPointToSession,
  endStrokeSession,
} from "./session";
