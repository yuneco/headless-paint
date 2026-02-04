import type { Color, ExpandConfig, Point } from "@headless-paint/engine";
import type { FilterPipelineConfig, InputPoint } from "@headless-paint/input";

// ============================================================
// StrokeStyle
// ============================================================

export interface StrokeStyle {
  readonly color: Color;
  readonly lineWidth: number;
}

// ============================================================
// Session State
// ============================================================

export interface StrokeSessionState {
  readonly allCommitted: readonly InputPoint[];
  readonly currentPending: readonly InputPoint[];
  readonly lastRenderedCommitIndex: number;
  readonly style: StrokeStyle;
  readonly expand: ExpandConfig;
}

export interface RenderUpdate {
  readonly newlyCommitted: readonly Point[];
  readonly currentPending: readonly Point[];
  readonly style: StrokeStyle;
  readonly expand: ExpandConfig;
}

export interface StrokeSessionResult {
  readonly state: StrokeSessionState;
  readonly renderUpdate: RenderUpdate;
}

// ============================================================
// Commands
// ============================================================

export interface StrokeCommand {
  readonly type: "stroke";
  readonly inputPoints: readonly InputPoint[];
  readonly filterPipeline: FilterPipelineConfig;
  readonly expand: ExpandConfig;
  readonly color: Color;
  readonly lineWidth: number;
  readonly timestamp: number;
}

export interface ClearCommand {
  readonly type: "clear";
  readonly timestamp: number;
}

export type Command = StrokeCommand | ClearCommand;

// ============================================================
// History State
// ============================================================

export interface Checkpoint {
  readonly id: string;
  readonly commandIndex: number;
  readonly imageData: ImageData;
  readonly createdAt: number;
}

export interface HistoryState {
  readonly commands: readonly Command[];
  readonly checkpoints: readonly Checkpoint[];
  readonly currentIndex: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
}

export interface HistoryConfig {
  readonly maxHistorySize: number;
  readonly checkpointInterval: number;
  readonly maxCheckpoints: number;
}

export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 10,
  maxCheckpoints: 10,
};
