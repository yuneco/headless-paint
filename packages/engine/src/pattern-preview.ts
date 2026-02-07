import type { mat3 } from "gl-matrix";
import type { Layer } from "./types";

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

function patternRepetition(
  mode: PatternMode,
): "repeat" | "repeat-x" | "repeat-y" {
  switch (mode) {
    case "repeat-x":
      return "repeat-x";
    case "repeat-y":
      return "repeat-y";
    default:
      return "repeat";
  }
}

function mat3ToDOMMatrix(m: mat3): DOMMatrix {
  return new DOMMatrix([m[0], m[1], m[3], m[4], m[6], m[7]]);
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
): OffscreenCanvas | null {
  if (config.mode === "none") return null;

  const visibleLayers = layers.filter((l) => l.meta.visible);
  if (visibleLayers.length === 0) return null;

  const { width, height } = visibleLayers[0];

  // 基本タイル: 全visibleレイヤーを合成（背景色なし）
  const baseTile = new OffscreenCanvas(width, height);
  const baseCtx = baseTile.getContext("2d");
  if (!baseCtx) return null;

  for (const layer of visibleLayers) {
    baseCtx.globalAlpha = layer.meta.opacity;
    baseCtx.drawImage(layer.canvas, 0, 0);
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
  const pattern = ctx.createPattern(tile, patternRepetition(config.mode));
  if (!pattern) return;

  pattern.setTransform(mat3ToDOMMatrix(transform));

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
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, viewportWidth, viewportHeight);

  ctx.restore();
}
