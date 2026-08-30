import type {
  BrushAccelerator,
  BrushTipRegistry,
  Layer,
  LayerMeta,
} from "@headless-paint/engine";
import { createLayer, wrapShiftLayer } from "@headless-paint/engine";
import { invalidateGpuLayerResidency } from "./gpu-layer-residency";
import {
  canRedo,
  canUndo,
  getAffectedLayerIds,
  getCommandAt,
  redo,
  undo,
} from "./history";
import {
  applyDuplicateLayerCommand,
  applyMergeLayerDownCommand,
} from "./layer-operations";
import { rebuildLayerFromHistory } from "./replay";
import type { Command, HistoryState } from "./types";
import { isDrawCommand, isStructuralCommand } from "./types";

export interface ExecutorDeps<TCustom = never> {
  readonly layers: readonly Layer[];
  readonly tipRegistry?: BrushTipRegistry;
  readonly customExecutor?: CustomCommandExecutor<TCustom>;
  readonly shiftTempCanvas?: OffscreenCanvas;
  readonly accelerator?: BrushAccelerator | null;
}

export interface ExecutorFailure {
  readonly reason:
    | "missing-checkpoint"
    | "apply-failed"
    | "guard"
    | "not-implemented";
  readonly commandType: string;
  readonly layerId?: string;
}

export type LayerListOp =
  | { readonly type: "insert"; readonly index: number; readonly layer: Layer }
  | { readonly type: "remove"; readonly layerId: string }
  | {
      readonly type: "move";
      readonly fromIndex: number;
      readonly toIndex: number;
    }
  | {
      readonly type: "replace";
      readonly layers: readonly Layer[];
      readonly activeLayerId: string;
    };

export type DirtyHint =
  | { readonly type: "none" }
  | { readonly type: "layers"; readonly layerIds: readonly string[] }
  | { readonly type: "all" };

export type PersistenceEvent =
  | { readonly type: "none" }
  | { readonly type: "append-command"; readonly command: unknown }
  | { readonly type: "delete-last-command" }
  | { readonly type: "structural-checkpoint" };

export interface CustomCommandOutcome {
  readonly ok: boolean;
  readonly failure?: ExecutorFailure;
  readonly layerListOps?: readonly LayerListOp[];
  readonly activeLayerIdHint?: string;
  readonly visibilityFixLayerIds?: readonly string[];
  readonly dirty?: DirtyHint;
}

export interface CustomCommandExecutor<TCustom> {
  apply(command: TCustom): CustomCommandOutcome;
  unapply(command: TCustom): CustomCommandOutcome;
}

export interface ExecutorResult<TCustom = never> {
  readonly ok: boolean;
  readonly failure?: ExecutorFailure;
  readonly next: HistoryState<TCustom>;
  readonly command?: Command<TCustom>;
  readonly layerListOps: readonly LayerListOp[];
  readonly activeLayerIdHint?: string;
  readonly visibilityFixLayerIds: readonly string[];
  readonly dirty: DirtyHint;
  readonly persistence: PersistenceEvent;
}

const EMPTY_LAYER_LIST_OPS: readonly LayerListOp[] = [];
const EMPTY_LAYER_IDS: readonly string[] = [];
const DIRTY_NONE: DirtyHint = { type: "none" };

function setLayerId(layer: Layer, layerId: string): void {
  (layer as { id: string }).id = layerId;
}

function createRestoredLayer(
  width: number,
  height: number,
  layerId: string,
  meta: LayerMeta,
): Layer {
  const layer = createLayer(width, height, meta);
  setLayerId(layer, layerId);
  return layer;
}

function restoreLayerMeta(
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

function getActiveHintAfterRemove(
  layers: readonly Layer[],
  layerId: string,
): string | undefined {
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return undefined;

  const remaining = layers.filter((layer) => layer.id !== layerId);
  if (remaining.length === 0) return undefined;

  return remaining[Math.min(index, remaining.length - 1)]?.id;
}

function getCommandType<TCustom>(
  command: Command<TCustom> | undefined,
): string {
  const typed = command as { readonly type?: unknown } | undefined;
  return typeof typed?.type === "string" ? typed.type : "custom";
}

function createFailureResult<TCustom>(
  state: HistoryState<TCustom>,
  command: Command<TCustom>,
  failure: ExecutorFailure,
  persistence: PersistenceEvent,
): ExecutorResult<TCustom> {
  return {
    ok: false,
    failure,
    next: state,
    command,
    layerListOps: EMPTY_LAYER_LIST_OPS,
    visibilityFixLayerIds: EMPTY_LAYER_IDS,
    dirty: DIRTY_NONE,
    persistence,
  };
}

function resolveHistoryPersistenceEvent<TCustom>(
  op: "undo" | "redo",
  command: Command<TCustom>,
): PersistenceEvent {
  if (isStructuralCommand(command)) return { type: "structural-checkpoint" };
  if (op === "undo") return { type: "delete-last-command" };
  return { type: "append-command", command };
}

export function resolvePushPersistenceEvent<TCustom>(
  command: Command<TCustom>,
): PersistenceEvent {
  if (isStructuralCommand(command)) return { type: "structural-checkpoint" };
  return { type: "append-command", command };
}

function executeWrapShift<TCustom>(
  op: "undo" | "redo",
  state: HistoryState<TCustom>,
  next: HistoryState<TCustom>,
  command: Command<TCustom>,
  deps: ExecutorDeps<TCustom>,
  persistence: PersistenceEvent,
): ExecutorResult<TCustom> {
  if (!isDrawCommand(command) || command.type !== "wrap-shift") {
    return createFailureResult(
      state,
      command,
      {
        reason: "apply-failed",
        commandType: getCommandType(command),
      },
      persistence,
    );
  }

  const sign = op === "undo" ? -1 : 1;
  for (const layer of deps.layers) {
    wrapShiftLayer(
      layer,
      command.dx * sign,
      command.dy * sign,
      deps.shiftTempCanvas,
    );
  }

  return {
    ok: true,
    next,
    command,
    layerListOps: EMPTY_LAYER_LIST_OPS,
    visibilityFixLayerIds: EMPTY_LAYER_IDS,
    dirty: { type: "all" },
    persistence,
  };
}

function executeLayerDraw<TCustom>(
  op: "undo" | "redo",
  state: HistoryState<TCustom>,
  next: HistoryState<TCustom>,
  command: Command<TCustom>,
  deps: ExecutorDeps<TCustom>,
  persistence: PersistenceEvent,
): ExecutorResult<TCustom> {
  const affected =
    op === "undo"
      ? getAffectedLayerIds(state, next.currentIndex, state.currentIndex)
      : getAffectedLayerIds(next, state.currentIndex, next.currentIndex);
  const layerIds =
    affected.type === "all"
      ? deps.layers.map((layer) => layer.id)
      : [...affected.layerIds];
  const visibilityFixLayerIds: string[] = [];

  for (const layerId of layerIds) {
    const layer = deps.layers.find((candidate) => candidate.id === layerId);
    if (!layer) continue;

    const result = rebuildLayerFromHistory(layer, next, deps.tipRegistry, {
      accelerator: deps.accelerator,
      invalidationReason: op === "undo" ? "executorUndo" : "executorRedo",
    });
    if (!result.ok) {
      return createFailureResult(
        state,
        command,
        {
          reason: result.reason,
          commandType: getCommandType(command),
          layerId: result.layerId,
        },
        persistence,
      );
    }
    if (!layer.meta.visible) visibilityFixLayerIds.push(layer.id);
  }

  return {
    ok: true,
    next,
    command,
    layerListOps: EMPTY_LAYER_LIST_OPS,
    visibilityFixLayerIds,
    dirty:
      affected.type === "all" ? { type: "all" } : { type: "layers", layerIds },
    persistence,
  };
}

function executeCustom<TCustom>(
  op: "undo" | "redo",
  state: HistoryState<TCustom>,
  next: HistoryState<TCustom>,
  command: Command<TCustom>,
  deps: ExecutorDeps<TCustom>,
  persistence: PersistenceEvent,
): ExecutorResult<TCustom> {
  if (!deps.customExecutor) {
    return createFailureResult(
      state,
      command,
      {
        reason: "apply-failed",
        commandType: getCommandType(command),
      },
      persistence,
    );
  }

  const outcome =
    op === "undo"
      ? deps.customExecutor.unapply(command as TCustom)
      : deps.customExecutor.apply(command as TCustom);

  if (!outcome.ok) {
    return createFailureResult(
      state,
      command,
      outcome.failure ?? {
        reason: "apply-failed",
        commandType: getCommandType(command),
      },
      persistence,
    );
  }

  const dirty = outcome.dirty ?? DIRTY_NONE;
  if (dirty.type === "all") {
    for (const layer of deps.layers) {
      invalidateGpuLayerResidency(
        layer,
        deps.accelerator,
        op === "undo" ? "executorUndo" : "executorRedo",
      );
    }
  } else if (dirty.type === "layers") {
    for (const layerId of dirty.layerIds) {
      const layer = deps.layers.find((candidate) => candidate.id === layerId);
      if (layer) {
        invalidateGpuLayerResidency(
          layer,
          deps.accelerator,
          op === "undo" ? "executorUndo" : "executorRedo",
        );
      }
    }
  }

  return {
    ok: true,
    next,
    command,
    layerListOps: outcome.layerListOps ?? EMPTY_LAYER_LIST_OPS,
    activeLayerIdHint: outcome.activeLayerIdHint,
    visibilityFixLayerIds: outcome.visibilityFixLayerIds ?? EMPTY_LAYER_IDS,
    dirty,
    persistence,
  };
}

function executeStructural<TCustom>(
  op: "undo" | "redo",
  state: HistoryState<TCustom>,
  next: HistoryState<TCustom>,
  command: Command<TCustom>,
  deps: ExecutorDeps<TCustom>,
  persistence: PersistenceEvent,
): ExecutorResult<TCustom> {
  if (!isStructuralCommand(command)) {
    return createFailureResult(
      state,
      command,
      {
        reason: "apply-failed",
        commandType: getCommandType(command),
      },
      persistence,
    );
  }

  switch (command.type) {
    case "add-layer": {
      if (op === "undo") {
        return {
          ok: true,
          next,
          command,
          layerListOps: [{ type: "remove", layerId: command.layerId }],
          activeLayerIdHint: getActiveHintAfterRemove(
            deps.layers,
            command.layerId,
          ),
          visibilityFixLayerIds: EMPTY_LAYER_IDS,
          dirty: DIRTY_NONE,
          persistence,
        };
      }

      const layer = createRestoredLayer(
        command.width,
        command.height,
        command.layerId,
        command.meta,
      );
      return {
        ok: true,
        next,
        command,
        layerListOps: [{ type: "insert", index: command.insertIndex, layer }],
        activeLayerIdHint: command.layerId,
        visibilityFixLayerIds: EMPTY_LAYER_IDS,
        dirty: DIRTY_NONE,
        persistence,
      };
    }

    case "remove-layer": {
      if (op === "redo") {
        return {
          ok: true,
          next,
          command,
          layerListOps: [{ type: "remove", layerId: command.layerId }],
          activeLayerIdHint: getActiveHintAfterRemove(
            deps.layers,
            command.layerId,
          ),
          visibilityFixLayerIds: EMPTY_LAYER_IDS,
          dirty: DIRTY_NONE,
          persistence,
        };
      }

      const layer = createRestoredLayer(
        state.layerWidth,
        state.layerHeight,
        command.layerId,
        command.meta,
      );
      const result = rebuildLayerFromHistory(layer, next, deps.tipRegistry, {
        accelerator: deps.accelerator,
        invalidationReason: op === "undo" ? "executorUndo" : "executorRedo",
      });
      if (!result.ok) {
        return createFailureResult(
          state,
          command,
          {
            reason: result.reason,
            commandType: command.type,
            layerId: result.layerId,
          },
          persistence,
        );
      }

      return {
        ok: true,
        next,
        command,
        layerListOps: [{ type: "insert", index: command.removedIndex, layer }],
        activeLayerIdHint: command.layerId,
        visibilityFixLayerIds: EMPTY_LAYER_IDS,
        dirty: { type: "layers", layerIds: [command.layerId] },
        persistence,
      };
    }

    case "reorder-layer": {
      const fromIndex = op === "undo" ? command.toIndex : command.fromIndex;
      const toIndex = op === "undo" ? command.fromIndex : command.toIndex;
      return {
        ok: true,
        next,
        command,
        layerListOps: [{ type: "move", fromIndex, toIndex }],
        visibilityFixLayerIds: EMPTY_LAYER_IDS,
        dirty: DIRTY_NONE,
        persistence,
      };
    }

    case "duplicate-layer": {
      if (op === "undo") {
        return {
          ok: true,
          next,
          command,
          layerListOps: [{ type: "remove", layerId: command.layerId }],
          activeLayerIdHint: command.sourceLayerId,
          visibilityFixLayerIds: EMPTY_LAYER_IDS,
          dirty: DIRTY_NONE,
          persistence,
        };
      }

      const result = applyDuplicateLayerCommand(deps.layers, command);
      if (!result) {
        return createFailureResult(
          state,
          command,
          {
            reason: "apply-failed",
            commandType: command.type,
            layerId: command.layerId,
          },
          persistence,
        );
      }

      return {
        ok: true,
        next,
        command,
        layerListOps: [
          {
            type: "replace",
            layers: result.layers,
            activeLayerId: command.layerId,
          },
        ],
        activeLayerIdHint: command.layerId,
        visibilityFixLayerIds: EMPTY_LAYER_IDS,
        dirty: { type: "layers", layerIds: [command.layerId] },
        persistence,
      };
    }

    case "merge-layer-down": {
      if (op === "redo") {
        const result = applyMergeLayerDownCommand(deps.layers, command);
        if (!result) {
          return createFailureResult(
            state,
            command,
            {
              reason: "apply-failed",
              commandType: command.type,
              layerId: command.sourceLayerId,
            },
            persistence,
          );
        }

        return {
          ok: true,
          next,
          command,
          layerListOps: [
            {
              type: "replace",
              layers: result.layers,
              activeLayerId: command.targetLayerId,
            },
          ],
          activeLayerIdHint: command.targetLayerId,
          visibilityFixLayerIds: EMPTY_LAYER_IDS,
          dirty: { type: "layers", layerIds: [command.targetLayerId] },
          persistence,
        };
      }

      const sourceLayer = createRestoredLayer(
        state.layerWidth,
        state.layerHeight,
        command.sourceLayerId,
        command.sourceMeta,
      );
      const sourceResult = rebuildLayerFromHistory(
        sourceLayer,
        next,
        deps.tipRegistry,
        {
          accelerator: deps.accelerator,
          invalidationReason: "executorUndo",
        },
      );
      if (!sourceResult.ok) {
        return createFailureResult(
          state,
          command,
          {
            reason: sourceResult.reason,
            commandType: command.type,
            layerId: sourceResult.layerId,
          },
          persistence,
        );
      }

      const targetLayer = deps.layers.find(
        (layer) => layer.id === command.targetLayerId,
      );
      if (!targetLayer) {
        return createFailureResult(
          state,
          command,
          {
            reason: "apply-failed",
            commandType: command.type,
            layerId: command.targetLayerId,
          },
          persistence,
        );
      }

      restoreLayerMeta(targetLayer, command.targetMetaBefore);
      const targetResult = rebuildLayerFromHistory(
        targetLayer,
        next,
        deps.tipRegistry,
        {
          accelerator: deps.accelerator,
          invalidationReason: "executorUndo",
        },
      );
      if (!targetResult.ok) {
        return createFailureResult(
          state,
          command,
          {
            reason: targetResult.reason,
            commandType: command.type,
            layerId: targetResult.layerId,
          },
          persistence,
        );
      }
      return {
        ok: true,
        next,
        command,
        layerListOps: [
          {
            type: "insert",
            index: command.sourceIndex,
            layer: sourceLayer,
          },
        ],
        activeLayerIdHint: command.sourceLayerId,
        visibilityFixLayerIds: EMPTY_LAYER_IDS,
        dirty: {
          type: "layers",
          layerIds: [command.sourceLayerId, command.targetLayerId],
        },
        persistence,
      };
    }
  }
}

export function executeHistoryOp<TCustom>(
  op: "undo" | "redo",
  state: HistoryState<TCustom>,
  deps: ExecutorDeps<TCustom>,
): ExecutorResult<TCustom> {
  const canExecute = op === "undo" ? canUndo(state) : canRedo(state);
  const targetIndex =
    op === "undo" ? state.currentIndex : state.currentIndex + 1;
  const command = getCommandAt(state, targetIndex);

  if (!canExecute || !command) {
    return {
      ok: false,
      failure: {
        reason: "guard",
        commandType: getCommandType(command),
      },
      next: state,
      command,
      layerListOps: EMPTY_LAYER_LIST_OPS,
      visibilityFixLayerIds: EMPTY_LAYER_IDS,
      dirty: DIRTY_NONE,
      persistence: { type: "none" },
    };
  }

  const next = op === "undo" ? undo(state) : redo(state);
  const persistence = resolveHistoryPersistenceEvent(op, command);

  if (isDrawCommand(command)) {
    if (command.type === "wrap-shift") {
      return executeWrapShift(op, state, next, command, deps, persistence);
    }
    return executeLayerDraw(op, state, next, command, deps, persistence);
  }

  if (isStructuralCommand(command)) {
    return executeStructural(op, state, next, command, deps, persistence);
  }

  return executeCustom(op, state, next, command, deps, persistence);
}
