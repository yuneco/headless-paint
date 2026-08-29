// @headless-paint/engine
// Core paint engine - Canvas2D based

export type {
  BackgroundSettings,
  BrushConfig,
  BristleBranchRenderState,
  BristleBrushConfig,
  BristleDynamics,
  BristlePressureDynamics,
  BristleSurfaceGrain,
  BristleSweepPointState,
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
  BRUSH_MIXING_MAX_CHECKPOINT_DISTANCE_PX,
  BRUSH_MIXING_MAX_FIELD_DIMENSION,
  BRUSH_MIXING_MIN_FIELD_DIMENSION,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BRISTLE_DYNAMICS,
  DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
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
  ROUGH_BRISTLE,
  SPRAY_AIRBRUSH,
  SPRAY_MAX_PARTICLES_PER_EMISSION,
} from "./types";
export {
  createBrushAccelerator,
  type BrushAccelerator,
  type BrushAcceleratorBackend,
  type BrushAcceleratorOptions,
} from "./brush/gpu/accelerator";
export {
  createBrushTipRegistry,
  generateBrushTip,
  hashSeed,
  isBrushMixingActive,
  mulberry32,
  renderBrushStroke,
  timeSpacingMsFromRate,
  walkEmissions,
  type DistanceSpacingAt,
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
export {
  composeRotation,
  composeScaleAboutAnchor,
  composeTranslation,
  getEdgeMidpoints,
  getOutwardNormal,
  getTransformedCorners,
  isIdentityMatrix,
  isPointInQuad,
  type Mat3Like,
  type QuadCorners,
} from "./transform-geometry";
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
