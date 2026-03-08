import { mat3 as m3 } from "gl-matrix";
import type { mat3 } from "gl-matrix";
import { clearLayer, colorToStyle } from "./layer";
import type {
  BackgroundSettings,
  Layer,
  LayerTransformPreview,
  PendingOverlay,
} from "./types";

export interface RenderOptions {
  background?: BackgroundSettings;
  pendingOverlay?: PendingOverlay;
  layerTransformPreview?: LayerTransformPreview;
}

/**
 * ビュー変換を適用してレイヤーを描画
 * @param layer 描画するレイヤー
 * @param ctx 描画先のコンテキスト
 * @param transform 適用するビュー変換（mat3形式）
 */
export function renderLayerWithTransform(
  layer: Layer,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  transform: mat3,
): void {
  ctx.save();

  // 拡大時（scale >= 1）はスムージングを無効にしてにじみを防ぐ
  const scale = Math.hypot(transform[0], transform[1]);
  ctx.imageSmoothingEnabled = scale < 1;

  // mat3 を setTransform に適用
  // 呼び出し側でDPRスケーリングを含めた変換行列を渡すことを期待
  // mat3: [a, b, 0, c, d, 0, tx, ty, 1] (column-major)
  // setTransform(a, b, c, d, tx, ty)
  ctx.setTransform(
    transform[0], // a
    transform[1], // b
    transform[3], // c
    transform[4], // d
    transform[6], // tx
    transform[7], // ty
  );

  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}

/**
 * 複数レイヤーを順番に合成描画
 * @param layers 描画するレイヤーの配列（背面から前面順）
 * @param ctx 描画先のコンテキスト
 * @param transform 適用するビュー変換（mat3形式）
 */
export function renderLayers(
  layers: readonly Layer[],
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  transform: mat3,
  options?: RenderOptions,
): void {
  // 拡大時（scale >= 1）はスムージングを無効にしてにじみを防ぐ
  const scale = Math.hypot(transform[0], transform[1]);
  const smoothing = scale < 1;

  // 背景描画（レイヤー領域にビュー変換を適用して描画）
  if (options?.background?.visible && layers.length > 0) {
    const { width, height } = layers[0];
    ctx.save();
    ctx.setTransform(
      transform[0],
      transform[1],
      transform[3],
      transform[4],
      transform[6],
      transform[7],
    );
    ctx.fillStyle = colorToStyle(options.background.color);
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  const overlay = options?.pendingOverlay;
  const transformPreview = options?.layerTransformPreview;

  for (const layer of layers) {
    // 非表示レイヤーはスキップ
    if (!layer.meta.visible) continue;

    const hasPending = overlay && layer.id === overlay.targetLayerId;
    const hasTransformPreview =
      transformPreview && layer.id === transformPreview.layerId;
    const needsPreComposite =
      hasPending &&
      (layer.meta.opacity < 1 ||
        (layer.meta.compositeOperation !== undefined &&
          layer.meta.compositeOperation !== "source-over") ||
        (overlay.layer.meta.compositeOperation !== undefined &&
          overlay.layer.meta.compositeOperation !== "source-over"));

    // ビュー変換にレイヤーローカル変換を合成: viewTransform * layerTransform
    let effectiveTransform: mat3;
    if (hasTransformPreview) {
      effectiveTransform = m3.multiply(
        m3.create(),
        transform,
        transformPreview.matrix,
      );
    } else {
      effectiveTransform = transform;
    }

    if (needsPreComposite) {
      // プレ合成: work に committed + pending を合成し、work を layer の meta で描画
      const { workLayer } = overlay;
      clearLayer(workLayer);

      // committed を workLayer に描画（変換プレビュー時はレイヤーローカル変換を適用）
      if (hasTransformPreview) {
        workLayer.ctx.save();
        workLayer.ctx.setTransform(
          transformPreview.matrix[0],
          transformPreview.matrix[1],
          transformPreview.matrix[3],
          transformPreview.matrix[4],
          transformPreview.matrix[6],
          transformPreview.matrix[7],
        );
        workLayer.ctx.drawImage(layer.canvas, 0, 0);
        workLayer.ctx.restore();
      } else {
        workLayer.ctx.drawImage(layer.canvas, 0, 0);
      }

      workLayer.ctx.globalAlpha = 1;
      if (overlay.layer.meta.compositeOperation) {
        workLayer.ctx.globalCompositeOperation =
          overlay.layer.meta.compositeOperation;
      }

      // pending も同様に変換プレビューを適用
      if (hasTransformPreview) {
        workLayer.ctx.save();
        workLayer.ctx.setTransform(
          transformPreview.matrix[0],
          transformPreview.matrix[1],
          transformPreview.matrix[3],
          transformPreview.matrix[4],
          transformPreview.matrix[6],
          transformPreview.matrix[7],
        );
        workLayer.ctx.drawImage(overlay.layer.canvas, 0, 0);
        workLayer.ctx.restore();
      } else {
        workLayer.ctx.drawImage(overlay.layer.canvas, 0, 0);
      }
      workLayer.ctx.globalCompositeOperation = "source-over";

      // workLayer をビュー変換のみで描画（ローカル変換は workLayer 内で適用済み）
      ctx.save();
      ctx.imageSmoothingEnabled = smoothing;
      ctx.globalAlpha = layer.meta.opacity;
      if (layer.meta.compositeOperation) {
        ctx.globalCompositeOperation = layer.meta.compositeOperation;
      }
      ctx.setTransform(
        transform[0],
        transform[1],
        transform[3],
        transform[4],
        transform[6],
        transform[7],
      );
      ctx.drawImage(workLayer.canvas, 0, 0);
      ctx.restore();
    } else {
      // フラット描画
      ctx.save();
      ctx.imageSmoothingEnabled = smoothing;
      ctx.globalAlpha = layer.meta.opacity;
      if (layer.meta.compositeOperation) {
        ctx.globalCompositeOperation = layer.meta.compositeOperation;
      }
      ctx.setTransform(
        effectiveTransform[0],
        effectiveTransform[1],
        effectiveTransform[3],
        effectiveTransform[4],
        effectiveTransform[6],
        effectiveTransform[7],
      );
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();

      // pending をフラットに描画（プレ合成不要な場合）
      if (hasPending) {
        ctx.save();
        ctx.imageSmoothingEnabled = smoothing;
        ctx.globalAlpha = layer.meta.opacity;
        if (layer.meta.compositeOperation) {
          ctx.globalCompositeOperation = layer.meta.compositeOperation;
        }
        ctx.setTransform(
          effectiveTransform[0],
          effectiveTransform[1],
          effectiveTransform[3],
          effectiveTransform[4],
          effectiveTransform[6],
          effectiveTransform[7],
        );
        ctx.drawImage(overlay.layer.canvas, 0, 0);
        ctx.restore();
      }
    }
  }
}
