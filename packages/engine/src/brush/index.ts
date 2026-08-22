import { drawVariableWidthPath } from "../draw";
import type {
  BrushRenderState,
  Layer,
  StrokePoint,
  StrokeStyle,
} from "../types";
import { renderBristleBrushStroke } from "./bristle";
import { renderSprayBrushStroke } from "./spray";
import { renderStampBrushStroke } from "./stamp";
import { DEFAULT_BRUSH_RENDER_STATE } from "./state";

export { hashSeed, mulberry32 } from "./prng";
export {
  timeSpacingMsFromRate,
  walkEmissions,
  type DistanceSpacingAt,
  type EmissionPoint,
} from "./scheduler";
export {
  cloneBrushRenderState,
  createDefaultBrushState,
  DEFAULT_BRUSH_BRANCH_RENDER_STATE,
  DEFAULT_BRUSH_RENDER_STATE,
  ensureBrushRenderState,
  getBranchBrushState,
  mergeBrushState,
  stateToBranch,
} from "./state";
export {
  createBrushTipRegistry,
  generateBrushTip,
  type BrushTipRegistry,
} from "./tip";

/**
 * ブラシ種別に応じてストロークを描画するディスパッチ関数
 */
export function renderBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  overlapCount = 0,
  state?: BrushRenderState,
  sourceLayer?: Layer,
): BrushRenderState {
  switch (style.brush.type) {
    case "round-pen":
      drawVariableWidthPath(
        layer,
        points,
        style.color,
        style.lineWidth,
        style.brush.pressureDynamics.size,
        style.pressureCurve,
        style.compositeOperation,
        overlapCount,
      );
      return state ?? DEFAULT_BRUSH_RENDER_STATE;
    case "stamp":
      if (
        style.brush.mixing?.enabled &&
        (!sourceLayer || sourceLayer.canvas === layer.canvas)
      ) {
        throw new Error(
          "Stamp mixing requires a distinct stroke-start sourceLayer snapshot",
        );
      }
      return renderStampBrushStroke(
        layer,
        points,
        style,
        style.brush,
        state ?? DEFAULT_BRUSH_RENDER_STATE,
        overlapCount,
        sourceLayer ?? layer,
      );
    case "spray":
      return renderSprayBrushStroke(
        layer,
        points,
        style,
        style.brush,
        state ?? DEFAULT_BRUSH_RENDER_STATE,
        overlapCount,
      );
    case "bristle":
      if (
        style.brush.mixing?.enabled &&
        (!sourceLayer || sourceLayer.canvas === layer.canvas)
      ) {
        throw new Error(
          "Bristle mixing requires a distinct stroke-start sourceLayer snapshot",
        );
      }
      return renderBristleBrushStroke(
        layer,
        points,
        style,
        style.brush,
        state ?? DEFAULT_BRUSH_RENDER_STATE,
        overlapCount,
        sourceLayer ?? layer,
      );
  }
}
