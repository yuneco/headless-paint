import {
  canRedo,
  canUndo,
  executeHistoryOp,
  isBrushMixingActive,
  pushCommand,
} from "@headless-paint/core";
import type {
  BrushAccelerator,
  BrushTipRegistry,
  Command,
  CustomCommandExecutor,
  CustomCommandOutcome,
  ExecutorResult,
  HistoryConfig,
  HistoryState,
  LayerListOp,
  StrokeStyle,
} from "@headless-paint/core";
import { useCallback } from "react";
import type { UseLayersResult } from "../useLayers";
import type { CustomCommandContext, CustomCommandHandler } from "./types";

export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  checkpointInterval: 10,
  maxCheckpoints: 10,
  checkpointCompression: "fast",
};

export function getCommandType(command: unknown): string {
  const typed = command as { readonly type?: unknown } | undefined;
  return typeof typed?.type === "string" ? typed.type : "custom";
}

export function shouldApplyActiveLayerHint<TCustom>(
  op: "undo" | "redo",
  result: ExecutorResult<TCustom>,
  currentActiveLayerId: string | null,
): boolean {
  if (!result.activeLayerIdHint) return false;

  const commandType = getCommandType(result.command);
  const isNearbyRemoveHint =
    (op === "undo" && commandType === "add-layer") ||
    (op === "redo" && commandType === "remove-layer");
  if (!isNearbyRemoveHint) return true;

  return result.layerListOps.some(
    (listOp) =>
      listOp.type === "remove" && listOp.layerId === currentActiveLayerId,
  );
}

export function warnHistoryExecutorFailure<TCustom>(
  op: "undo" | "redo",
  result: ExecutorResult<TCustom>,
): void {
  const failure = result.failure;
  const commandType = failure?.commandType ?? getCommandType(result.command);
  const layerPart = failure?.layerId ? ` layerId=${failure.layerId}` : "";
  console.warn(
    `[headless-paint] ${op} skipped ${commandType}: ${failure?.reason ?? "unknown"}${layerPart}`,
  );
}

interface CustomExecutorOptions<TCustom> {
  readonly handler: CustomCommandHandler<TCustom> | undefined;
  readonly getContext: () => CustomCommandContext;
}

export function createCustomExecutor<TCustom>({
  handler,
  getContext,
}: CustomExecutorOptions<TCustom>): CustomCommandExecutor<TCustom> | undefined {
  if (!handler) return undefined;
  const createOutcome = (run: () => void): CustomCommandOutcome => {
    run();
    return { ok: true };
  };
  return {
    apply: (cmd) => createOutcome(() => handler.apply(cmd, getContext())),
    unapply: (cmd) => createOutcome(() => handler.undo(cmd, getContext())),
  };
}

interface ExecuteHistoryOpOptions<TCustom> {
  readonly activeLayerId: string | null;
  readonly entriesRef: UseLayersResult["entriesRef"];
  readonly historyStateRef: React.RefObject<HistoryState<TCustom>>;
  readonly registryRef: React.RefObject<BrushTipRegistry | undefined>;
  readonly customCommandHandlerRef: React.RefObject<
    CustomCommandHandler<TCustom> | undefined
  >;
  readonly shiftTempCanvas: OffscreenCanvas;
  readonly accelerator: BrushAccelerator | null;
  readonly brush: StrokeStyle["brush"];
  readonly applyLayerListOps: (ops: readonly LayerListOp[]) => void;
  readonly setActiveLayerId: UseLayersResult["setActiveLayerId"];
  readonly setLayerVisible: UseLayersResult["setLayerVisible"];
  readonly findEntry: UseLayersResult["findEntry"];
  readonly bumpRenderVersion: UseLayersResult["bumpRenderVersion"];
  readonly commitHistoryState: (state: HistoryState<TCustom>) => void;
  readonly cancelDrawing: () => void;
}

function createCustomCommandContext<TCustom>(
  options: ExecuteHistoryOpOptions<TCustom>,
): CustomCommandContext {
  return {
    entries: options.entriesRef.current,
    findEntry: options.findEntry,
    bumpRenderVersion: options.bumpRenderVersion,
  };
}

export function executeAndApplyHistoryOp<TCustom>(
  op: "undo" | "redo",
  options: ExecuteHistoryOpOptions<TCustom>,
): void {
  // Toolbar / gesture history actions can race the final pointer event.
  // End the live GPU owner before history rebuild starts.
  options.cancelDrawing();
  const previous = options.historyStateRef.current;
  if (op === "undo" ? !canUndo(previous) : !canRedo(previous)) return;

  const result = executeHistoryOp(op, previous, {
    layers: options.entriesRef.current.map((entry) => entry.committedLayer),
    tipRegistry: options.registryRef.current,
    customExecutor: createCustomExecutor({
      handler: options.customCommandHandlerRef.current,
      getContext: () => createCustomCommandContext(options),
    }),
    shiftTempCanvas: options.shiftTempCanvas,
    accelerator: options.accelerator,
  });
  if (!result.ok) {
    warnHistoryExecutorFailure(op, result);
    return;
  }

  options.applyLayerListOps(result.layerListOps);
  const applyActiveLayerHint = shouldApplyActiveLayerHint(
    op,
    result,
    options.activeLayerId,
  );
  if (applyActiveLayerHint) {
    options.setActiveLayerId(result.activeLayerIdHint ?? null);
  }
  for (const layerId of result.visibilityFixLayerIds) {
    options.setLayerVisible(layerId, true);
  }
  options.commitHistoryState(result.next);
  options.bumpRenderVersion();

  // History rebuild usually ends in a CPU checkpoint restore. Preserve the
  // idle-frame upload so the next mixing stroke can reuse GPU residency.
  const brush = options.brush;
  if (
    !options.accelerator ||
    brush.type !== "stamp" ||
    !isBrushMixingActive(brush.mixing)
  ) {
    return;
  }

  const targetLayerId = applyActiveLayerHint
    ? (result.activeLayerIdHint ?? options.activeLayerId)
    : options.activeLayerId;
  const schedule =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (callback: () => void) => setTimeout(callback, 0);
  schedule(() => {
    const entry = options.entriesRef.current.find(
      (candidate) => candidate.id === targetLayerId,
    );
    if (entry) options.accelerator?.warmUp(entry.committedLayer);
  });
}

export function useHistoryActions<TCustom>(
  options: ExecuteHistoryOpOptions<TCustom>,
): { readonly undo: () => void; readonly redo: () => void } {
  const {
    accelerator,
    activeLayerId,
    applyLayerListOps,
    brush,
    bumpRenderVersion,
    cancelDrawing,
    commitHistoryState,
    customCommandHandlerRef,
    entriesRef,
    findEntry,
    historyStateRef,
    registryRef,
    setActiveLayerId,
    setLayerVisible,
    shiftTempCanvas,
  } = options;
  const execute = useCallback(
    (op: "undo" | "redo") =>
      executeAndApplyHistoryOp(op, {
        accelerator,
        activeLayerId,
        applyLayerListOps,
        brush,
        bumpRenderVersion,
        cancelDrawing,
        commitHistoryState,
        customCommandHandlerRef,
        entriesRef,
        findEntry,
        historyStateRef,
        registryRef,
        setActiveLayerId,
        setLayerVisible,
        shiftTempCanvas,
      }),
    [
      accelerator,
      activeLayerId,
      applyLayerListOps,
      brush,
      bumpRenderVersion,
      cancelDrawing,
      commitHistoryState,
      customCommandHandlerRef,
      entriesRef,
      findEntry,
      historyStateRef,
      registryRef,
      setActiveLayerId,
      setLayerVisible,
      shiftTempCanvas,
    ],
  );
  const undo = useCallback(() => execute("undo"), [execute]);
  const redo = useCallback(() => execute("redo"), [execute]);
  return { undo, redo };
}

interface PushCustomCommandOptions<TCustom> {
  readonly handlerRef: React.RefObject<
    CustomCommandHandler<TCustom> | undefined
  >;
  readonly historyStateRef: React.RefObject<HistoryState<TCustom>>;
  readonly historyConfigRef: React.RefObject<HistoryConfig>;
  readonly entriesRef: UseLayersResult["entriesRef"];
  readonly findEntry: UseLayersResult["findEntry"];
  readonly bumpRenderVersion: UseLayersResult["bumpRenderVersion"];
  readonly commitHistoryState: (state: HistoryState<TCustom>) => void;
}

export function usePushCustomCommand<TCustom>(
  options: PushCustomCommandOptions<TCustom>,
): (command: TCustom) => void {
  return useCallback(
    (command: TCustom) => {
      const handler = options.handlerRef.current;
      if (!handler) return;
      const next = pushCommand(
        options.historyStateRef.current,
        command as Command<TCustom>,
        { layerCount: options.entriesRef.current.length },
        options.historyConfigRef.current,
      );
      options.commitHistoryState(next);
      handler.apply(command, {
        entries: options.entriesRef.current,
        findEntry: options.findEntry,
        bumpRenderVersion: options.bumpRenderVersion,
      });
    },
    [
      options.bumpRenderVersion,
      options.commitHistoryState,
      options.entriesRef,
      options.findEntry,
      options.handlerRef,
      options.historyConfigRef,
      options.historyStateRef,
    ],
  );
}
