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

// Command executor
export type {
  CustomCommandExecutor,
  CustomCommandOutcome,
  DirtyHint,
  ExecutorDeps,
  ExecutorFailure,
  ExecutorResult,
  LayerListOp,
  PersistenceEvent,
} from "./command-executor";
export {
  executeHistoryOp,
  resolvePushPersistenceEvent,
} from "./command-executor";

// Stroke machine
export type {
  StrokeMachineEffect,
  StrokeMachineEvent,
  StrokePhase,
  StrokeTransitionResult,
} from "./stroke-machine";
export {
  createInitialStrokePhase,
  transitionStroke,
} from "./stroke-machine";

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
