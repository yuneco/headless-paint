// @headless-paint/history
// History management (Undo/Redo) with checkpoint + command hybrid approach

// Types
export type {
  BatchCommand,
  Checkpoint,
  ClearCommand,
  Command,
  DrawCircleCommand,
  DrawLineCommand,
  DrawPathCommand,
  HistoryConfig,
  HistoryEntry,
  HistoryState,
  MemoryUsageInfo,
  StrokeCommand,
} from "./types";

export { DEFAULT_HISTORY_CONFIG } from "./types";

// Command creation
export {
  createBatchCommand,
  createClearCommand,
  createDrawCircleCommand,
  createDrawLineCommand,
  createDrawPathCommand,
  createStrokeCommand,
  getCommandLabel,
} from "./command";

// Checkpoint operations (to be implemented)
export { createCheckpoint, restoreFromCheckpoint } from "./checkpoint";

// History state operations (to be implemented)
export {
  canRedo,
  canUndo,
  createHistoryState,
  pushCommand,
  redo,
  undo,
} from "./history";

// Replay operations (to be implemented)
export { rebuildLayerState, replayCommands } from "./replay";

// Debug utilities (to be implemented)
export { generateThumbnailDataUrl } from "./thumbnail";
export { estimateMemoryUsage, getHistoryEntries } from "./history";
