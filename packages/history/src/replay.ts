import type { Layer } from "@headless-paint/engine";
import { clearLayer, drawCircle, drawLine, drawPath } from "@headless-paint/engine";
import { restoreFromCheckpoint } from "./checkpoint";
import { findBestCheckpoint, getCommandsToReplay } from "./history";
import type { Command, HistoryState } from "./types";

/**
 * 単一のコマンドをレイヤーに適用
 */
export function applyCommand(layer: Layer, command: Command): void {
  switch (command.type) {
    case "drawPath":
      drawPath(layer, command.points, command.color, command.lineWidth);
      break;
    case "drawLine":
      drawLine(layer, command.start, command.end, command.color, command.lineWidth);
      break;
    case "drawCircle":
      drawCircle(layer, command.center, command.radius, command.color);
      break;
    case "clear":
      clearLayer(layer);
      break;
    case "batch":
      // バッチ内の全コマンドを順番に適用
      for (const subCommand of command.commands) {
        applyCommand(layer, subCommand);
      }
      break;
  }
}

/**
 * コマンドのリストを順番にリプレイ
 */
export function replayCommands(
  layer: Layer,
  commands: readonly Command[],
): void {
  for (const command of commands) {
    applyCommand(layer, command);
  }
}

/**
 * 履歴状態に基づいてレイヤーを再構築
 * - 最適なチェックポイントから復元し、その後のコマンドをリプレイ
 */
export function rebuildLayerState(layer: Layer, state: HistoryState): void {
  const checkpoint = findBestCheckpoint(state);

  if (checkpoint) {
    restoreFromCheckpoint(layer, checkpoint);
  } else {
    clearLayer(layer);
  }

  const commandsToReplay = getCommandsToReplay(state, checkpoint);
  replayCommands(layer, commandsToReplay);
}
