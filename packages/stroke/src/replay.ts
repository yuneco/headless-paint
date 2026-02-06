import type { Layer, StrokePoint } from "@headless-paint/engine";
import {
  clearLayer,
  compileExpand,
  drawVariableWidthPath,
  expandStrokePoints,
} from "@headless-paint/engine";
import {
  compileFilterPipeline,
  processAllPoints,
} from "@headless-paint/input";
import { restoreFromCheckpoint } from "./checkpoint";
import { findBestCheckpoint, getCommandsToReplay } from "./history";
import type { Command, HistoryState, StrokeCommand } from "./types";

/**
 * ストロークコマンドをリプレイする
 * - inputPoints を filterPipeline で処理
 * - 結果を expand で展開
 * - 各ストロークを可変太さで描画
 */
function replayStrokeCommand(layer: Layer, command: StrokeCommand): void {
  // フィルタパイプラインで入力点を処理
  const compiledFilter = compileFilterPipeline(command.filterPipeline);
  const filteredPoints = processAllPoints(command.inputPoints, compiledFilter);

  // 展開設定をコンパイル
  const compiledExpand = compileExpand(command.expand);

  // StrokePoint に変換（pressure 保持）
  const strokePoints: StrokePoint[] = filteredPoints.map((p) => ({
    x: p.x,
    y: p.y,
    pressure: p.pressure,
  }));
  const strokes = expandStrokePoints(strokePoints, compiledExpand);

  const pressureSensitivity = command.pressureSensitivity ?? 0;
  for (const points of strokes) {
    if (points.length > 0) {
      drawVariableWidthPath(layer, points, command.color, command.lineWidth, pressureSensitivity);
    }
  }
}

/**
 * 単一のコマンドをレイヤーに適用
 */
export function replayCommand(layer: Layer, command: Command): void {
  switch (command.type) {
    case "stroke":
      replayStrokeCommand(layer, command);
      break;
    case "clear":
      clearLayer(layer);
      break;
  }
}

/**
 * コマンドのリストを順番にリプレイ
 */
export function replayCommands(layer: Layer, commands: readonly Command[]): void {
  for (const command of commands) {
    replayCommand(layer, command);
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
