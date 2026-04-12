import { colorToStyle } from "./layer";
import { interpolateStrokePointsCentripetal } from "./stroke-interpolation";
import type { Color, Layer, Point, PressureCurve, StrokePoint } from "./types";

const DEFAULT_PRESSURE = 0.5;

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

/**
 * 筆圧カーブを適用する
 * パラメトリック cubic-bezier: 端点 (0,0)→(1,1) 固定、制御点の y 座標のみ調整
 */
export function applyPressureCurve(
  pressure: number,
  curve: PressureCurve,
): number {
  const t = pressure;
  const mt = 1 - t;
  return 3 * mt * mt * t * curve.y1 + 3 * mt * t * t * curve.y2 + t * t * t;
}

/**
 * 筆圧から描画半径を計算する
 */
export function calculateRadius(
  pressure: number | undefined,
  baseLineWidth: number,
  pressureSensitivity: number,
  pressureCurve?: PressureCurve,
): number {
  let p = pressure ?? DEFAULT_PRESSURE;
  if (pressureCurve) {
    p = applyPressureCurve(p, pressureCurve);
  }
  const uniformRadius = baseLineWidth / 2;
  const pressureRadius = baseLineWidth * p;
  return (
    uniformRadius * (1 - pressureSensitivity) +
    pressureRadius * pressureSensitivity
  );
}

/**
 * Catmull-Romスプラインでポイント列を補間する
 */
export function interpolateStrokePoints(
  points: readonly StrokePoint[],
  overlapCount = 0,
): StrokePoint[] {
  return interpolateStrokePointsCentripetal(points, { overlapCount });
}

/**
 * 可変太さパス描画（補間 + circle + trapezoid fill）
 */
export function drawVariableWidthPath(
  layer: Layer,
  points: readonly StrokePoint[],
  color: Color,
  baseLineWidth: number,
  pressureSensitivity: number,
  pressureCurve?: PressureCurve,
  compositeOperation?: GlobalCompositeOperation,
  overlapCount?: number,
): void {
  if (points.length === 0) return;

  const { ctx } = layer;
  const style = colorToStyle(color);
  ctx.fillStyle = style;
  const prevCompositeOp = ctx.globalCompositeOperation;
  if (compositeOperation) {
    ctx.globalCompositeOperation = compositeOperation;
  }

  const interpolated = interpolateStrokePoints(points, overlapCount);

  if (interpolated.length === 1) {
    const r = calculateRadius(
      interpolated[0].pressure,
      baseLineWidth,
      pressureSensitivity,
      pressureCurve,
    );
    ctx.beginPath();
    ctx.arc(interpolated[0].x, interpolated[0].y, r, 0, Math.PI * 2);
    ctx.fill();
    if (compositeOperation) {
      ctx.globalCompositeOperation = prevCompositeOp;
    }
    return;
  }

  for (let i = 0; i < interpolated.length; i++) {
    const p = interpolated[i];
    const r = calculateRadius(
      p.pressure,
      baseLineWidth,
      pressureSensitivity,
      pressureCurve,
    );

    // 円を描画
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    // 隣接点間を台形ポリゴンで接続
    if (i < interpolated.length - 1) {
      const next = interpolated[i + 1];
      const rNext = calculateRadius(
        next.pressure,
        baseLineWidth,
        pressureSensitivity,
        pressureCurve,
      );

      const dx = next.x - p.x;
      const dy = next.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.001) continue;

      // 法線方向
      const nx = -dy / dist;
      const ny = dx / dist;

      ctx.beginPath();
      ctx.moveTo(p.x + nx * r, p.y + ny * r);
      ctx.lineTo(next.x + nx * rNext, next.y + ny * rNext);
      ctx.lineTo(next.x - nx * rNext, next.y - ny * rNext);
      ctx.lineTo(p.x - nx * r, p.y - ny * r);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (compositeOperation) {
    ctx.globalCompositeOperation = prevCompositeOp;
  }
}
