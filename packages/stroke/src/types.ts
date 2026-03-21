import type {
  ExpandConfig,
  LayerMeta,
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
  readonly style: StrokeStyle;
  readonly brushSeed: number;
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

export interface TransformLayerCommand {
  readonly type: "transform-layer";
  readonly layerId: string;
  readonly matrix: readonly number[];
  readonly timestamp: number;
}

export type LayerDrawCommand =
  | StrokeCommand
  | ClearCommand
  | TransformLayerCommand;

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
// Pixel Scope (ピクセル影響スコープ)
// ============================================================

export type PixelScope<TCustom = never> =
  | { readonly type: "layer"; readonly layerId: string }
  | { readonly type: "all" }
  | { readonly type: "structural" }
  | { readonly type: "custom"; readonly command: TCustom };

export type AffectedLayers =
  | { readonly type: "partial"; readonly layerIds: ReadonlySet<string> }
  | { readonly type: "all" };

// ============================================================
// Command (統合型)
// ============================================================

export type Command<TCustom = never> =
  | DrawCommand
  | StructuralCommand
  | TCustom;

export function isDrawCommand<TCustom>(
  cmd: Command<TCustom>,
): cmd is DrawCommand {
  const c = cmd as { type?: string };
  return (
    c.type === "stroke" ||
    c.type === "clear" ||
    c.type === "wrap-shift" ||
    c.type === "transform-layer"
  );
}

export function isLayerDrawCommand<TCustom>(
  cmd: Command<TCustom>,
): cmd is LayerDrawCommand {
  const c = cmd as { type?: string };
  return (
    c.type === "stroke" || c.type === "clear" || c.type === "transform-layer"
  );
}

export function isStructuralCommand<TCustom>(
  cmd: Command<TCustom>,
): cmd is StructuralCommand {
  const c = cmd as { type?: string };
  return (
    c.type === "add-layer" ||
    c.type === "remove-layer" ||
    c.type === "reorder-layer"
  );
}

export function isCustomCommand<TCustom>(
  cmd: Command<TCustom>,
): cmd is TCustom {
  return !isDrawCommand(cmd) && !isStructuralCommand(cmd);
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

export interface HistoryState<TCustom = never> {
  readonly commands: readonly Command<TCustom>[];
  readonly checkpoints: readonly Checkpoint[];
  readonly currentIndex: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly drawsSinceCheckpoint: number;
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
