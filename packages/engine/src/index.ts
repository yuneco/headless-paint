// @headless-paint/engine
// Core paint engine - Canvas2D based

export type {
  BackgroundSettings,
  Color,
  CompiledExpand,
  ExpandConfig,
  ExpandMode,
  Layer,
  LayerMeta,
  Point,
  PressureCurve,
  StrokePoint,
  StrokeStyle,
} from "./types";
export { DEFAULT_BACKGROUND_COLOR, DEFAULT_PRESSURE_CURVE } from "./types";
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
