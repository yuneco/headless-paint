import type {
  CompiledPipeline,
  Point,
  StrokeSessionEndResult,
  StrokeSessionResult,
  StrokeSessionState,
} from "./types";
import { expandPoint } from "./pipeline";

/**
 * 新しいストロークセッションを開始
 */
export function startStrokeSession(
  point: Point,
  compiled: CompiledPipeline,
): StrokeSessionResult {
  const expandedPoints = expandPoint(point, compiled);

  // 各展開点を独立したストロークの開始点として初期化
  const expandedStrokes = expandedPoints.map((p) => [p]);

  const state: StrokeSessionState = {
    inputPoints: [point],
    expandedStrokes,
    pipelineConfig: compiled.config,
  };

  return {
    state,
    expandedStrokes,
  };
}

/**
 * セッションに点を追加
 */
export function addPointToSession(
  state: StrokeSessionState,
  point: Point,
  compiled: CompiledPipeline,
): StrokeSessionResult {
  const expandedPoints = expandPoint(point, compiled);

  // 入力点を追加
  const newInputPoints = [...state.inputPoints, point];

  // 各展開ストロークに対応する点を追加
  const newExpandedStrokes = state.expandedStrokes.map((stroke, i) => [
    ...stroke,
    expandedPoints[i],
  ]);

  const newState: StrokeSessionState = {
    inputPoints: newInputPoints,
    expandedStrokes: newExpandedStrokes,
    pipelineConfig: state.pipelineConfig,
  };

  return {
    state: newState,
    expandedStrokes: newExpandedStrokes,
  };
}

/**
 * セッションを終了し、履歴保存用のデータを取得
 */
export function endStrokeSession(state: StrokeSessionState): StrokeSessionEndResult {
  // 有効なストローク（2点以上）のみをフィルタ
  const validStrokes = state.expandedStrokes.filter((stroke) => stroke.length >= 2);

  return {
    inputPoints: state.inputPoints,
    validStrokes,
    pipelineConfig: state.pipelineConfig,
  };
}
