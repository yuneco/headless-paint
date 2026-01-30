// @headless-paint/engine
// Core paint engine - Canvas2D based

export type { Color, Layer, LayerMeta, Point, StrokePoint } from "./types";
export {
  clearLayer,
  colorToStyle,
  createLayer,
  getImageData,
  getPixel,
  setPixel,
} from "./layer";
export { drawCircle, drawLine, drawPath } from "./draw";
