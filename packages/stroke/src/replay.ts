import type {
  BrushRenderState,
  BrushTipRegistry,
  Layer,
  StrokePoint,
} from "@headless-paint/engine";
import {
  appendToCommittedLayer,
  clearLayer,
  compileExpand,
  createLayer,
  generateBrushTip,
  transformLayer,
  wrapShiftLayer,
} from "@headless-paint/engine";
import { compileFilterPipeline, processAllPoints } from "@headless-paint/input";
import type { mat3 } from "gl-matrix";
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
function replayStrokeCommand(
  layer: Layer,
  command: StrokeCommand,
  registry?: BrushTipRegistry,
): void {
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
  // スタンプブラシの場合は tipCanvas を再生成して初期 BrushRenderState を構築
  let brushState: BrushRenderState | undefined;
  if (command.style.brush.type === "stamp") {
    const tipCanvas = generateBrushTip(
      command.style.brush.tip,
      Math.ceil(command.style.lineWidth * 2),
      command.style.color,
      registry,
    );
    brushState = {
      accumulatedDistance: 0,
      tipCanvas,
      seed: command.brushSeed,
      stampCount: 0,
    };
  }
  const sourceLayer =
    command.style.brush.type === "stamp" && command.style.brush.mixing?.enabled
      ? cloneLayerForSampling(layer)
      : undefined;

  appendToCommittedLayer(
    layer,
    strokePoints,
    command.style,
    compiledExpand,
    0,
    brushState,
    sourceLayer,
  );
}

function cloneLayerForSampling(layer: Layer): Layer {
  const clone = createLayer(layer.width, layer.height);
  clone.ctx.drawImage(layer.canvas, 0, 0);
  return clone;
}

/**
 * 単一のコマンドをレイヤーに適用
 * 構造コマンドはピクセルを変更しないため無視する
 */
export function replayCommand<TCustom = never>(
  layer: Layer,
  command: Command<TCustom>,
  registry?: BrushTipRegistry,
): void {
  if (!isDrawCommand(command)) {
    return;
  }
  switch (command.type) {
    case "stroke":
      replayStrokeCommand(layer, command, registry);
      break;
    case "clear":
      clearLayer(layer);
      break;
    case "wrap-shift":
      wrapShiftLayer(layer, command.dx, command.dy);
      break;
    case "transform-layer":
      transformLayer(layer, new Float32Array(command.matrix) as mat3);
      break;
  }
}

/**
 * コマンドのリストを順番にリプレイ
 */
export function replayCommands<TCustom = never>(
  layer: Layer,
  commands: readonly Command<TCustom>[],
  registry?: BrushTipRegistry,
): void {
  for (const command of commands) {
    replayCommand(layer, command, registry);
  }
}

/**
 * 特定レイヤーを履歴状態に基づいて再構築する
 * - layer.id でフィルタし、そのレイヤーの描画コマンドのみリプレイ
 */
export function rebuildLayerFromHistory<TCustom = never>(
  layer: Layer,
  state: HistoryState<TCustom>,
  registry?: BrushTipRegistry,
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
  replayCommands(layer, commandsToReplay, registry);
}

/**
 * @deprecated Use rebuildLayerFromHistory instead
 */
export function rebuildLayerState<TCustom = never>(
  layer: Layer,
  state: HistoryState<TCustom>,
): void {
  rebuildLayerFromHistory(layer, state);
}
