import type {
  CompiledPipeline,
  CompiledTransform,
  PipelineConfig,
  Point,
} from "./types";
import { getPlugin } from "./plugins";

/**
 * パイプライン設定をコンパイル
 * 設定変更時に1回だけ呼び出す
 */
export function compilePipeline(config: PipelineConfig): CompiledPipeline {
  const compiledTransforms: CompiledTransform[] = [];
  let totalOutputCount = 1;

  for (const transformConfig of config.transforms) {
    const plugin = getPlugin(transformConfig.type);
    const compiled = plugin.compile(transformConfig.config);
    const outputCount = plugin.getOutputCount(transformConfig.config);

    totalOutputCount *= outputCount;

    compiledTransforms.push({
      type: transformConfig.type,
      outputCount,
      _expand: (points) => plugin.expand(points, compiled),
    });
  }

  return {
    config,
    outputCount: totalOutputCount,
    _transforms: compiledTransforms,
  };
}

/**
 * 単一の点をパイプラインで展開
 * ストローク中の各点で呼び出す（高速）
 */
export function expandPoint(point: Point, compiled: CompiledPipeline): Point[] {
  if (compiled._transforms.length === 0) {
    return [point];
  }

  // 直列処理: 各変換を順番に適用
  let current: Point[] = [point];
  for (const transform of compiled._transforms) {
    current = transform._expand(current);
  }
  return current;
}

/**
 * ストローク全体をパイプラインで展開
 * 履歴リプレイ時に使用
 */
export function expandStroke(
  inputPoints: readonly Point[],
  compiled: CompiledPipeline,
): Point[][] {
  if (inputPoints.length === 0) {
    return [];
  }

  // outputCount 分のストロークを初期化
  const strokes: Point[][] = Array.from({ length: compiled.outputCount }, () => []);

  // 各入力点を展開して対応するストロークに追加
  for (const point of inputPoints) {
    const expandedPoints = expandPoint(point, compiled);
    for (let i = 0; i < expandedPoints.length; i++) {
      strokes[i].push(expandedPoints[i]);
    }
  }

  return strokes;
}
