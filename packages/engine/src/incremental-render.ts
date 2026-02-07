import { drawVariableWidthPath } from "./draw";
import { expandStrokePoints } from "./expand";
import { clearLayer } from "./layer";
import type { CompiledExpand, Layer, StrokePoint, StrokeStyle } from "./types";

/**
 * 確定レイヤーに新しく確定した点を追加描画する
 * 既存の描画は保持される（追加描画のみ）
 */
export function appendToCommittedLayer(
  layer: Layer,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  compiledExpand: CompiledExpand,
): void {
  if (points.length === 0) return;

  const strokes = expandStrokePoints(points, compiledExpand);
  for (const stroke of strokes) {
    if (stroke.length > 0) {
      drawVariableWidthPath(
        layer,
        stroke,
        style.color,
        style.lineWidth,
        style.pressureSensitivity ?? 0,
        style.pressureCurve,
        style.compositeOperation,
      );
    }
  }
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
): void {
  clearLayer(layer);

  if (points.length === 0) return;

  const strokes = expandStrokePoints(points, compiledExpand);
  for (const stroke of strokes) {
    if (stroke.length > 0) {
      drawVariableWidthPath(
        layer,
        stroke,
        style.color,
        style.lineWidth,
        style.pressureSensitivity ?? 0,
        style.pressureCurve,
      );
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
