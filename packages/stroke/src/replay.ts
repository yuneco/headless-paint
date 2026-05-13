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
  copyLayerPixels,
  createLayer,
  generateBrushTip,
  mergeLayerDown,
  transformLayer,
  wrapShiftLayer,
} from "@headless-paint/engine";
import { compileFilterPipeline, processAllPoints } from "@headless-paint/input";
import type { mat3 } from "gl-matrix";
import { restoreFromCheckpoint } from "./checkpoint";
import { findBestCheckpointForLayer, getCommandAt } from "./history";
import type {
  Command,
  HistoryState,
  RebuildLayerResult,
  StrokeCommand,
} from "./types";
import { isDrawCommand, isStructuralCommand } from "./types";

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
    command.alphaLocked,
  );
}

function cloneLayerForSampling(layer: Layer): Layer {
  const clone = createLayer(layer.width, layer.height);
  clone.ctx.drawImage(layer.canvas, 0, 0);
  return clone;
}

function setLayerId(layer: Layer, layerId: string): void {
  (layer as { id: string }).id = layerId;
}

function setLayerMeta(
  layer: Layer,
  meta: {
    readonly name: string;
    readonly visible: boolean;
    readonly opacity: number;
    readonly alphaLocked: boolean;
    readonly compositeOperation?: GlobalCompositeOperation;
  },
): void {
  layer.meta.name = meta.name;
  layer.meta.visible = meta.visible;
  layer.meta.opacity = meta.opacity;
  layer.meta.alphaLocked = meta.alphaLocked;
  layer.meta.compositeOperation = meta.compositeOperation;
}

function hasLayerCreationCommand<TCustom>(
  state: HistoryState<TCustom>,
  layerId: string,
): boolean {
  for (let i = state.historyStartIndex; i <= state.currentIndex; i++) {
    const command = getCommandAt(state, i);
    if (!command || !isStructuralCommand(command)) continue;
    if (command.type === "add-layer" && command.layerId === layerId) {
      return true;
    }
    if (command.type === "duplicate-layer" && command.layerId === layerId) {
      return true;
    }
  }
  return false;
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
): RebuildLayerResult {
  const checkpoint = findBestCheckpointForLayer(state, layer.id);

  if (checkpoint) {
    restoreFromCheckpoint(layer, checkpoint);
  } else if (
    state.currentIndex < state.historyStartIndex ||
    hasLayerCreationCommand(state, layer.id)
  ) {
    clearLayer(layer);
  } else {
    return {
      ok: false,
      reason: "missing-checkpoint",
      layerId: layer.id,
    };
  }

  const startIndex = checkpoint
    ? checkpoint.commandIndex + 1
    : state.historyStartIndex;
  for (let i = startIndex; i <= state.currentIndex; i++) {
    const command = getCommandAt(state, i);
    if (!command) continue;
    if (isDrawCommand(command)) {
      replayCommand(layer, command, registry);
      continue;
    }
    if (!isStructuralCommand(command)) continue;

    if (command.type === "duplicate-layer" && command.layerId === layer.id) {
      const sourceLayer = createLayer(command.width, command.height);
      setLayerId(sourceLayer, command.sourceLayerId);
      const result = rebuildLayerFromHistory(
        sourceLayer,
        { ...state, currentIndex: i - 1 },
        registry,
      );
      if (!result.ok) return result;
      copyLayerPixels(sourceLayer, layer);
      setLayerMeta(layer, command.meta);
      continue;
    }

    if (
      command.type === "merge-layer-down" &&
      command.targetLayerId === layer.id
    ) {
      setLayerMeta(layer, command.targetMetaBefore);
      const sourceLayer = createLayer(
        state.layerWidth,
        state.layerHeight,
        command.sourceMeta,
      );
      setLayerId(sourceLayer, command.sourceLayerId);
      const result = rebuildLayerFromHistory(
        sourceLayer,
        { ...state, currentIndex: i - 1 },
        registry,
      );
      if (!result.ok) return result;
      mergeLayerDown(layer, sourceLayer, {
        resultMeta: command.targetMetaAfter,
      });
    }
  }
  return { ok: true, source: checkpoint ? "checkpoint" : "empty" };
}

/**
 * @deprecated Use rebuildLayerFromHistory instead
 */
export function rebuildLayerState<TCustom = never>(
  layer: Layer,
  state: HistoryState<TCustom>,
): void {
  void rebuildLayerFromHistory(layer, state);
}
