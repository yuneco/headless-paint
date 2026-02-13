import type {
  BrushRenderState,
  Layer,
  StrokePoint,
} from "@headless-paint/engine";
import {
  clearLayer,
  compileExpand,
  expandStrokePoints,
  generateBrushTip,
  renderBrushStroke,
  wrapShiftLayer,
} from "@headless-paint/engine";
import { compileFilterPipeline, processAllPoints } from "@headless-paint/input";
import { restoreFromCheckpoint } from "./checkpoint";
import {
  findBestCheckpointForLayer,
  getCommandsToReplayForLayer,
} from "./history";
import type { Command, HistoryState, StrokeCommand } from "./types";
import { isDrawCommand } from "./types";

/**
 * ストロークコマンドをリプレイする
 * - inputPoints を filterPipeline で処理
 * - 結果を expand で展開
 * - 各ストロークをブラシ種別に応じて描画
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

  // スタンプブラシの場合は tipCanvas を再生成して初期 BrushRenderState を構築
  let brushState: BrushRenderState | undefined;
  if (command.style.brush.type === "stamp") {
    const tipCanvas = generateBrushTip(
      command.style.brush.tip,
      Math.ceil(command.style.lineWidth * 2),
      command.style.color,
    );
    brushState = {
      accumulatedDistance: 0,
      tipCanvas,
      seed: command.brushSeed,
    };
  }

  for (const points of strokes) {
    if (points.length > 0) {
      brushState = renderBrushStroke(
        layer,
        points,
        command.style,
        0,
        brushState,
      );
    }
  }
}

/**
 * 単一のコマンドをレイヤーに適用
 * 構造コマンドはピクセルを変更しないため無視する
 */
export function replayCommand(layer: Layer, command: Command): void {
  if (!isDrawCommand(command)) {
    return;
  }
  switch (command.type) {
    case "stroke":
      replayStrokeCommand(layer, command);
      break;
    case "clear":
      clearLayer(layer);
      break;
    case "wrap-shift":
      wrapShiftLayer(layer, command.dx, command.dy);
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
    replayCommand(layer, command);
  }
}

/**
 * 特定レイヤーを履歴状態に基づいて再構築する
 * - layer.id でフィルタし、そのレイヤーの描画コマンドのみリプレイ
 */
export function rebuildLayerFromHistory(
  layer: Layer,
  state: HistoryState,
): void {
  const checkpoint = findBestCheckpointForLayer(state, layer.id);

  if (checkpoint) {
    restoreFromCheckpoint(layer, checkpoint);
  } else {
    clearLayer(layer);
  }

  const commandsToReplay = getCommandsToReplayForLayer(
    state,
    layer.id,
    checkpoint,
  );
  replayCommands(layer, commandsToReplay);
}

/**
 * @deprecated Use rebuildLayerFromHistory instead
 */
export function rebuildLayerState(layer: Layer, state: HistoryState): void {
  rebuildLayerFromHistory(layer, state);
}
