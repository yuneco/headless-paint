import { colorToStyle } from "./layer";
import type { Color, Layer, Point } from "./types";

export function drawLine(
  layer: Layer,
  from: Point,
  to: Point,
  color: Color,
  lineWidth = 1,
): void {
  const { ctx } = layer;
  ctx.strokeStyle = colorToStyle(color);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

export function drawCircle(
  layer: Layer,
  center: Point,
  radius: number,
  color: Color,
): void {
  const { ctx } = layer;
  ctx.fillStyle = colorToStyle(color);

  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPath(
  layer: Layer,
  points: readonly Point[],
  color: Color,
  lineWidth = 1,
): void {
  if (points.length === 0) return;

  const { ctx } = layer;
  ctx.strokeStyle = colorToStyle(color);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}
