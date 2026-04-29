import { calculateRadius, drawVariableWidthPath } from "./draw";
import { colorToStyle } from "./layer";
import { interpolateStrokePointsCentripetal } from "./stroke-interpolation";
import type {
  BrushBranchRenderState,
  BrushDynamics,
  BrushMixing,
  BrushRenderState,
  Color,
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
  sourceLayer?: Layer,
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
        sourceLayer ?? layer,
      );
  }
}

// ============================================================
// スタンプブラシ描画
// ============================================================

/**
 * スタンプ用の補間。
 * ストローク末尾だけ future 点の有無に依存しないよう、tail のみ p3 を外挿する。
 * 途中セグメントは実際の future 点を使うことで、曲率を滑らかに分配する。
 */
function interpolateStampStrokePoints(
  points: readonly StrokePoint[],
  overlapCount = 0,
): StrokePoint[] {
  return interpolateStrokePointsCentripetal(points, {
    overlapCount,
    futureIndependentTail: true,
  });
}

function renderStampBrushStroke(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  brush: StampBrushConfig,
  state: BrushRenderState,
  overlapCount: number,
  sourceLayer: Layer,
): BrushRenderState {
  const { dynamics } = brush;
  const spacingPx = style.lineWidth * dynamics.spacing;

  if (spacingPx <= 0 || !state.tipCanvas || points.length === 0) {
    return state;
  }

  // round-pen と同じく overlapCount を渡す。
  // overlap 区間は Catmull-Rom の文脈点として使われるが出力からは除外される。
  const interpolated = interpolateStampStrokePoints(points, overlapCount);
  if (interpolated.length === 0) return state;

  const ctx = layer.ctx;
  const mixing = getActiveMixing(brush.mixing);
  const branch = getPrimaryBranchState(state, style.color, mixing);
  let totalDistance = branch.accumulatedDistance;
  let stampCount = branch.stampCount;
  let colorBuffer = branch.colorBuffer;
  const mixedWorkCanvas = mixing
    ? new OffscreenCanvas(state.tipCanvas.width, state.tipCanvas.height)
    : undefined;

  // ストローク開始時（distance=0, overlap なし）は最初の点にスタンプを配置
  if (totalDistance === 0 && overlapCount === 0) {
    colorBuffer = stampAt(
      ctx,
      state.tipCanvas,
      interpolated[0],
      style,
      dynamics,
      state.seed,
      stampCount,
      sourceLayer,
      mixing,
      colorBuffer,
      mixedWorkCanvas,
    );
    stampCount++;
  }

  if (interpolated.length < 2) {
    return buildStampRenderState(state, totalDistance, stampCount, colorBuffer);
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

      colorBuffer = stampAt(
        ctx,
        state.tipCanvas,
        stampPoint,
        style,
        dynamics,
        state.seed,
        stampCount,
        sourceLayer,
        mixing,
        colorBuffer,
        mixedWorkCanvas,
      );
      stampCount++;

      nextStampDist += spacingPx;
    }

    totalDistance = segEnd;
  }

  return buildStampRenderState(state, totalDistance, stampCount, colorBuffer);
}

function buildStampRenderState(
  previousState: BrushRenderState,
  accumulatedDistance: number,
  stampCount: number,
  colorBuffer: OffscreenCanvas | undefined,
): BrushRenderState {
  const next: BrushRenderState = {
    accumulatedDistance,
    tipCanvas: previousState.tipCanvas,
    seed: previousState.seed,
    stampCount,
  };
  if (!colorBuffer && !previousState.branches) {
    return next;
  }
  return {
    ...next,
    branches: [
      {
        accumulatedDistance,
        stampCount,
        colorBuffer,
      },
    ],
  };
}

function getActiveMixing(mixing: BrushMixing | undefined): BrushMixing | null {
  if (!mixing?.enabled) return null;
  const pickup = clamp01(mixing.pickup);
  const restore = clamp01(mixing.restore);
  if (pickup <= 0 && restore <= 0) return null;
  return { enabled: true, pickup, restore };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getPrimaryBranchState(
  state: BrushRenderState,
  color: Color,
  mixing: BrushMixing | null,
): BrushBranchRenderState {
  const branch = state.branches?.[0];
  if (branch) return branch;
  return {
    accumulatedDistance: state.accumulatedDistance,
    stampCount: state.stampCount,
    colorBuffer:
      mixing && state.tipCanvas
        ? createColorBuffer(
            state.tipCanvas.width,
            state.tipCanvas.height,
            color,
          )
        : undefined,
  };
}

function createColorBuffer(
  width: number,
  height: number,
  color: Color,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context for brush color buffer");
  ctx.fillStyle = colorToStyle(color);
  ctx.fillRect(0, 0, width, height);
  return canvas;
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
  sourceLayer: Layer,
  mixing: BrushMixing | null,
  colorBuffer: OffscreenCanvas | undefined,
  mixedWorkCanvas: OffscreenCanvas | undefined,
): OffscreenCanvas | undefined {
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
  if (stampSize <= 0) return colorBuffer;

  const opacity = dynamics.flow * (1 - dynamics.opacityJitter * rng());
  if (opacity <= 0) return colorBuffer;

  const rotation = dynamics.rotationJitter * (rng() * 2 - 1);
  const scatterRange = dynamics.scatter * diameter;
  const scatterX = scatterRange * (rng() * 2 - 1);
  const scatterY = scatterRange * (rng() * 2 - 1);

  const x = point.x + scatterX;
  const y = point.y + scatterY;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = style.compositeOperation;

  let drawCanvas = tipCanvas;
  let nextColorBuffer = colorBuffer;
  if (mixing && mixedWorkCanvas) {
    const mixed = renderMixedTip(
      tipCanvas,
      style.color,
      x,
      y,
      stampSize,
      sourceLayer,
      mixing,
      colorBuffer,
      mixedWorkCanvas,
    );
    drawCanvas = mixed.canvas;
    nextColorBuffer = mixed.colorBuffer;
  }

  if (rotation !== 0) {
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.drawImage(
      drawCanvas,
      -stampSize / 2,
      -stampSize / 2,
      stampSize,
      stampSize,
    );
  } else {
    ctx.drawImage(
      drawCanvas,
      x - stampSize / 2,
      y - stampSize / 2,
      stampSize,
      stampSize,
    );
  }

  ctx.restore();
  return nextColorBuffer;
}

function renderMixedTip(
  tipCanvas: OffscreenCanvas,
  baseColor: Color,
  x: number,
  y: number,
  stampSize: number,
  sourceLayer: Layer,
  mixing: BrushMixing,
  colorBuffer: OffscreenCanvas | undefined,
  workCanvas: OffscreenCanvas,
): { canvas: OffscreenCanvas; colorBuffer: OffscreenCanvas } {
  const buffer =
    colorBuffer ??
    createColorBuffer(tipCanvas.width, tipCanvas.height, baseColor);
  const bufferCtx = buffer.getContext("2d");
  const workCtx = workCanvas.getContext("2d");
  if (!bufferCtx || !workCtx) {
    throw new Error("Failed to get 2d context for mixed brush");
  }

  bufferCtx.save();
  bufferCtx.globalCompositeOperation = "source-over";
  if (mixing.pickup > 0) {
    bufferCtx.globalAlpha = mixing.pickup;
    bufferCtx.drawImage(
      sourceLayer.canvas,
      x - stampSize / 2,
      y - stampSize / 2,
      stampSize,
      stampSize,
      0,
      0,
      buffer.width,
      buffer.height,
    );
  }
  if (mixing.restore > 0) {
    bufferCtx.globalAlpha = mixing.restore;
    bufferCtx.fillStyle = colorToStyle(baseColor);
    bufferCtx.fillRect(0, 0, buffer.width, buffer.height);
  }
  bufferCtx.restore();

  workCtx.save();
  workCtx.clearRect(0, 0, workCanvas.width, workCanvas.height);
  workCtx.globalCompositeOperation = "source-over";
  workCtx.globalAlpha = 1;
  workCtx.drawImage(buffer, 0, 0);
  workCtx.globalCompositeOperation = "destination-in";
  workCtx.drawImage(tipCanvas, 0, 0);
  workCtx.restore();

  return { canvas: workCanvas, colorBuffer: buffer };
}
