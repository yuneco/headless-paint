import { renderBrushStroke } from "./brush-render";
import { expandStrokePoints } from "./expand";
import { clearLayer } from "./layer";
import type {
  BrushRenderState,
  CompiledExpand,
  Layer,
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
  for (const stroke of strokes) {
    if (stroke.length > 0) {
      currentState = renderBrushStroke(
        layer,
        stroke,
        style,
        overlapCount,
        currentState,
      );
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
): void {
  clearLayer(layer);

  if (points.length === 0) return;

  // pending は常に source-over で描画（消しゴムプレビューは LayerMeta.compositeOperation で実現）
  const pendingStyle: StrokeStyle = {
    ...style,
    compositeOperation: "source-over",
  };

  const strokes = expandStrokePoints(points, compiledExpand);
  for (const stroke of strokes) {
    if (stroke.length > 0) {
      renderBrushStroke(layer, stroke, pendingStyle, 0, brushState);
    }
  }
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

    target.globalAlpha = layer.meta.opacity;
    if (layer.meta.compositeOperation) {
      target.globalCompositeOperation = layer.meta.compositeOperation;
    }
    target.drawImage(layer.canvas, 0, 0);
    if (layer.meta.compositeOperation) {
      target.globalCompositeOperation = "source-over";
    }
  }

  target.restore();
}
