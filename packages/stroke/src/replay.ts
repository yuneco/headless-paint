import type {
  BrushAccelerator,
  BrushTipRegistry,
  Layer,
} from "@headless-paint/engine";
import {
  clearLayer,
  copyLayerPixels,
  createLayer,
  mergeLayerDown,
  transformLayer,
  wrapShiftLayer,
} from "@headless-paint/engine";
import type { mat3 } from "gl-matrix";
import { restoreFromCheckpoint } from "./checkpoint";
import { invalidateGpuLayerResidency } from "./gpu-layer-residency";
import { findBestCheckpointForLayer, getCommandAt } from "./history";
import { createIncrementalStrokeRenderer } from "./incremental-stroke";
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
  accelerator?: BrushAccelerator | null,
): void {
  const renderer = createIncrementalStrokeRenderer({
    layer,
    style: command.style,
    filterPipeline: command.filterPipeline,
    expand: command.expand,
    brushSeed: command.brushSeed,
    alphaLocked: command.alphaLocked,
    registry,
    accelerator,
  });
  renderer.feedMany(command.inputPoints);
  renderer.finalize();
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
  options: ReplayOptions = {},
): void {
  if (!isDrawCommand(command)) {
    return;
  }
  switch (command.type) {
    case "stroke":
      replayStrokeCommand(layer, command, registry, options.accelerator);
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
  options: ReplayOptions = {},
): void {
  for (const command of commands) {
    replayCommand(layer, command, registry, options);
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
  options: ReplayOptions = {},
): RebuildLayerResult {
  const checkpoint = findBestCheckpointForLayer(state, layer.id);

  if (checkpoint) {
    restoreFromCheckpoint(layer, checkpoint, options.accelerator);
  } else if (
    state.currentIndex < state.historyStartIndex ||
    hasLayerCreationCommand(state, layer.id)
  ) {
    clearLayer(layer);
  } else {
    invalidateGpuLayerResidency(layer, options.accelerator);
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
      replayCommand(layer, command, registry, options);
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
        options,
      );
      if (!result.ok) {
        invalidateGpuLayerResidency(layer, options.accelerator);
        return result;
      }
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
        options,
      );
      if (!result.ok) {
        invalidateGpuLayerResidency(layer, options.accelerator);
        return result;
      }
      mergeLayerDown(layer, sourceLayer, {
        resultMeta: command.targetMetaAfter,
      });
    }
  }
  return { ok: true, source: checkpoint ? "checkpoint" : "empty" };
}

export interface ReplayOptions {
  readonly accelerator?: BrushAccelerator | null;
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
