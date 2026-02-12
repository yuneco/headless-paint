import type {
  Color,
  ExpandConfig,
  LayerMeta,
  PressureCurve,
  StrokePoint,
  StrokeStyle,
} from "@headless-paint/engine";
import type { FilterPipelineConfig, InputPoint } from "@headless-paint/input";

export type { StrokeStyle } from "@headless-paint/engine";

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
  readonly newlyCommitted: readonly StrokePoint[];
  readonly currentPending: readonly StrokePoint[];
  readonly style: StrokeStyle;
  readonly expand: ExpandConfig;
  readonly committedOverlapCount: number;
}

export interface StrokeSessionResult {
  readonly state: StrokeSessionState;
  readonly renderUpdate: RenderUpdate;
}

// ============================================================
// Draw Commands (描画コマンド)
// ============================================================

export interface StrokeCommand {
  readonly type: "stroke";
  readonly layerId: string;
  readonly inputPoints: readonly InputPoint[];
  readonly filterPipeline: FilterPipelineConfig;
  readonly expand: ExpandConfig;
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity?: number;
  readonly pressureCurve?: PressureCurve;
  readonly compositeOperation?: GlobalCompositeOperation;
  readonly timestamp: number;
}

export interface ClearCommand {
  readonly type: "clear";
  readonly layerId: string;
  readonly timestamp: number;
}

export interface WrapShiftCommand {
  readonly type: "wrap-shift";
  readonly dx: number;
  readonly dy: number;
  readonly timestamp: number;
}

export type LayerDrawCommand = StrokeCommand | ClearCommand;

export type DrawCommand = LayerDrawCommand | WrapShiftCommand;

// ============================================================
// Structural Commands (構造コマンド)
// ============================================================

export interface AddLayerCommand {
  readonly type: "add-layer";
  readonly layerId: string;
  readonly insertIndex: number;
  readonly width: number;
  readonly height: number;
  readonly meta: LayerMeta;
  readonly timestamp: number;
}

export interface RemoveLayerCommand {
  readonly type: "remove-layer";
  readonly layerId: string;
  readonly removedIndex: number;
  readonly meta: LayerMeta;
  readonly timestamp: number;
}

export interface ReorderLayerCommand {
  readonly type: "reorder-layer";
  readonly layerId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly timestamp: number;
}

export type StructuralCommand =
  | AddLayerCommand
  | RemoveLayerCommand
  | ReorderLayerCommand;

// ============================================================
// Command (統合型)
// ============================================================

export type Command = DrawCommand | StructuralCommand;

export function isDrawCommand(cmd: Command): cmd is DrawCommand {
  return (
    cmd.type === "stroke" || cmd.type === "clear" || cmd.type === "wrap-shift"
  );
}

export function isLayerDrawCommand(cmd: Command): cmd is LayerDrawCommand {
  return cmd.type === "stroke" || cmd.type === "clear";
}

export function isStructuralCommand(cmd: Command): cmd is StructuralCommand {
  return (
    cmd.type === "add-layer" ||
    cmd.type === "remove-layer" ||
    cmd.type === "reorder-layer"
  );
}

// ============================================================
// History State
// ============================================================

export interface Checkpoint {
  readonly id: string;
  readonly layerId: string;
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
