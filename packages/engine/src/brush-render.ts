import {
  calculateRadius,
  drawVariableWidthPath,
  interpolateStrokePoints,
} from "./draw";
import type {
  BrushDynamics,
  BrushRenderState,
  Layer,
  StampBrushConfig,
  StrokePoint,
  StrokeStyle,
} from "./types";

const DEFAULT_BRUSH_RENDER_STATE: BrushRenderState = {
  accumulatedDistance: 0,
  tipCanvas: null,
  seed: 0,
  stampCount: 0,
};

// ============================================================
// PRNG ユーティリティ
// ============================================================

/**
 * 32bit シードから [0,1) の疑似乱数列を生成する（mulberry32）
 */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * グローバルシードとストローク上の距離から位置固有のシードを生成する。
 * 同一距離位置では常に同一シードを返すため、committed/pending を独立描画しても同一 jitter。
 */
export function hashSeed(globalSeed: number, distance: number): number {
  const quantized = Math.round(distance * 100);
  // FNV-1a inspired hash
  let h = (globalSeed ^ quantized) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

// ============================================================
// ディスパッチ
// ============================================================

/**
 * ブラシ種別に応じてストロークを描画するディスパッチ関数
 */
export function renderBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  overlapCount = 0,
  state?: BrushRenderState,
): BrushRenderState {
  switch (style.brush.type) {
    case "round-pen":
      drawVariableWidthPath(
        layer,
        points,
        style.color,
        style.lineWidth,
        style.pressureSensitivity,
        style.pressureCurve,
        style.compositeOperation,
        overlapCount,
      );
      return state ?? DEFAULT_BRUSH_RENDER_STATE;
    case "stamp":
      return renderStampBrushStroke(
        layer,
        points,
        style,
        style.brush,
        state ?? DEFAULT_BRUSH_RENDER_STATE,
        overlapCount,
      );
  }
}

// ============================================================
// スタンプブラシ描画
// ============================================================

function renderStampBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  brush: StampBrushConfig,
  state: BrushRenderState,
  overlapCount = 0,
): BrushRenderState {
  const { dynamics } = brush;
  const spacingPx = style.lineWidth * dynamics.spacing;

  if (spacingPx <= 0 || !state.tipCanvas || points.length < 2) {
    return state;
  }

  // round-pen と同じく overlapCount を渡す。
  // overlap 区間は Catmull-Rom の文脈点として使われるが出力からは除外される。
  const interpolated = interpolateStrokePoints(points, overlapCount);
  if (interpolated.length < 2) return state;

  const ctx = layer.ctx;
  let totalDistance = state.accumulatedDistance;
  let stampCount = state.stampCount;

  // ストローク開始時（distance=0, overlap なし）は最初の点にスタンプを配置
  if (totalDistance === 0 && overlapCount === 0) {
    stampAt(
      ctx,
      state.tipCanvas,
      interpolated[0],
      style,
      dynamics,
      state.seed,
      stampCount,
    );
    stampCount++;
  }

  // 次のスタンプ配置距離を計算
  let nextStampDist =
    totalDistance === 0
      ? spacingPx
      : Math.ceil(totalDistance / spacingPx) * spacingPx;
  if (nextStampDist <= totalDistance && totalDistance > 0) {
    nextStampDist += spacingPx;
  }

  // 補間ポイント間を歩いてスタンプを配置
  for (let i = 1; i < interpolated.length; i++) {
    const p1 = interpolated[i - 1];
    const p2 = interpolated[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen === 0) continue;

    const segStart = totalDistance;
    const segEnd = totalDistance + segLen;

    while (nextStampDist <= segEnd) {
      const t = (nextStampDist - segStart) / segLen;
      const pr1 = p1.pressure ?? 0.5;
      const pr2 = p2.pressure ?? 0.5;
      const stampPoint: StrokePoint = {
        x: p1.x + dx * t,
        y: p1.y + dy * t,
        pressure: pr1 + (pr2 - pr1) * t,
      };

      stampAt(
        ctx,
        state.tipCanvas,
        stampPoint,
        style,
        dynamics,
        state.seed,
        stampCount,
      );
      stampCount++;

      nextStampDist += spacingPx;
    }

    totalDistance = segEnd;
  }

  return {
    accumulatedDistance: totalDistance,
    tipCanvas: state.tipCanvas,
    seed: state.seed,
    stampCount,
  };
}

/**
 * 単一スタンプの配置。dynamics の jitter をスタンプ通し番号ベース PRNG で適用する。
 */
function stampAt(
  ctx: OffscreenCanvasRenderingContext2D,
  tipCanvas: OffscreenCanvas,
  point: StrokePoint,
  style: StrokeStyle,
  dynamics: BrushDynamics,
  seed: number,
  stampIndex: number,
): void {
  const localSeed = hashSeed(seed, stampIndex);
  const rng = mulberry32(localSeed);

  // 筆圧によるサイズ計算
  const radius = calculateRadius(
    point.pressure,
    style.lineWidth,
    style.pressureSensitivity,
    style.pressureCurve,
  );
  const diameter = radius * 2;

  // dynamics 適用
  const sizeScale = 1 - dynamics.sizeJitter * rng();
  const stampSize = diameter * sizeScale;
  if (stampSize <= 0) return;

  const opacity = dynamics.flow * (1 - dynamics.opacityJitter * rng());
  if (opacity <= 0) return;

  const rotation = dynamics.rotationJitter * (rng() * 2 - 1);
  const scatterRange = dynamics.scatter * diameter;
  const scatterX = scatterRange * (rng() * 2 - 1);
  const scatterY = scatterRange * (rng() * 2 - 1);

  const x = point.x + scatterX;
  const y = point.y + scatterY;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = style.compositeOperation;

  if (rotation !== 0) {
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.drawImage(
      tipCanvas,
      -stampSize / 2,
      -stampSize / 2,
      stampSize,
      stampSize,
    );
  } else {
    ctx.drawImage(
      tipCanvas,
      x - stampSize / 2,
      y - stampSize / 2,
      stampSize,
      stampSize,
    );
  }

  ctx.restore();
}
