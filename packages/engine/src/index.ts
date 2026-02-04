// @headless-paint/engine
// Core paint engine - Canvas2D based

export type {
  Color,
  CompiledExpand,
  ExpandConfig,
  ExpandMode,
  Layer,
  LayerMeta,
  Point,
  StrokePoint,
  StrokeStyle,
} from "./types";
export {
  clearLayer,
  colorToStyle,
  createLayer,
  getImageData,
  getPixel,
  setPixel,
} from "./layer";
export { drawCircle, drawLine, drawPath } from "./draw";
export { renderLayerWithTransform, renderLayers } from "./render";
export {
  compileExpand,
  createDefaultExpandConfig,
  expandPoint,
  expandStroke,
  getExpandCount,
} from "./expand";
export {
  appendToCommittedLayer,
  composeLayers,
  renderPendingLayer,
  type ViewTransform,
} from "./incremental-render";
