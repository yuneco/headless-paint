// Types
export type {
  AddLayerCommand,
  AffectedLayers,
  Checkpoint,
  CheckpointPayload,
  ClearCommand,
  Command,
  DuplicateLayerCommand,
  DuplicateLayerOptions,
  DuplicateLayerResult,
  DrawCommand,
  HistoryConfig,
  HistoryMetrics,
  HistoryState,
  LayerDrawCommand,
  MergeLayerDownAtomicOptions,
  MergeLayerDownCommand,
  MergeLayerDownResult,
  PixelScope,
  PushCommandOptions,
  RebuildLayerResult,
  RemoveLayerCommand,
  RenderUpdate,
  ReorderLayerCommand,
  StrokeCommand,
  StrokeSessionResult,
  StrokeSessionState,
  StrokeStyle,
  StructuralCommand,
  TransformLayerCommand,
  WrapShiftCommand,
} from "./types";
export {
  DEFAULT_HISTORY_CONFIG,
  isCustomCommand,
  isDrawCommand,
  isLayerDrawCommand,
  isStructuralCommand,
} from "./types";

// Session
export {
  addPointToSession,
  createAddLayerCommand,
  createDuplicateLayerCommand,
  createClearCommand,
  createMergeLayerDownCommand,
  createRemoveLayerCommand,
  createReorderLayerCommand,
  createStrokeCommand,
  createTransformLayerCommand,
  createWrapShiftCommand,
  endStrokeSession,
  startStrokeSession,
} from "./session";

// Layer operations
export {
  applyDuplicateLayerCommand,
  applyMergeLayerDownCommand,
  duplicateLayerAtomic,
  mergeLayerDownAtomic,
} from "./layer-operations";

// History
export {
  canRedo,
  canUndo,
  beginHistoryMutation,
  computeCumulativeOffset,
  createHistoryState,
  findBestCheckpoint,
  findBestCheckpointForLayer,
  getAffectedLayerIds,
  getCommandAt,
  getCommandOffset,
  getCommandPixelScope,
  getCommandsToReplay,
  getCommandsToReplayForLayer,
  getCommandsInRange,
  getHistoryMetrics,
  getLastCommandIndex,
  pushCommand,
  redo,
  undo,
} from "./history";

// Replay
export {
  rebuildLayerFromHistory,
  rebuildLayerState,
  replayCommand,
  replayCommands,
} from "./replay";
