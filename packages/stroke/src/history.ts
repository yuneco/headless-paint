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
  isStructuralCommand,
} from "./types";

/**
 * 新しい履歴状態を作成
 */
export function createHistoryState<TCustom = never>(
  width: number,
  height: number,
): HistoryState<TCustom> {
  return {
    commands: [],
    checkpoints: [],
    currentIndex: -1,
    layerWidth: width,
    layerHeight: height,
    drawsSinceCheckpoint: 0,
  };
}

/**
 * DrawCommand の数をカウントする
 */
function countDrawCommands<TCustom>(
  commands: readonly Command<TCustom>[],
  upTo?: number,
): number {
  const end = upTo !== undefined ? upTo + 1 : commands.length;
  let count = 0;
  for (let i = 0; i < end; i++) {
    if (isDrawCommand(commands[i])) count++;
  }
  return count;
}

/**
 * コマンドを履歴に追加
 * - 現在位置より後のコマンドは削除される（Undo後の新操作）
 * - 描画コマンド: drawsSinceCheckpoint が checkpointInterval に達したらチェックポイントを作成
 * - remove-layer: チェックポイントを強制作成
 * - add-layer / reorder-layer: チェックポイント不要（layer=null）
 * - 最大履歴数は DrawCommand の数でカウント
 */
export function pushCommand<TCustom = never>(
  state: HistoryState<TCustom>,
  command: Command<TCustom>,
  layer: Layer | null,
  config: HistoryConfig = DEFAULT_HISTORY_CONFIG,
): HistoryState<TCustom> {
  // 現在位置より後のコマンドを削除
  const newCommands = [
    ...state.commands.slice(0, state.currentIndex + 1),
    command,
  ];
  const newIndex = newCommands.length - 1;

  // Future を切り捨てた場合、drawsSinceCheckpoint を再計算
  const isTruncating = state.currentIndex < state.commands.length - 1;
  let drawsSinceCheckpoint: number;
  if (isTruncating) {
    // 切り捨て後に残った最後の checkpoint 以降の DrawCommand 数を再計算
    const remainingCheckpoints = state.checkpoints.filter(
      (cp) => cp.commandIndex <= state.currentIndex,
    );
    const lastCpIndex =
      remainingCheckpoints.length > 0
        ? Math.max(...remainingCheckpoints.map((cp) => cp.commandIndex))
        : -1;
    let count = 0;
    for (let i = lastCpIndex + 1; i <= state.currentIndex; i++) {
      if (isDrawCommand(newCommands[i])) count++;
    }
    drawsSinceCheckpoint = count;
  } else {
    drawsSinceCheckpoint = state.drawsSinceCheckpoint;
  }

  // 現在位置より後のチェックポイントを削除
  let newCheckpoints = state.checkpoints.filter(
    (cp) => cp.commandIndex <= state.currentIndex,
  );

  // チェックポイント作成の判定
  const isDrawCmd = isDrawCommand(command);

  if (isDrawCmd) {
    drawsSinceCheckpoint++;
  }

  if (layer !== null) {
    if (isStructuralCommand(command) && command.type === "remove-layer") {
      // remove-layer: 強制作成 & カウンタリセット
      const checkpoint = createCheckpoint(layer, newIndex);
      newCheckpoints = [...newCheckpoints, checkpoint];
      drawsSinceCheckpoint = 0;
    } else if (isDrawCmd) {
      // 描画コマンド: drawsSinceCheckpoint が interval に達したら checkpoint 作成
      if (drawsSinceCheckpoint >= config.checkpointInterval) {
        const checkpoint = createCheckpoint(layer, newIndex);
        newCheckpoints = [...newCheckpoints, checkpoint];
        drawsSinceCheckpoint = 0;
      }
    }

    // 最大チェックポイント数を超えた場合は古いものを削除
    if (newCheckpoints.length > config.maxCheckpoints) {
      newCheckpoints = newCheckpoints.slice(-config.maxCheckpoints);
    }
  }

  // 最大履歴数を超えた場合（DrawCommand の数でカウント）
  if (isDrawCmd) {
    const totalDrawCount = countDrawCommands(newCommands);
    if (totalDrawCount > config.maxHistorySize) {
      // 最も古い DrawCommand を見つけて削除し、それより前のカスタムコマンドは保持する
      let oldestDrawIndex = -1;
      for (let i = 0; i < newCommands.length; i++) {
        if (isDrawCommand(newCommands[i])) {
          oldestDrawIndex = i;
          break;
        }
      }
      // DrawCommand のみ除去し、その前のカスタム/構造コマンドは残す
      const trimmedCommands = [
        ...newCommands.slice(0, oldestDrawIndex),
        ...newCommands.slice(oldestDrawIndex + 1),
      ];
      const removeCount = 1; // 1つの DrawCommand だけ除去

      // チェックポイントのインデックスを調整
      // oldestDrawIndex の位置が削除されたので、それより後のインデックスを1つずらす
      newCheckpoints = newCheckpoints
        .filter((cp) => cp.commandIndex !== oldestDrawIndex)
        .map((cp) => ({
          ...cp,
          commandIndex:
            cp.commandIndex > oldestDrawIndex
              ? cp.commandIndex - 1
              : cp.commandIndex,
        }));

      // drawsSinceCheckpoint を再計算
      const lastCpIndex =
        newCheckpoints.length > 0
          ? Math.max(...newCheckpoints.map((cp) => cp.commandIndex))
          : -1;
      let recount = 0;
      for (let i = lastCpIndex + 1; i < trimmedCommands.length; i++) {
        if (isDrawCommand(trimmedCommands[i])) recount++;
      }

      return {
        ...state,
        commands: trimmedCommands,
        checkpoints: newCheckpoints,
        currentIndex: trimmedCommands.length - 1,
        drawsSinceCheckpoint: recount,
      };
    }
  }

  return {
    ...state,
    commands: newCommands,
    checkpoints: newCheckpoints,
    currentIndex: newIndex,
    drawsSinceCheckpoint,
  };
}

/**
 * Undo可能かどうか
 */
export function canUndo<TCustom = never>(
  state: HistoryState<TCustom>,
): boolean {
  return state.currentIndex >= 0;
}

/**
 * Redo可能かどうか
 */
export function canRedo<TCustom = never>(
  state: HistoryState<TCustom>,
): boolean {
  return state.currentIndex < state.commands.length - 1;
}

/**
 * Undo（1つ前の状態に戻る）
 */
export function undo<TCustom = never>(
  state: HistoryState<TCustom>,
): HistoryState<TCustom> {
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
export function redo<TCustom = never>(
  state: HistoryState<TCustom>,
): HistoryState<TCustom> {
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
export function findBestCheckpointForLayer<TCustom = never>(
  state: HistoryState<TCustom>,
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
export function getCommandsToReplayForLayer<TCustom = never>(
  state: HistoryState<TCustom>,
  layerId: string,
  fromCheckpoint?: Checkpoint,
): readonly DrawCommand[] {
  const startIndex = fromCheckpoint ? fromCheckpoint.commandIndex + 1 : 0;
  const commands: DrawCommand[] = [];
  for (let i = startIndex; i <= state.currentIndex; i++) {
    const cmd = state.commands[i];
    if (isDrawCommand(cmd) && cmd.type === "wrap-shift") {
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
export function getAffectedLayerIds<TCustom = never>(
  state: HistoryState<TCustom>,
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
export function computeCumulativeOffset<TCustom = never>(
  state: HistoryState<TCustom>,
): {
  readonly x: number;
  readonly y: number;
} {
  let x = 0;
  let y = 0;
  for (let i = 0; i <= state.currentIndex; i++) {
    const cmd = state.commands[i];
    if (isDrawCommand(cmd) && cmd.type === "wrap-shift") {
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
export function findBestCheckpoint<TCustom = never>(
  state: HistoryState<TCustom>,
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
export function getCommandsToReplay<TCustom = never>(
  state: HistoryState<TCustom>,
  fromCheckpoint?: Checkpoint,
): readonly Command<TCustom>[] {
  const startIndex = fromCheckpoint ? fromCheckpoint.commandIndex + 1 : 0;
  return state.commands.slice(startIndex, state.currentIndex + 1);
}
