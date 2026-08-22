import {
  cloneBrushRenderState,
  createDefaultBrushState,
  ensureBrushRenderState,
  getBranchBrushState,
  mergeBrushState,
  renderBrushStroke,
  stateToBranch,
} from "./brush";
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
  alphaLocked = layer.meta.alphaLocked,
): BrushRenderState {
  if (points.length === 0) {
    return brushState ?? createDefaultBrushState();
  }

  const committedStyle = resolveAlphaLockStyle(style, alphaLocked);
  const strokes = expandStrokePoints(points, compiledExpand);
  let currentState = ensureBrushRenderState(brushState, strokes.length);
  const nextBranches: BrushBranchRenderState[] = [...currentState.branches];
  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    if (stroke.length > 0) {
      const branchState = getBranchBrushState(currentState, i);
      const renderedState = renderBrushStroke(
        layer,
        stroke,
        committedStyle,
        overlapCount,
        branchState,
        sourceLayer,
      );
      const renderedBranch = stateToBranch(renderedState);
      nextBranches[i] = renderedBranch;
      currentState = mergeBrushState(currentState, nextBranches);
    }
  }
  return currentState;
}

function resolveAlphaLockStyle(
  style: StrokeStyle,
  alphaLocked: boolean,
): StrokeStyle {
  const compositeOperation = resolveAlphaLockCompositeOperation(
    style.compositeOperation,
    alphaLocked,
  );
  if (compositeOperation === style.compositeOperation) return style;
  return { ...style, compositeOperation };
}

function resolveAlphaLockCompositeOperation(
  compositeOperation: GlobalCompositeOperation,
  alphaLocked: boolean,
): GlobalCompositeOperation {
  if (!alphaLocked) return compositeOperation;
  if (compositeOperation === "source-over") return "source-atop";
  return compositeOperation;
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
  _previewBaseLayer?: Layer,
): void {
  clearLayer(layer);
  // Stateful mixingは確定済みmaterialだけを表示する。pendingで色場を複製・
  // rollbackしないため、engine境界でも明示的なno-opに固定する。
  if (hasStatefulPendingDisabled(style)) return;

  if (points.length === 0) return;

  // pending は常に source-over で描画（消しゴムプレビューは LayerMeta.compositeOperation で実現）
  const pendingStyle: StrokeStyle = {
    ...style,
    compositeOperation: "source-over",
  };

  const strokes = expandStrokePoints(points, compiledExpand);
  let currentState = ensureBrushRenderState(
    cloneBrushRenderState(brushState),
    strokes.length,
  );
  const nextBranches: BrushBranchRenderState[] = [...currentState.branches];
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
      currentState = mergeBrushState(currentState, nextBranches);
    }
  }
}

function hasStatefulPendingDisabled(style: StrokeStyle): boolean {
  return (
    style.brush.type === "bristle" ||
    (style.brush.type === "stamp" && !!style.brush.mixing?.enabled)
  );
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
    const shouldMaskPending =
      !!hasPending &&
      layer.meta.alphaLocked &&
      isSourceOverComposite(pendingOverlay.layer.meta.compositeOperation);
    const needsPreComposite =
      hasPending &&
      (layer.meta.opacity < 1 ||
        (layer.meta.compositeOperation !== undefined &&
          layer.meta.compositeOperation !== "source-over") ||
        (pendingOverlay.layer.meta.compositeOperation !== undefined &&
          pendingOverlay.layer.meta.compositeOperation !== "source-over") ||
        shouldMaskPending);

    if (needsPreComposite) {
      const { workLayer } = pendingOverlay;
      clearLayer(workLayer);
      workLayer.ctx.drawImage(layer.canvas, 0, 0);
      workLayer.ctx.globalAlpha = 1;
      if (shouldMaskPending) {
        workLayer.ctx.globalCompositeOperation = "source-atop";
      } else if (pendingOverlay.layer.meta.compositeOperation) {
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

function isSourceOverComposite(
  compositeOperation: GlobalCompositeOperation | undefined,
): boolean {
  return (
    compositeOperation === undefined || compositeOperation === "source-over"
  );
}
