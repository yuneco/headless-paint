import type {
  CompiledSymmetry,
  Point,
  SymmetryConfig,
  TransformPlugin,
} from "../types";
import {
  compileSymmetry,
  expandSymmetry,
  getSymmetryCount,
} from "../symmetry";

/**
 * 対称変換プラグイン
 * symmetry.ts のラッパーとして機能し、TransformPlugin インターフェースを実装
 */
export const symmetryPlugin: TransformPlugin<SymmetryConfig, CompiledSymmetry> =
  {
    type: "symmetry",

    compile(config: SymmetryConfig): CompiledSymmetry {
      return compileSymmetry(config);
    },

    expand(points: readonly Point[], compiled: CompiledSymmetry): Point[] {
      // 入力点群を展開（flatMapで結合）
      const result: Point[] = [];
      for (const point of points) {
        const expanded = expandSymmetry(point, compiled);
        result.push(...expanded);
      }
      return result;
    },

    getOutputCount(config: SymmetryConfig): number {
      return getSymmetryCount(config);
    },
  };
