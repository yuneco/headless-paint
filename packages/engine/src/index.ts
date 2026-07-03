// @headless-paint/engine
// Core paint engine - Canvas2D based

export type {
  BackgroundSettings,
  BrushConfig,
  BrushBranchRenderState,
  BrushDynamics,
  BrushMixing,
  BrushMixingState,
  BrushRenderState,
  BrushTipConfig,
  CircleTipConfig,
  Color,
  CompiledExpand,
  ContentBounds,
  DensityProfileCurve,
  ExpandConfig,
  ExpandLevel,
  ExpandMode,
  ImageTipConfig,
  Layer,
  LayerMeta,
  LayerTransformPreview,
  PendingOverlay,
  ParametricCurve,
  Point,
  PressureCurve,
  PressureDynamics,
  RoundPenBrushConfig,
  SprayBrushConfig,
  SprayDynamics,
  SprayPressureDynamics,
  SpraySizeJitterMode,
  StampBrushConfig,
  StrokePoint,
  StrokeStyle,
} from "./types";
export {
  AIRBRUSH,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  DEFAULT_PRESSURE_DYNAMICS,
  DEFAULT_RADIAL_DISTRIBUTION,
  DEFAULT_SPRAY_DYNAMICS,
  DEFAULT_SPRAY_PRESSURE_DYNAMICS,
  MARKER,
  PENCIL,
  ROUND_PEN,
  SPRAY_AIRBRUSH,
  SPRAY_MAX_PARTICLES_PER_EMISSION,
} from "./types";
export {
  createBrushTipRegistry,
  generateBrushTip,
  hashSeed,
  mulberry32,
  renderBrushStroke,
  timeSpacingMsFromRate,
  walkEmissions,
  type BrushTipRegistry,
  type EmissionPoint,
} from "./brush";
export {
  clearLayer,
  cloneLayer,
  colorToStyle,
  copyLayerPixels,
  createLayer,
  getImageData,
  getPixel,
  setPixel,
  type CloneLayerOptions,
} from "./layer";
export {
  calculateRadius,
  drawCircle,
  drawLine,
  drawPath,
  drawVariableWidthPath,
  evaluateParametricCurve,
  interpolateStrokePoints,
} from "./draw";
export {
  renderLayerWithTransform,
  renderLayers,
  type RenderOptions,
} from "./render";
export {
  compileExpand,
  compileLocalTransforms,
  createDefaultExpandConfig,
  expandPoint,
  expandStroke,
  expandStrokePoints,
  getExpandCount,
} from "./expand";
export {
  appendToCommittedLayer,
  composeLayers,
  renderPendingLayer,
  type ViewTransform,
} from "./incremental-render";
export {
  createPatternTile,
  DEFAULT_PATTERN_PREVIEW_CONFIG,
  renderPatternPreview,
  type PatternMode,
  type PatternPreviewConfig,
} from "./pattern-preview";
export { getContentBounds } from "./content-bounds";
export { transformLayer } from "./transform-layer";
export { wrapShiftLayer } from "./wrap-shift";
export {
  mergeLayerDown,
  type MergeLayerDownOptions,
} from "./layer-merge";
export {
  addLayer,
  findLayerById,
  getLayerIndex,
  moveLayer,
  removeLayer,
  updateLayerMeta,
} from "./layer-collection";
