import type { ExpandConfig } from "@headless-paint/engine";
import type { FilterOutput, FilterPipelineConfig, InputPoint } from "@headless-paint/input";
import type {
  RenderUpdate,
  StrokeCommand,
  StrokeSessionResult,
  StrokeSessionState,
  StrokeStyle,
} from "./types";

/**
 * InputPoint から Point への変換（座標のみ抽出）
 */
function toPoints(inputPoints: readonly InputPoint[]): readonly { x: number; y: number }[] {
  return inputPoints.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * 新しいストロークセッションを開始する
 */
export function startStrokeSession(
  filterOutput: FilterOutput,
  style: StrokeStyle,
  expand: ExpandConfig,
): StrokeSessionResult {
  const state: StrokeSessionState = {
    allCommitted: [...filterOutput.committed],
    currentPending: [...filterOutput.pending],
    lastRenderedCommitIndex: -1,
    style,
    expand,
  };

  const renderUpdate: RenderUpdate = {
    newlyCommitted: toPoints(filterOutput.committed),
    currentPending: toPoints(filterOutput.pending),
    style,
    expand,
  };

  return { state, renderUpdate };
}

/**
 * セッションに点を追加する
 */
export function addPointToSession(
  state: StrokeSessionState,
  filterOutput: FilterOutput,
): StrokeSessionResult {
  // filterOutput.committed を allCommitted に追加
  const newAllCommitted = [...state.allCommitted, ...filterOutput.committed];

  // filterOutput.pending を currentPending に設定
  const newCurrentPending = [...filterOutput.pending];

  // lastRenderedCommitIndex から新しく追加された点を newlyCommitted として計算
  const newlyCommittedStartIndex = state.lastRenderedCommitIndex + 1;
  const newlyCommittedPoints = newAllCommitted.slice(newlyCommittedStartIndex);

  const newState: StrokeSessionState = {
    allCommitted: newAllCommitted,
    currentPending: newCurrentPending,
    lastRenderedCommitIndex: newAllCommitted.length - 1,
    style: state.style,
    expand: state.expand,
  };

  const renderUpdate: RenderUpdate = {
    newlyCommitted: toPoints(newlyCommittedPoints),
    currentPending: toPoints(newCurrentPending),
    style: state.style,
    expand: state.expand,
  };

  return { state: newState, renderUpdate };
}

/**
 * セッションを終了し、履歴保存用のコマンドを生成する
 */
export function endStrokeSession(
  state: StrokeSessionState,
  inputPoints: readonly InputPoint[],
  filterPipeline: FilterPipelineConfig,
): StrokeCommand | null {
  // 有効なストローク（2点以上）の場合のみコマンドを生成
  const totalPoints = state.allCommitted.length + state.currentPending.length;
  if (totalPoints < 2) {
    return null;
  }

  return {
    type: "stroke",
    inputPoints: [...inputPoints],
    filterPipeline,
    expand: state.expand,
    color: state.style.color,
    lineWidth: state.style.lineWidth,
    timestamp: Date.now(),
  };
}

/**
 * ストロークコマンドを作成する（ヘルパー関数）
 */
export function createStrokeCommand(
  inputPoints: readonly InputPoint[],
  filterPipeline: FilterPipelineConfig,
  expand: ExpandConfig,
  color: StrokeStyle["color"],
  lineWidth: number,
): StrokeCommand {
  return {
    type: "stroke",
    inputPoints: [...inputPoints],
    filterPipeline,
    expand,
    color,
    lineWidth,
    timestamp: Date.now(),
  };
}

/**
 * クリアコマンドを作成する（ヘルパー関数）
 */
export function createClearCommand(): { type: "clear"; timestamp: number } {
  return {
    type: "clear",
    timestamp: Date.now(),
  };
}
