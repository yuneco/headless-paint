import { mat3 as m3 } from "gl-matrix";
import type { mat3 } from "gl-matrix";
import { colorToStyle } from "./layer";
import type { BackgroundSettings, Layer } from "./types";

// ---- Types ----

export type PatternMode = "none" | "grid" | "repeat-x" | "repeat-y";

export interface PatternPreviewConfig {
  readonly mode: PatternMode;
  /** パターンの不透明度 (0.0 - 1.0) */
  readonly opacity: number;
  /** gridモードでの交互行水平オフセット (0.0 - 1.0) */
  readonly offsetX: number;
  /** gridモードでの交互列垂直オフセット (0.0 - 1.0) */
  readonly offsetY: number;
}

export const DEFAULT_PATTERN_PREVIEW_CONFIG: PatternPreviewConfig = {
  mode: "none",
  opacity: 0.3,
  offsetX: 0,
  offsetY: 0,
};

// ---- Internal helpers ----

function viewportBoundsInLayerSpace(
  transform: mat3,
  viewportWidth: number,
  viewportHeight: number,
): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  const inverse = m3.create();
  if (!m3.invert(inverse, transform)) {
    return null;
  }

  const corners = [
    transformPoint(inverse, 0, 0),
    transformPoint(inverse, viewportWidth, 0),
    transformPoint(inverse, viewportWidth, viewportHeight),
    transformPoint(inverse, 0, viewportHeight),
  ];

  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
}

function tileIndexRange(
  min: number,
  max: number,
  size: number,
): {
  start: number;
  end: number;
} {
  return {
    start: Math.floor(min / size) - 1,
    end: Math.ceil(max / size) + 1,
  };
}

function transformPoint(
  m: mat3,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: m[0] * x + m[3] * y + m[6],
    y: m[1] * x + m[4] * y + m[7],
  };
}

// ---- Public API ----

/**
 * レイヤー内容からパターンタイルを生成する。
 *
 * @param layers タイル化するレイヤー群
 * @param config パターン設定
 * @returns パターンタイル用の OffscreenCanvas、または null（mode=none / visibleレイヤーなし）
 */
export function createPatternTile(
  layers: readonly Layer[],
  config: PatternPreviewConfig,
  background?: BackgroundSettings,
): OffscreenCanvas | null {
  if (config.mode === "none") return null;

  const visibleLayers = layers.filter((l) => l.meta.visible);
  if (visibleLayers.length === 0) return null;

  const { width, height } = visibleLayers[0];

  // 基本タイル: 背景色 + 全visibleレイヤーをブレンドモード付きで合成
  const baseTile = new OffscreenCanvas(width, height);
  const baseCtx = baseTile.getContext("2d");
  if (!baseCtx) return null;

  if (background?.visible) {
    baseCtx.fillStyle = colorToStyle(background.color);
    baseCtx.fillRect(0, 0, width, height);
  }

  for (const layer of visibleLayers) {
    baseCtx.globalAlpha = layer.meta.opacity;
    if (layer.meta.compositeOperation) {
      baseCtx.globalCompositeOperation = layer.meta.compositeOperation;
    }
    baseCtx.drawImage(layer.canvas, 0, 0);
    baseCtx.globalAlpha = 1;
    baseCtx.globalCompositeOperation = "source-over";
  }

  // オフセットなし or grid以外 → 基本タイルをそのまま返す
  if (
    config.mode !== "grid" ||
    (config.offsetX === 0 && config.offsetY === 0)
  ) {
    return baseTile;
  }

  // オフセットメタタイル生成
  if (config.offsetX > 0) {
    // W × 2H メタタイル（交互行の水平ずらし）
    const metaTile = new OffscreenCanvas(width, height * 2);
    const metaCtx = metaTile.getContext("2d");
    if (!metaCtx) return baseTile;

    // 行0: 基本タイル
    metaCtx.drawImage(baseTile, 0, 0);
    // 行1: 水平オフセット + ラップアラウンド
    const ox = Math.round(width * config.offsetX);
    metaCtx.drawImage(baseTile, ox, height);
    metaCtx.drawImage(baseTile, ox - width, height);

    return metaTile;
  }

  // offsetY > 0
  // 2W × H メタタイル（交互列の垂直ずらし）
  const metaTile = new OffscreenCanvas(width * 2, height);
  const metaCtx = metaTile.getContext("2d");
  if (!metaCtx) return baseTile;

  // 列0: 基本タイル
  metaCtx.drawImage(baseTile, 0, 0);
  // 列1: 垂直オフセット + ラップアラウンド
  const oy = Math.round(height * config.offsetY);
  metaCtx.drawImage(baseTile, width, oy);
  metaCtx.drawImage(baseTile, width, oy - height);

  return metaTile;
}

/**
 * パターンプレビューをviewport全体に描画する（レイヤー領域は evenodd クリップで除外）。
 *
 * @param ctx 描画先のコンテキスト
 * @param tile createPatternTile で生成したタイル
 * @param config パターン設定
 * @param transform ビュー変換（DPR未調整のオリジナル）
 * @param viewportWidth ビューポート幅（CSS pixel）
 * @param viewportHeight ビューポート高さ（CSS pixel）
 * @param layerWidth レイヤー幅
 * @param layerHeight レイヤー高さ
 */
export function renderPatternPreview(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  tile: OffscreenCanvas,
  config: PatternPreviewConfig,
  transform: mat3,
  viewportWidth: number,
  viewportHeight: number,
  layerWidth: number,
  layerHeight: number,
): void {
  const bounds = viewportBoundsInLayerSpace(
    transform,
    viewportWidth,
    viewportHeight,
  );
  if (!bounds) {
    return;
  }

  ctx.save();

  // evenodd クリップパスでレイヤー領域を除外
  ctx.beginPath();
  // 外枠: viewport全体
  ctx.rect(0, 0, viewportWidth, viewportHeight);
  // 内枠: レイヤー四隅をスクリーン座標に変換
  const tl = transformPoint(transform, 0, 0);
  const tr = transformPoint(transform, layerWidth, 0);
  const br = transformPoint(transform, layerWidth, layerHeight);
  const bl = transformPoint(transform, 0, layerHeight);
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  ctx.clip("evenodd");

  // パターンを半透明で描画
  ctx.globalAlpha = config.opacity;
  ctx.imageSmoothingEnabled = Math.hypot(transform[0], transform[1]) < 1;
  ctx.transform(
    transform[0],
    transform[1],
    transform[3],
    transform[4],
    transform[6],
    transform[7],
  );

  const xRange =
    config.mode === "repeat-y"
      ? { start: 0, end: 0 }
      : tileIndexRange(bounds.minX, bounds.maxX, tile.width);
  const yRange =
    config.mode === "repeat-x"
      ? { start: 0, end: 0 }
      : tileIndexRange(bounds.minY, bounds.maxY, tile.height);

  for (let y = yRange.start; y <= yRange.end; y++) {
    for (let x = xRange.start; x <= xRange.end; x++) {
      ctx.drawImage(tile, x * tile.width, y * tile.height);
    }
  }

  ctx.restore();
}
