import { vec2 } from "gl-matrix";
import type { Point, ViewTransform } from "./types";
import { invertViewTransform } from "./transform";

/**
 * Screen Space の座標を Layer Space に変換
 * @param screenPoint Screen Space の座標
 * @param transform 現在のビュー変換
 * @returns Layer Space の座標。変換不可の場合は null
 */
export function screenToLayer(
  screenPoint: Point,
  transform: ViewTransform,
): Point | null {
  const inverse = invertViewTransform(transform);
  if (!inverse) return null;

  const point = vec2.fromValues(screenPoint.x, screenPoint.y);
  vec2.transformMat3(point, point, inverse);

  return { x: point[0], y: point[1] };
}

/**
 * Layer Space の座標を Screen Space に変換
 * @param layerPoint Layer Space の座標
 * @param transform 現在のビュー変換
 * @returns Screen Space の座標
 */
export function layerToScreen(
  layerPoint: Point,
  transform: ViewTransform,
): Point {
  const point = vec2.fromValues(layerPoint.x, layerPoint.y);
  vec2.transformMat3(point, point, transform);

  return { x: point[0], y: point[1] };
}
