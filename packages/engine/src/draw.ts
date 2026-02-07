import { colorToStyle } from "./layer";
import type { Color, Layer, Point, PressureCurve, StrokePoint } from "./types";

const DEFAULT_PRESSURE = 0.5;
const MIN_INTERPOLATION_DISTANCE = 2;

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
): StrokePoint[] {
  if (points.length < 2) {
    return points.map((p) => ({ ...p }));
  }

  const result: StrokePoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[Math.min(points.length - 1, i + 1)];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    result.push({ x: p1.x, y: p1.y, pressure: p1.pressure });

    if (i < points.length - 1) {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const segments = Math.max(
        1,
        Math.ceil(dist / MIN_INTERPOLATION_DISTANCE),
      );

      for (let j = 1; j < segments; j++) {
        const t = j / segments;
        const tt = t * t;
        const ttt = tt * t;

        const x =
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt);

        const y =
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * ttt);

        const pressure1 = p1.pressure ?? DEFAULT_PRESSURE;
        const pressure2 = p2.pressure ?? DEFAULT_PRESSURE;
        const pressure = pressure1 + (pressure2 - pressure1) * t;

        result.push({ x, y, pressure });
      }
    }
  }

  return result;
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
): void {
  if (points.length === 0) return;

  const { ctx } = layer;
  const style = colorToStyle(color);
  ctx.fillStyle = style;

  const prevCompositeOp = ctx.globalCompositeOperation;
  if (compositeOperation) {
    ctx.globalCompositeOperation = compositeOperation;
  }

  const interpolated = interpolateStrokePoints(points);

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
