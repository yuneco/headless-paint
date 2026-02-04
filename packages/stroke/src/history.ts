import type { Layer } from "@headless-paint/engine";
import { createCheckpoint } from "./checkpoint";
import type { Checkpoint, Command, HistoryConfig, HistoryState } from "./types";
import { DEFAULT_HISTORY_CONFIG } from "./types";

/**
 * 新しい履歴状態を作成
 */
export function createHistoryState(width: number, height: number): HistoryState {
  return {
    commands: [],
    checkpoints: [],
    currentIndex: -1,
    layerWidth: width,
    layerHeight: height,
  };
}

/**
 * コマンドを履歴に追加
 * - 現在位置より後のコマンドは削除される（Undo後の新操作）
 * - checkpointInterval ごとにチェックポイントを作成
 * - 最大履歴数を超えた場合は古いエントリを削除
 */
export function pushCommand(
  state: HistoryState,
  command: Command,
  layer: Layer,
  config: HistoryConfig = DEFAULT_HISTORY_CONFIG,
): HistoryState {
  // 現在位置より後のコマンドを削除
  const newCommands = [...state.commands.slice(0, state.currentIndex + 1), command];
  const newIndex = newCommands.length - 1;

  // 現在位置より後のチェックポイントを削除
  let newCheckpoints = state.checkpoints.filter((cp) => cp.commandIndex <= state.currentIndex);

  // チェックポイント作成の判定
  const shouldCreateCheckpoint = (newIndex + 1) % config.checkpointInterval === 0;

  if (shouldCreateCheckpoint) {
    const checkpoint = createCheckpoint(layer, newIndex);
    newCheckpoints = [...newCheckpoints, checkpoint];

    // 最大チェックポイント数を超えた場合は古いものを削除
    if (newCheckpoints.length > config.maxCheckpoints) {
      newCheckpoints = newCheckpoints.slice(-config.maxCheckpoints);
    }
  }

  // 最大履歴数を超えた場合
  if (newCommands.length > config.maxHistorySize) {
    const removeCount = newCommands.length - config.maxHistorySize;
    const trimmedCommands = newCommands.slice(removeCount);

    // チェックポイントのインデックスを調整
    newCheckpoints = newCheckpoints
      .filter((cp) => cp.commandIndex >= removeCount)
      .map((cp) => ({
        ...cp,
        commandIndex: cp.commandIndex - removeCount,
      }));

    return {
      ...state,
      commands: trimmedCommands,
      checkpoints: newCheckpoints,
      currentIndex: trimmedCommands.length - 1,
    };
  }

  return {
    ...state,
    commands: newCommands,
    checkpoints: newCheckpoints,
    currentIndex: newIndex,
  };
}

/**
 * Undo可能かどうか
 */
export function canUndo(state: HistoryState): boolean {
  return state.currentIndex >= 0;
}

/**
 * Redo可能かどうか
 */
export function canRedo(state: HistoryState): boolean {
  return state.currentIndex < state.commands.length - 1;
}

/**
 * Undo（1つ前の状態に戻る）
 */
export function undo(state: HistoryState): HistoryState {
  if (!canUndo(state)) {
    return state;
  }
  return {
    ...state,
    currentIndex: state.currentIndex - 1,
  };
}

/**
 * Redo（1つ先の状態に進む）
 */
export function redo(state: HistoryState): HistoryState {
  if (!canRedo(state)) {
    return state;
  }
  return {
    ...state,
    currentIndex: state.currentIndex + 1,
  };
}

/**
 * 現在位置に対応する最適なチェックポイントを取得
 */
export function findBestCheckpoint(state: HistoryState): Checkpoint | undefined {
  // currentIndex以下で最も近いチェックポイントを探す
  let bestCheckpoint: Checkpoint | undefined;
  for (const cp of state.checkpoints) {
    if (cp.commandIndex <= state.currentIndex) {
      if (!bestCheckpoint || cp.commandIndex > bestCheckpoint.commandIndex) {
        bestCheckpoint = cp;
      }
    }
  }
  return bestCheckpoint;
}

/**
 * チェックポイント後にリプレイが必要なコマンドを取得
 */
export function getCommandsToReplay(
  state: HistoryState,
  fromCheckpoint?: Checkpoint,
): readonly Command[] {
  const startIndex = fromCheckpoint ? fromCheckpoint.commandIndex + 1 : 0;
  return state.commands.slice(startIndex, state.currentIndex + 1);
}
