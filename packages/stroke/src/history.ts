import type { Layer } from "@headless-paint/engine";
import { compressCheckpoint, createCheckpoint } from "./checkpoint";
import type {
  AffectedLayers,
  Checkpoint,
  Command,
  HistoryConfig,
  HistoryMetrics,
  HistoryState,
  PixelScope,
  PushCommandOptions,
} from "./types";
import {
  DEFAULT_HISTORY_CONFIG,
  isCustomCommand,
  isDrawCommand,
  isLayerDrawCommand,
  isStructuralCommand,
} from "./types";

export function createHistoryState<TCustom = never>(
  width: number,
  height: number,
  options?: { readonly layerCount?: number },
): HistoryState<TCustom> {
  return {
    commands: [],
    checkpoints: [],
    historyStartIndex: 0,
    currentIndex: -1,
    undoFloorIndex: -1,
    baseCumulativeOffset: { x: 0, y: 0 },
    layerWidth: width,
    layerHeight: height,
    layerCount: options?.layerCount ?? 1,
  };
}

export function getCommandOffset<TCustom = never>(
  state: HistoryState<TCustom>,
  absoluteIndex: number,
): number {
  return absoluteIndex - state.historyStartIndex;
}

export function getCommandAt<TCustom = never>(
  state: HistoryState<TCustom>,
  absoluteIndex: number,
): Command<TCustom> | undefined {
  const offset = getCommandOffset(state, absoluteIndex);
  return offset >= 0 && offset < state.commands.length
    ? state.commands[offset]
    : undefined;
}

export function getLastCommandIndex<TCustom = never>(
  state: HistoryState<TCustom>,
): number {
  return state.historyStartIndex + state.commands.length - 1;
}

export function getCommandsInRange<TCustom = never>(
  state: HistoryState<TCustom>,
  fromAbsoluteIndex: number,
  toAbsoluteIndex: number,
): readonly Command<TCustom>[] {
  if (toAbsoluteIndex < fromAbsoluteIndex) return [];
  const commands: Command<TCustom>[] = [];
  for (let i = fromAbsoluteIndex; i <= toAbsoluteIndex; i++) {
    const command = getCommandAt(state, i);
    if (command) commands.push(command);
  }
  return commands;
}

function getEffectiveMaxCheckpoints<TCustom>(
  state: HistoryState<TCustom>,
  layerCount?: number,
  config: HistoryConfig = DEFAULT_HISTORY_CONFIG,
): number {
  return Math.max(config.maxCheckpoints, layerCount ?? state.layerCount);
}

function normalizeConfig(config?: HistoryConfig): HistoryConfig {
  return { ...DEFAULT_HISTORY_CONFIG, ...config };
}

function getLatestCheckpointForLayer<TCustom>(
  state: HistoryState<TCustom>,
  layerId: string,
): Checkpoint | undefined {
  let best: Checkpoint | undefined;
  for (const checkpoint of state.checkpoints) {
    if (
      checkpoint.layerId === layerId &&
      checkpoint.commandIndex <= state.currentIndex &&
      (!best || checkpoint.commandIndex > best.commandIndex)
    ) {
      best = checkpoint;
    }
  }
  return best;
}

function shouldCreateCheckpoint<TCustom>(
  state: HistoryState<TCustom>,
  layer: Layer,
  config: HistoryConfig,
): boolean {
  const latest = getLatestCheckpointForLayer(state, layer.id);
  return (
    !latest ||
    state.currentIndex - latest.commandIndex >= config.checkpointInterval
  );
}

function commandDependsOnLayer<TCustom>(
  command: Command<TCustom>,
  layerId: string,
): boolean {
  if (isLayerDrawCommand(command)) return command.layerId === layerId;
  if (isDrawCommand(command)) return command.type === "wrap-shift";
  if (!isStructuralCommand(command)) return false;
  switch (command.type) {
    case "remove-layer":
      return command.layerId === layerId;
    case "duplicate-layer":
      return command.sourceLayerId === layerId || command.layerId === layerId;
    case "merge-layer-down":
      return (
        command.sourceLayerId === layerId || command.targetLayerId === layerId
      );
    default:
      return false;
  }
}

function containsWrapShift<TCustom>(
  state: HistoryState<TCustom>,
  fromIndex: number,
  toIndex: number,
): boolean {
  for (let i = fromIndex; i <= toIndex; i++) {
    const command = getCommandAt(state, i);
    if (command && isDrawCommand(command) && command.type === "wrap-shift") {
      return true;
    }
  }
  return false;
}

function findLastDependencyIndex<TCustom>(
  state: HistoryState<TCustom>,
  layerId: string,
  fromIndex: number,
): number {
  let last = fromIndex - 1;
  for (let i = fromIndex; i <= getLastCommandIndex(state); i++) {
    const command = getCommandAt(state, i);
    if (command && commandDependsOnLayer(command, layerId)) last = i;
  }
  return last;
}

function computeHistoryStartIndex<TCustom>(
  state: HistoryState<TCustom>,
): number {
  if (state.checkpoints.length === 0) return state.historyStartIndex;
  let min = Number.POSITIVE_INFINITY;
  for (const checkpoint of state.checkpoints) {
    if (checkpoint.commandIndex <= state.currentIndex) {
      min = Math.min(min, checkpoint.commandIndex + 1);
    }
  }
  return Number.isFinite(min) ? min : getLastCommandIndex(state) + 1;
}

function pruneCommandPrefix<TCustom>(
  state: HistoryState<TCustom>,
): HistoryState<TCustom> {
  const nextStart = computeHistoryStartIndex(state);
  if (nextStart <= state.historyStartIndex) return state;

  let baseX = state.baseCumulativeOffset.x;
  let baseY = state.baseCumulativeOffset.y;
  for (let i = state.historyStartIndex; i < nextStart; i++) {
    const command = getCommandAt(state, i);
    if (command && isDrawCommand(command) && command.type === "wrap-shift") {
      baseX += command.dx;
      baseY += command.dy;
    }
  }

  const dropCount = nextStart - state.historyStartIndex;
  return {
    ...state,
    commands: state.commands.slice(dropCount),
    historyStartIndex: nextStart,
    baseCumulativeOffset: { x: baseX, y: baseY },
  };
}

function evictCheckpoints<TCustom>(
  state: HistoryState<TCustom>,
  effectiveMaxCheckpoints: number,
): HistoryState<TCustom> {
  let next = state;
  while (next.checkpoints.length > effectiveMaxCheckpoints) {
    const evicted = next.checkpoints.reduce((oldest, checkpoint) =>
      checkpoint.createdAt < oldest.createdAt ? checkpoint : oldest,
    );
    const remaining = next.checkpoints.filter((cp) => cp.id !== evicted.id);
    const nextForLayer = remaining
      .filter(
        (cp) =>
          cp.layerId === evicted.layerId &&
          cp.commandIndex > evicted.commandIndex,
      )
      .sort((a, b) => a.commandIndex - b.commandIndex)[0];

    let dependencyEnd = nextForLayer
      ? nextForLayer.commandIndex
      : findLastDependencyIndex(
          next,
          evicted.layerId,
          evicted.commandIndex + 1,
        );
    if (dependencyEnd < evicted.commandIndex) {
      dependencyEnd = evicted.commandIndex;
    }
    if (
      containsWrapShift(next, evicted.commandIndex + 1, dependencyEnd) &&
      next.currentIndex > dependencyEnd
    ) {
      dependencyEnd = next.currentIndex;
    }

    next = {
      ...next,
      checkpoints: remaining,
      undoFloorIndex: Math.max(next.undoFloorIndex, dependencyEnd),
    };
  }
  return pruneCommandPrefix(next);
}

function compressCheckpoints<TCustom>(
  state: HistoryState<TCustom>,
  config: HistoryConfig,
): HistoryState<TCustom> {
  if (config.checkpointCompression !== "fast") return state;
  return {
    ...state,
    checkpoints: state.checkpoints.map((checkpoint) =>
      compressCheckpoint(checkpoint),
    ),
  };
}

export function beginHistoryMutation<TCustom = never>(
  state: HistoryState<TCustom>,
  options: {
    readonly affectedLayers: readonly Layer[];
    readonly layerCount?: number;
  },
  config: HistoryConfig = DEFAULT_HISTORY_CONFIG,
): HistoryState<TCustom> {
  const normalizedConfig = normalizeConfig(config);
  let checkpoints = state.checkpoints;
  for (const layer of options.affectedLayers) {
    if (
      !shouldCreateCheckpoint(
        { ...state, checkpoints },
        layer,
        normalizedConfig,
      )
    ) {
      continue;
    }
    checkpoints = [...checkpoints, createCheckpoint(layer, state.currentIndex)];
  }

  const next: HistoryState<TCustom> = {
    ...state,
    checkpoints,
    layerCount: options.layerCount ?? state.layerCount,
  };
  return evictCheckpoints(
    next,
    getEffectiveMaxCheckpoints(next, options.layerCount, normalizedConfig),
  );
}

function getCommandAffectedLayerIds<TCustom>(
  command: Command<TCustom>,
  options: PushCommandOptions,
): readonly string[] {
  if (isLayerDrawCommand(command)) return [command.layerId];
  if (isDrawCommand(command) && command.type === "wrap-shift") {
    return options.affectedLayerIds ?? [];
  }
  if (isStructuralCommand(command) && command.type === "remove-layer") {
    return [command.layerId];
  }
  if (isStructuralCommand(command) && command.type === "duplicate-layer") {
    return [command.sourceLayerId];
  }
  if (isStructuralCommand(command) && command.type === "merge-layer-down") {
    return [command.sourceLayerId, command.targetLayerId];
  }
  return [];
}

function hasCheckpointCoverage<TCustom>(
  state: HistoryState<TCustom>,
  layerId: string,
): boolean {
  return !!getLatestCheckpointForLayer(state, layerId);
}

function warnMissingCheckpoint<TCustom>(
  state: HistoryState<TCustom>,
  command: Command<TCustom>,
  layerIds: readonly string[],
): void {
  const type = (command as { readonly type?: string }).type ?? "custom";
  console.warn(
    `[headless-paint] pushCommand skipped undoable command without checkpoint coverage. type=${type}, layerIds=${layerIds.join(",")}, currentIndex=${state.currentIndex}. Call beginHistoryMutation() immediately before mutating affected layer pixels.`,
  );
}

function absorbUntrackedMutation<TCustom>(
  state: HistoryState<TCustom>,
  command: Command<TCustom>,
  options: PushCommandOptions,
): HistoryState<TCustom> {
  const redoTrimmed = state.commands.slice(
    0,
    Math.max(0, state.currentIndex - state.historyStartIndex + 1),
  );
  const next: HistoryState<TCustom> = {
    ...state,
    commands: redoTrimmed,
    checkpoints: state.checkpoints.filter(
      (cp) => cp.commandIndex <= state.currentIndex,
    ),
    undoFloorIndex: state.currentIndex,
    layerCount: options.layerCount ?? state.layerCount,
  };
  return isDrawCommand(command) && command.type === "wrap-shift"
    ? {
        ...next,
        baseCumulativeOffset: {
          x: next.baseCumulativeOffset.x + command.dx,
          y: next.baseCumulativeOffset.y + command.dy,
        },
      }
    : next;
}

export function pushCommand<TCustom = never>(
  state: HistoryState<TCustom>,
  command: Command<TCustom>,
  options: PushCommandOptions,
  config: HistoryConfig = DEFAULT_HISTORY_CONFIG,
): HistoryState<TCustom> {
  const normalizedConfig = normalizeConfig(config);
  const affectedLayerIds = getCommandAffectedLayerIds(command, options);
  const missingLayerIds = affectedLayerIds.filter(
    (layerId) => !hasCheckpointCoverage(state, layerId),
  );
  if (missingLayerIds.length > 0) {
    warnMissingCheckpoint(state, command, missingLayerIds);
    return absorbUntrackedMutation(state, command, options);
  }

  const redoTrimOffset = Math.max(
    0,
    state.currentIndex - state.historyStartIndex + 1,
  );
  const newCommandIndex = state.currentIndex + 1;
  const newCommands = [...state.commands.slice(0, redoTrimOffset), command];
  const newCheckpoints = state.checkpoints.filter(
    (cp) => cp.commandIndex <= state.currentIndex,
  );
  const next: HistoryState<TCustom> = {
    ...state,
    commands: newCommands,
    checkpoints: newCheckpoints,
    currentIndex: newCommandIndex,
    layerCount: options.layerCount ?? state.layerCount,
  };
  const compressed = compressCheckpoints(next, normalizedConfig);
  return evictCheckpoints(
    compressed,
    getEffectiveMaxCheckpoints(
      compressed,
      options.layerCount,
      normalizedConfig,
    ),
  );
}

export function canUndo<TCustom = never>(
  state: HistoryState<TCustom>,
): boolean {
  return state.currentIndex > state.undoFloorIndex;
}

export function canRedo<TCustom = never>(
  state: HistoryState<TCustom>,
): boolean {
  return state.currentIndex < getLastCommandIndex(state);
}

export function undo<TCustom = never>(
  state: HistoryState<TCustom>,
): HistoryState<TCustom> {
  if (!canUndo(state)) return state;
  return { ...state, currentIndex: state.currentIndex - 1 };
}

export function redo<TCustom = never>(
  state: HistoryState<TCustom>,
): HistoryState<TCustom> {
  if (!canRedo(state)) return state;
  return { ...state, currentIndex: state.currentIndex + 1 };
}

export function findBestCheckpointForLayer<TCustom = never>(
  state: HistoryState<TCustom>,
  layerId: string,
): Checkpoint | undefined {
  return getLatestCheckpointForLayer(state, layerId);
}

export function getCommandsToReplayForLayer<TCustom = never>(
  state: HistoryState<TCustom>,
  layerId: string,
  fromCheckpoint?: Checkpoint,
): readonly Command<TCustom>[] {
  const startIndex = fromCheckpoint
    ? fromCheckpoint.commandIndex + 1
    : state.historyStartIndex;
  const commands: Command<TCustom>[] = [];
  for (let i = startIndex; i <= state.currentIndex; i++) {
    const command = getCommandAt(state, i);
    if (!command) continue;
    if (isDrawCommand(command) && command.type === "wrap-shift") {
      commands.push(command);
    } else if (isLayerDrawCommand(command) && command.layerId === layerId) {
      commands.push(command);
    } else if (
      isStructuralCommand(command) &&
      command.type === "duplicate-layer" &&
      command.layerId === layerId
    ) {
      commands.push(command);
    } else if (
      isStructuralCommand(command) &&
      command.type === "merge-layer-down" &&
      (command.sourceLayerId === layerId || command.targetLayerId === layerId)
    ) {
      commands.push(command);
    }
  }
  return commands;
}

export function getCommandPixelScope<TCustom = never>(
  cmd: Command<TCustom>,
): PixelScope<TCustom> {
  if (isLayerDrawCommand(cmd)) return { type: "layer", layerId: cmd.layerId };
  if (isDrawCommand(cmd)) return { type: "all" };
  if (isStructuralCommand(cmd)) return { type: "structural" };
  return { type: "custom", command: cmd as TCustom };
}

export function getAffectedLayerIds<TCustom = never>(
  state: HistoryState<TCustom>,
  fromIndex: number,
  toIndex: number,
): AffectedLayers {
  const ids = new Set<string>();
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  for (let i = lo; i <= hi; i++) {
    const command = getCommandAt(state, i);
    if (!command) continue;
    if (isDrawCommand(command) && command.type === "wrap-shift") {
      return { type: "all" };
    }
    if (isLayerDrawCommand(command)) ids.add(command.layerId);
    if (isStructuralCommand(command)) {
      switch (command.type) {
        case "duplicate-layer":
          ids.add(command.layerId);
          break;
        case "merge-layer-down":
          ids.add(command.sourceLayerId);
          ids.add(command.targetLayerId);
          break;
      }
    }
  }
  return { type: "partial", layerIds: ids };
}

export function computeCumulativeOffset<TCustom = never>(
  state: HistoryState<TCustom>,
): { readonly x: number; readonly y: number } {
  let x = state.baseCumulativeOffset.x;
  let y = state.baseCumulativeOffset.y;
  for (let i = state.historyStartIndex; i <= state.currentIndex; i++) {
    const command = getCommandAt(state, i);
    if (command && isDrawCommand(command) && command.type === "wrap-shift") {
      x += command.dx;
      y += command.dy;
    }
  }
  const w = state.layerWidth;
  const h = state.layerHeight;
  return { x: ((x % w) + w) % w, y: ((y % h) + h) % h };
}

function getCheckpointBytes(checkpoint: Checkpoint): {
  readonly raw: number;
  readonly encoded: number;
} {
  switch (checkpoint.payload.type) {
    case "raw":
      return { raw: checkpoint.payload.imageData.data.byteLength, encoded: 0 };
    case "encoded":
      return { raw: 0, encoded: checkpoint.payload.bytes.byteLength };
    case "empty":
      return { raw: 0, encoded: 0 };
  }
}

export function getHistoryMetrics<TCustom = never>(
  state: HistoryState<TCustom>,
): HistoryMetrics {
  let rawCheckpointCount = 0;
  let encodedCheckpointCount = 0;
  let rawCheckpointBytes = 0;
  let encodedCheckpointBytes = 0;
  const byLayer = new Map<
    string,
    { count: number; rawBytes: number; encodedBytes: number }
  >();

  for (const checkpoint of state.checkpoints) {
    if (checkpoint.payload.type === "raw") rawCheckpointCount++;
    if (checkpoint.payload.type === "encoded") encodedCheckpointCount++;
    const bytes = getCheckpointBytes(checkpoint);
    rawCheckpointBytes += bytes.raw;
    encodedCheckpointBytes += bytes.encoded;
    const current = byLayer.get(checkpoint.layerId) ?? {
      count: 0,
      rawBytes: 0,
      encodedBytes: 0,
    };
    byLayer.set(checkpoint.layerId, {
      count: current.count + 1,
      rawBytes: current.rawBytes + bytes.raw,
      encodedBytes: current.encodedBytes + bytes.encoded,
    });
  }

  return {
    commandCount: state.commands.length,
    historyStartIndex: state.historyStartIndex,
    currentIndex: state.currentIndex,
    undoFloorIndex: state.undoFloorIndex,
    undoableCommandCount: Math.max(
      0,
      state.currentIndex - state.undoFloorIndex,
    ),
    redoableCommandCount: Math.max(
      0,
      getLastCommandIndex(state) - state.currentIndex,
    ),
    checkpointCount: state.checkpoints.length,
    effectiveMaxCheckpoints: getEffectiveMaxCheckpoints(state),
    rawCheckpointCount,
    encodedCheckpointCount,
    rawCheckpointBytes,
    encodedCheckpointBytes,
    totalCheckpointBytes: rawCheckpointBytes + encodedCheckpointBytes,
    checkpointsByLayer: [...byLayer.entries()].map(([layerId, entry]) => ({
      layerId,
      count: entry.count,
      rawBytes: entry.rawBytes,
      encodedBytes: entry.encodedBytes,
    })),
  };
}

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

export function getCommandsToReplay<TCustom = never>(
  state: HistoryState<TCustom>,
  fromCheckpoint?: Checkpoint,
): readonly Command<TCustom>[] {
  const startIndex = fromCheckpoint
    ? fromCheckpoint.commandIndex + 1
    : state.historyStartIndex;
  return getCommandsInRange(state, startIndex, state.currentIndex);
}
