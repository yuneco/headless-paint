// Types
export type {
  AddLayerCommand,
  Checkpoint,
  ClearCommand,
  Command,
  DrawCommand,
  HistoryConfig,
  HistoryState,
  RemoveLayerCommand,
  RenderUpdate,
  ReorderLayerCommand,
  StrokeCommand,
  StrokeSessionResult,
  StrokeSessionState,
  StrokeStyle,
  StructuralCommand,
  WrapShiftCommand,
} from "./types";
export {
  DEFAULT_HISTORY_CONFIG,
  isDrawCommand,
  isStructuralCommand,
} from "./types";

// Session
export {
  addPointToSession,
  createAddLayerCommand,
  createClearCommand,
  createRemoveLayerCommand,
  createReorderLayerCommand,
  createStrokeCommand,
  createWrapShiftCommand,
  endStrokeSession,
  startStrokeSession,
} from "./session";

// History
export {
  canRedo,
  canUndo,
  computeCumulativeOffset,
  computeCumulativeOffsetForLayer,
  createHistoryState,
  findBestCheckpoint,
  findBestCheckpointForLayer,
  getAffectedLayerIds,
  getCommandsToReplay,
  getCommandsToReplayForLayer,
  pushCommand,
  redo,
  undo,
} from "./history";

// Checkpoint
export { createCheckpoint, restoreFromCheckpoint } from "./checkpoint";

// Replay
export {
  rebuildLayerFromHistory,
  rebuildLayerState,
  replayCommand,
  replayCommands,
} from "./replay";
