import { renderBrushStroke } from "./brush-render";
import { expandStrokePoints } from "./expand";
import { clearLayer } from "./layer";
import type {
  BrushBranchRenderState,
  BrushRenderState,
  CompiledExpand,
  Layer,
  PendingOverlay,
  StrokePoint,
  StrokeStyle,
} from "./types";

const PENDING_COLOR_BUFFER_CACHE = new WeakMap<
  OffscreenCanvas,
  OffscreenCanvas
>();
const CONTEXT_CACHE = new WeakMap<
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D
>();

/**
 * 確定レイヤーに新しく確定した点を追加描画する
 * 既存の描画は保持される（追加描画のみ）
 */
export function appendToCommittedLayer(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  compiledExpand: CompiledExpand,
  overlapCount = 0,
  brushState?: BrushRenderState,
  sourceLayer?: Layer,
): BrushRenderState {
  if (points.length === 0) {
    return (
      brushState ?? {
        accumulatedDistance: 0,
        tipCanvas: null,
        seed: 0,
        stampCount: 0,
      }
    );
  }

  let currentState = brushState;
  const strokes = expandStrokePoints(points, compiledExpand);
  if (!usesBranchBrushState(style)) {
    for (const stroke of strokes) {
      if (stroke.length > 0) {
        currentState = renderBrushStroke(
          layer,
          stroke,
          style,
          overlapCount,
          currentState,
          sourceLayer ?? layer,
        );
      }
    }
    return currentState ?? createDefaultBrushState();
  }

  const nextBranches: BrushBranchRenderState[] = [
    ...(brushState?.branches ?? []),
  ];
  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    if (stroke.length > 0) {
      const branchState = getBranchBrushState(currentState, i);
      const renderedState = renderBrushStroke(
        layer,
        stroke,
        style,
        overlapCount,
        branchState,
        sourceLayer ?? layer,
      );
      const renderedBranch = stateToBranch(renderedState);
      nextBranches[i] = renderedBranch;
      currentState = mergeBrushState(renderedState, nextBranches);
    }
  }
  return (
    currentState ?? {
      accumulatedDistance: 0,
      tipCanvas: null,
      seed: 0,
      stampCount: 0,
    }
  );
}

/**
 * 作業レイヤーを再描画する（クリア→描画）
 * compositeOperation は適用しない（常に source-over で描画）。
 * 消しゴムプレビューは LayerMeta.compositeOperation による合成時に実現される。
 */
export function renderPendingLayer(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  compiledExpand: CompiledExpand,
  brushState?: BrushRenderState,
  sourceLayer?: Layer,
  previewBaseLayer?: Layer,
): void {
  clearLayer(layer);
  const rendersFullPreview = shouldRenderFullMixedPreview(
    style,
    previewBaseLayer,
  );
  if (rendersFullPreview && previewBaseLayer) {
    layer.ctx.drawImage(previewBaseLayer.canvas, 0, 0);
  }

  if (points.length === 0) return;

  // pending は常に source-over で描画（消しゴムプレビューは LayerMeta.compositeOperation で実現）
  const pendingStyle: StrokeStyle = {
    ...style,
    compositeOperation: "source-over",
  };

  if (!usesBranchBrushState(style)) {
    const strokes = expandStrokePoints(points, compiledExpand);
    for (const stroke of strokes) {
      if (stroke.length > 0) {
        renderBrushStroke(layer, stroke, pendingStyle, 0, brushState);
      }
    }
    return;
  }

  const pendingState = cloneBrushRenderState(brushState);
  const strokes = expandStrokePoints(points, compiledExpand);
  const nextBranches: BrushBranchRenderState[] = [
    ...(pendingState?.branches ?? []),
  ];
  let currentState = pendingState;
  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    if (stroke.length > 0) {
      const branchState = getBranchBrushState(currentState, i);
      const renderedState = renderBrushStroke(
        layer,
        stroke,
        pendingStyle,
        0,
        branchState,
        sourceLayer ?? layer,
      );
      nextBranches[i] = stateToBranch(renderedState);
      currentState = mergeBrushState(renderedState, nextBranches);
    }
  }
}

function shouldRenderFullMixedPreview(
  style: StrokeStyle,
  previewBaseLayer: Layer | undefined,
): boolean {
  return (
    !!previewBaseLayer &&
    style.compositeOperation === "source-over" &&
    style.brush.type === "stamp" &&
    !!style.brush.mixing?.enabled
  );
}

function usesBranchBrushState(style: StrokeStyle): boolean {
  return style.brush.type === "stamp" && !!style.brush.mixing?.enabled;
}

function createDefaultBrushState(): BrushRenderState {
  return {
    accumulatedDistance: 0,
    tipCanvas: null,
    seed: 0,
    stampCount: 0,
  };
}

function getBranchBrushState(
  state: BrushRenderState | undefined,
  branchIndex: number,
): BrushRenderState {
  const base = state ?? createDefaultBrushState();
  const branch = base.branches?.[branchIndex];
  if (!branch) return base;
  return {
    accumulatedDistance: branch.accumulatedDistance,
    tipCanvas: base.tipCanvas,
    seed: base.seed,
    stampCount: branch.stampCount,
    branches: [branch],
  };
}

function stateToBranch(state: BrushRenderState): BrushBranchRenderState {
  const branch = state.branches?.[0];
  return {
    accumulatedDistance:
      branch?.accumulatedDistance ?? state.accumulatedDistance,
    stampCount: branch?.stampCount ?? state.stampCount,
    colorBuffer: branch?.colorBuffer,
    mixedCanvas: branch?.mixedCanvas,
    lastMixingUpdateDistance: branch?.lastMixingUpdateDistance,
  };
}

function mergeBrushState(
  state: BrushRenderState,
  branches: readonly BrushBranchRenderState[],
): BrushRenderState {
  return {
    accumulatedDistance: state.accumulatedDistance,
    tipCanvas: state.tipCanvas,
    seed: state.seed,
    stampCount: state.stampCount,
    branches,
  };
}

function cloneBrushRenderState(
  state: BrushRenderState | undefined,
): BrushRenderState | undefined {
  if (!state) return undefined;
  return {
    accumulatedDistance: state.accumulatedDistance,
    tipCanvas: state.tipCanvas,
    seed: state.seed,
    stampCount: state.stampCount,
    branches: state.branches?.map((branch) => ({
      accumulatedDistance: branch.accumulatedDistance,
      stampCount: branch.stampCount,
      colorBuffer: branch.colorBuffer
        ? copyToPendingColorBuffer(branch.colorBuffer)
        : undefined,
      mixedCanvas: branch.mixedCanvas
        ? copyToPendingColorBuffer(branch.mixedCanvas)
        : undefined,
      lastMixingUpdateDistance: branch.lastMixingUpdateDistance,
    })),
  };
}

function copyToPendingColorBuffer(source: OffscreenCanvas): OffscreenCanvas {
  let buffer = PENDING_COLOR_BUFFER_CACHE.get(source);
  if (
    !buffer ||
    buffer.width !== source.width ||
    buffer.height !== source.height
  ) {
    buffer = new OffscreenCanvas(source.width, source.height);
    PENDING_COLOR_BUFFER_CACHE.set(source, buffer);
  }
  const ctx = getCached2dContext(buffer, "pending color buffer");
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return buffer;
}

function getCached2dContext(
  canvas: OffscreenCanvas,
  label: string,
): OffscreenCanvasRenderingContext2D {
  const cached = CONTEXT_CACHE.get(canvas);
  if (cached) return cached;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`Failed to get 2d context for ${label}`);
  CONTEXT_CACHE.set(canvas, ctx);
  return ctx;
}

/**
 * ビュー変換の型定義
 */
export interface ViewTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * 複数のレイヤーを表示用キャンバスに合成する
 */
export function composeLayers(
  target: CanvasRenderingContext2D,
  layers: readonly Layer[],
  transform?: ViewTransform,
  pendingOverlay?: PendingOverlay,
): void {
  const { canvas } = target;
  target.clearRect(0, 0, canvas.width, canvas.height);

  target.save();

  if (transform) {
    target.translate(transform.offsetX, transform.offsetY);
    target.scale(transform.scale, transform.scale);
  }

  for (const layer of layers) {
    if (!layer.meta.visible) continue;

    const hasPending =
      pendingOverlay && layer.id === pendingOverlay.targetLayerId;
    const needsPreComposite =
      hasPending &&
      (layer.meta.opacity < 1 ||
        (layer.meta.compositeOperation !== undefined &&
          layer.meta.compositeOperation !== "source-over") ||
        (pendingOverlay.layer.meta.compositeOperation !== undefined &&
          pendingOverlay.layer.meta.compositeOperation !== "source-over"));

    if (needsPreComposite) {
      const { workLayer } = pendingOverlay;
      clearLayer(workLayer);
      workLayer.ctx.drawImage(layer.canvas, 0, 0);
      workLayer.ctx.globalAlpha = 1;
      if (pendingOverlay.layer.meta.compositeOperation) {
        workLayer.ctx.globalCompositeOperation =
          pendingOverlay.layer.meta.compositeOperation;
      }
      workLayer.ctx.drawImage(pendingOverlay.layer.canvas, 0, 0);
      workLayer.ctx.globalCompositeOperation = "source-over";

      target.globalAlpha = layer.meta.opacity;
      if (layer.meta.compositeOperation) {
        target.globalCompositeOperation = layer.meta.compositeOperation;
      }
      target.drawImage(workLayer.canvas, 0, 0);
      target.globalAlpha = 1;
      if (layer.meta.compositeOperation) {
        target.globalCompositeOperation = "source-over";
      }
    } else {
      target.globalAlpha = layer.meta.opacity;
      if (layer.meta.compositeOperation) {
        target.globalCompositeOperation = layer.meta.compositeOperation;
      }
      target.drawImage(layer.canvas, 0, 0);

      if (hasPending) {
        target.drawImage(pendingOverlay.layer.canvas, 0, 0);
      }

      target.globalAlpha = 1;
      if (layer.meta.compositeOperation) {
        target.globalCompositeOperation = "source-over";
      }
    }
  }

  target.restore();
}
