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
 * InputPoint から座標のみ抽出（単一点用）
 */
function toPoint(p: InputPoint): { x: number; y: number } {
  return { x: p.x, y: p.y };
}

/**
 * pending 描画用のポイント配列を構築
 *
 * committed layer と pending layer は別々に描画されるため、
 * 接続部分で隙間が生じないよう、最後の committed 点を pending の先頭に付与する。
 * これにより両レイヤーのパスが同一座標で重なり、視覚的に連続した線になる。
 */
function buildPendingWithOverlap(
  pendingPoints: readonly { x: number; y: number }[],
  lastCommittedPoint: { x: number; y: number } | null,
): readonly { x: number; y: number }[] {
  if (pendingPoints.length === 0) {
    return pendingPoints;
  }
  if (lastCommittedPoint === null) {
    return pendingPoints;
  }
  return [lastCommittedPoint, ...pendingPoints];
}

/**
 * 新しいストロークセッションを開始する
 */
export function startStrokeSession(
  filterOutput: FilterOutput,
  style: StrokeStyle,
  expand: ExpandConfig,
): StrokeSessionResult {
  const committedPoints = toPoints(filterOutput.committed);
  const pendingPoints = toPoints(filterOutput.pending);

  // lastRenderedCommitIndex: 描画済み committed の最終インデックス
  // 初回で committed があればそのインデックス、なければ -1（未描画）
  const lastRenderedCommitIndex = filterOutput.committed.length - 1;

  const lastCommittedPoint =
    committedPoints.length > 0 ? committedPoints[committedPoints.length - 1] : null;

  const state: StrokeSessionState = {
    allCommitted: [...filterOutput.committed],
    currentPending: [...filterOutput.pending],
    lastRenderedCommitIndex,
    style,
    expand,
  };

  const renderUpdate: RenderUpdate = {
    newlyCommitted: committedPoints,
    currentPending: buildPendingWithOverlap(pendingPoints, lastCommittedPoint),
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
  // filterOutput.committed は filter-pipeline が返す累積値（全 committed 点）
  // session 側で追記すると二重になるため、置換で受け取る
  const newAllCommitted = [...filterOutput.committed];
  const newCurrentPending = [...filterOutput.pending];

  // newlyCommitted: 今回 appendToCommittedLayer に渡す点列
  // lastRenderedCommitIndex から開始し、1点のオーバーラップを含めることで
  // 前回描画のパス終端と今回のパス始端が同一座標で接続される
  const newlyCommittedStartIndex = Math.max(0, state.lastRenderedCommitIndex);
  const newlyCommittedPoints = toPoints(newAllCommitted.slice(newlyCommittedStartIndex));

  const pendingPoints = toPoints(newCurrentPending);
  const lastCommittedPoint =
    newAllCommitted.length > 0 ? toPoint(newAllCommitted[newAllCommitted.length - 1]) : null;

  const newState: StrokeSessionState = {
    allCommitted: newAllCommitted,
    currentPending: newCurrentPending,
    lastRenderedCommitIndex: newAllCommitted.length - 1,
    style: state.style,
    expand: state.expand,
  };

  const renderUpdate: RenderUpdate = {
    newlyCommitted: newlyCommittedPoints,
    currentPending: buildPendingWithOverlap(pendingPoints, lastCommittedPoint),
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
