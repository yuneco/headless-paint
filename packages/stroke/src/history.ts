import type { Layer } from "@headless-paint/engine";
import { createCheckpoint } from "./checkpoint";
import type {
  Checkpoint,
  Command,
  DrawCommand,
  HistoryConfig,
  HistoryState,
} from "./types";
import {
  DEFAULT_HISTORY_CONFIG,
  isDrawCommand,
  isLayerDrawCommand,
} from "./types";

/**
 * 新しい履歴状態を作成
 */
export function createHistoryState(
  width: number,
  height: number,
): HistoryState {
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
 * - 描画コマンド: checkpointInterval ごとにチェックポイントを作成
 * - remove-layer: チェックポイントを強制作成
 * - add-layer / reorder-layer: チェックポイント不要（layer=null）
 * - 最大履歴数を超えた場合は古いエントリを削除
 */
export function pushCommand(
  state: HistoryState,
  command: Command,
  layer: Layer | null,
  config: HistoryConfig = DEFAULT_HISTORY_CONFIG,
): HistoryState {
  // 現在位置より後のコマンドを削除
  const newCommands = [
    ...state.commands.slice(0, state.currentIndex + 1),
    command,
  ];
  const newIndex = newCommands.length - 1;

  // 現在位置より後のチェックポイントを削除
  let newCheckpoints = state.checkpoints.filter(
    (cp) => cp.commandIndex <= state.currentIndex,
  );

  // チェックポイント作成の判定
  if (layer !== null) {
    if (command.type === "remove-layer") {
      // remove-layer: 強制作成
      const checkpoint = createCheckpoint(layer, newIndex);
      newCheckpoints = [...newCheckpoints, checkpoint];
    } else if (isDrawCommand(command)) {
      // 描画コマンド: interval に従う
      const shouldCreateCheckpoint =
        (newIndex + 1) % config.checkpointInterval === 0;
      if (shouldCreateCheckpoint) {
        const checkpoint = createCheckpoint(layer, newIndex);
        newCheckpoints = [...newCheckpoints, checkpoint];
      }
    }

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
 * 特定レイヤーの最適なチェックポイントを取得
 */
export function findBestCheckpointForLayer(
  state: HistoryState,
  layerId: string,
): Checkpoint | undefined {
  let bestCheckpoint: Checkpoint | undefined;
  for (const cp of state.checkpoints) {
    if (cp.layerId === layerId && cp.commandIndex <= state.currentIndex) {
      if (!bestCheckpoint || cp.commandIndex > bestCheckpoint.commandIndex) {
        bestCheckpoint = cp;
      }
    }
  }
  return bestCheckpoint;
}

/**
 * 特定レイヤーのリプレイ対象コマンドを取得（描画コマンドのみ）
 */
export function getCommandsToReplayForLayer(
  state: HistoryState,
  layerId: string,
  fromCheckpoint?: Checkpoint,
): readonly DrawCommand[] {
  const startIndex = fromCheckpoint ? fromCheckpoint.commandIndex + 1 : 0;
  const commands: DrawCommand[] = [];
  for (let i = startIndex; i <= state.currentIndex; i++) {
    const cmd = state.commands[i];
    if (cmd.type === "wrap-shift") {
      commands.push(cmd);
    } else if (isLayerDrawCommand(cmd) && cmd.layerId === layerId) {
      commands.push(cmd);
    }
  }
  return commands;
}

/**
 * 2つのindex間で影響するレイヤーIDセットを取得
 */
export function getAffectedLayerIds(
  state: HistoryState,
  fromIndex: number,
  toIndex: number,
): ReadonlySet<string> {
  const ids = new Set<string>();
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  for (let i = lo; i <= hi; i++) {
    if (i < 0 || i >= state.commands.length) continue;
    const cmd = state.commands[i];
    if (isLayerDrawCommand(cmd)) {
      ids.add(cmd.layerId);
    }
  }
  return ids;
}

/**
 * wrap-shift の累積オフセットを算出（グローバル、全レイヤー共通）
 */
export function computeCumulativeOffset(state: HistoryState): {
  readonly x: number;
  readonly y: number;
} {
  let x = 0;
  let y = 0;
  for (let i = 0; i <= state.currentIndex; i++) {
    const cmd = state.commands[i];
    if (cmd.type === "wrap-shift") {
      x += cmd.dx;
      y += cmd.dy;
    }
  }
  const w = state.layerWidth;
  const h = state.layerHeight;
  return { x: ((x % w) + w) % w, y: ((y % h) + h) % h };
}

// ============================================================
// 後方互換ヘルパー（削除予定の旧API — 内部テストで利用中のため残存）
// ============================================================

/**
 * @deprecated Use findBestCheckpointForLayer instead
 */
export function findBestCheckpoint(
  state: HistoryState,
): Checkpoint | undefined {
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
 * @deprecated Use getCommandsToReplayForLayer instead
 */
export function getCommandsToReplay(
  state: HistoryState,
  fromCheckpoint?: Checkpoint,
): readonly Command[] {
  const startIndex = fromCheckpoint ? fromCheckpoint.commandIndex + 1 : 0;
  return state.commands.slice(startIndex, state.currentIndex + 1);
}
