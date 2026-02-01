import type { Color, Point } from "@headless-paint/engine";

// Command Types (Discriminated Union)

export interface DrawPathCommand {
  readonly type: "drawPath";
  readonly points: readonly Point[];
  readonly color: Color;
  readonly lineWidth: number;
  readonly timestamp: number;
}

export interface DrawLineCommand {
  readonly type: "drawLine";
  readonly start: Point;
  readonly end: Point;
  readonly color: Color;
  readonly lineWidth: number;
  readonly timestamp: number;
}

export interface DrawCircleCommand {
  readonly type: "drawCircle";
  readonly center: Point;
  readonly radius: number;
  readonly color: Color;
  readonly lineWidth: number;
  readonly timestamp: number;
}

export interface ClearCommand {
  readonly type: "clear";
  readonly timestamp: number;
}

/**
 * 複数のコマンドをまとめるバッチコマンド
 * 対称描画などで複数のストロークを1つの操作として扱う
 */
export interface BatchCommand {
  readonly type: "batch";
  readonly commands: readonly Command[];
  readonly timestamp: number;
}

export type Command =
  | DrawPathCommand
  | DrawLineCommand
  | DrawCircleCommand
  | ClearCommand
  | BatchCommand;

// Checkpoint

export interface Checkpoint {
  readonly id: string;
  readonly commandIndex: number;
  readonly imageData: ImageData;
  readonly createdAt: number;
}

// History State

export interface HistoryState {
  readonly commands: readonly Command[];
  readonly checkpoints: readonly Checkpoint[];
  readonly currentIndex: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
}

// Configuration

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

// Memory Usage

export interface MemoryUsageInfo {
  readonly checkpointsBytes: number;
  readonly commandsBytes: number;
  readonly totalBytes: number;
  readonly formatted: string;
}

// Debug UI用

export interface HistoryEntry {
  readonly index: number;
  readonly command: Command;
  readonly hasCheckpoint: boolean;
  readonly thumbnailDataUrl?: string;
}
