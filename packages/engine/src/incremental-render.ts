import { drawPath } from "./draw";
import { expandStroke } from "./expand";
import { clearLayer, colorToStyle } from "./layer";
import type { CompiledExpand, Layer, Point, StrokeStyle } from "./types";

/**
 * 確定レイヤーに新しく確定した点を追加描画する
 * 既存の描画は保持される（追加描画のみ）
 */
export function appendToCommittedLayer(
  layer: Layer,
  points: readonly Point[],
  style: StrokeStyle,
  compiledExpand: CompiledExpand,
): void {
  if (points.length === 0) return;

  const strokes = expandStroke(points, compiledExpand);
  for (const stroke of strokes) {
    if (stroke.length > 0) {
      drawPath(layer, stroke, style.color, style.lineWidth);
    }
  }
}

/**
 * 作業レイヤーを再描画する（クリア→描画）
 */
export function renderPendingLayer(
  layer: Layer,
  points: readonly Point[],
  style: StrokeStyle,
  compiledExpand: CompiledExpand,
): void {
  clearLayer(layer);

  if (points.length === 0) return;

  const strokes = expandStroke(points, compiledExpand);
  for (const stroke of strokes) {
    if (stroke.length > 0) {
      drawPath(layer, stroke, style.color, style.lineWidth);
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
    target.drawImage(layer.canvas, 0, 0);
  }

  target.restore();
}
