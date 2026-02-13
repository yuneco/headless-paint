// @headless-paint/engine
// Core paint engine - Canvas2D based

export type {
  BackgroundSettings,
  BrushConfig,
  BrushDynamics,
  BrushRenderState,
  BrushTipConfig,
  CircleTipConfig,
  Color,
  CompiledExpand,
  ExpandConfig,
  ExpandLevel,
  ExpandMode,
  ImageTipConfig,
  Layer,
  LayerMeta,
  Point,
  PressureCurve,
  RoundPenBrushConfig,
  StampBrushConfig,
  StrokePoint,
  StrokeStyle,
} from "./types";
export {
  AIRBRUSH,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_PRESSURE_CURVE,
  MARKER,
  PENCIL,
  ROUND_PEN,
} from "./types";
export { hashSeed, mulberry32, renderBrushStroke } from "./brush-render";
export {
  createBrushTipRegistry,
  generateBrushTip,
  type BrushTipRegistry,
} from "./brush-tip";
export {
  clearLayer,
  colorToStyle,
  createLayer,
  getImageData,
  getPixel,
  setPixel,
} from "./layer";
export {
  applyPressureCurve,
  calculateRadius,
  drawCircle,
  drawLine,
  drawPath,
  drawVariableWidthPath,
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
export { wrapShiftLayer } from "./wrap-shift";
export {
  addLayer,
  findLayerById,
  getLayerIndex,
  moveLayer,
  removeLayer,
  updateLayerMeta,
} from "./layer-collection";
