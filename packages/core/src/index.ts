export type {
  BackgroundSettings,
  BrushConfig,
  BrushDynamics,
  BrushRenderState,
  BrushTipConfig,
  CircleTipConfig,
  Color,
  CompiledExpand,
  ContentBounds,
  ExpandConfig,
  ExpandLevel,
  ExpandMode,
  ImageTipConfig,
  Layer,
  LayerMeta,
  LayerTransformPreview,
  PendingOverlay,
  Point as EnginePoint,
  PressureCurve,
  RoundPenBrushConfig,
  StampBrushConfig,
  StrokePoint,
  StrokeStyle,
} from "@headless-paint/engine";

export {
  AIRBRUSH,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_PRESSURE_CURVE,
  MARKER,
  PENCIL,
  ROUND_PEN,
} from "@headless-paint/engine";

export { hashSeed, mulberry32, renderBrushStroke } from "@headless-paint/engine";
export {
  createBrushTipRegistry,
  generateBrushTip,
  type BrushTipRegistry,
} from "@headless-paint/engine";
export {
  clearLayer,
  colorToStyle,
  createLayer,
  getImageData,
  getPixel,
  setPixel,
} from "@headless-paint/engine";
export {
  applyPressureCurve,
  calculateRadius,
  drawCircle,
  drawLine,
  drawPath,
  drawVariableWidthPath,
  interpolateStrokePoints,
} from "@headless-paint/engine";
export {
  renderLayerWithTransform,
  renderLayers,
  type RenderOptions,
} from "@headless-paint/engine";
export {
  compileExpand,
  compileLocalTransforms,
  createDefaultExpandConfig,
  expandPoint,
  expandStroke,
  expandStrokePoints,
  getExpandCount,
} from "@headless-paint/engine";
export {
  appendToCommittedLayer,
  composeLayers,
  renderPendingLayer,
  type ViewTransform as ComposeViewTransform,
} from "@headless-paint/engine";
export {
  createPatternTile,
  DEFAULT_PATTERN_PREVIEW_CONFIG,
  renderPatternPreview,
  type PatternMode,
  type PatternPreviewConfig,
} from "@headless-paint/engine";
export { getContentBounds } from "@headless-paint/engine";
export { transformLayer } from "@headless-paint/engine";
export { wrapShiftLayer } from "@headless-paint/engine";
export {
  addLayer,
  findLayerById,
  getLayerIndex,
  moveLayer,
  removeLayer,
  updateLayerMeta,
} from "@headless-paint/engine";

export type {
  Point,
  ViewTransform,
  SamplingConfig,
  SamplingState,
  TransformComponents,
  InputPoint,
  FilterType,
  SmoothingConfig,
  StraightLineConfig,
  FilterConfig,
  FilterPipelineConfig,
  CompiledFilterPipeline,
  FilterPipelineState,
  FilterOutput,
  FilterProcessResult,
  FilterPlugin,
  FilterState,
  FilterStepResult,
  GesturePointerEvent,
  GestureConfig,
  GestureState,
  GestureEvent,
} from "@headless-paint/input";

export {
  applyDpr,
  computeSimilarityTransform,
  createViewTransform,
  decomposeTransform,
  fitToView,
  invertViewTransform,
  pan,
  rotate,
  zoom,
} from "@headless-paint/input";
export { screenToLayer, layerToScreen } from "@headless-paint/input";
export { shouldAcceptPoint, createSamplingState } from "@headless-paint/input";
export {
  compileFilterPipeline,
  createFilterPipelineState,
  processPoint,
  finalizePipeline,
  processAllPoints,
} from "@headless-paint/input";
export { getFilterPlugin, registerFilterPlugin } from "@headless-paint/input";
export {
  DEFAULT_GESTURE_CONFIG,
  createGestureState,
  processGestureEvent,
} from "@headless-paint/input";

export type {
  AddLayerCommand,
  AffectedLayers,
  Checkpoint,
  ClearCommand,
  Command,
  DrawCommand,
  HistoryConfig,
  HistoryState,
  LayerDrawCommand,
  PixelScope,
  RemoveLayerCommand,
  RenderUpdate,
  ReorderLayerCommand,
  StrokeCommand,
  StrokeSessionResult,
  StrokeSessionState,
  StructuralCommand,
  TransformLayerCommand,
  WrapShiftCommand,
} from "@headless-paint/stroke";
export {
  DEFAULT_HISTORY_CONFIG,
  isCustomCommand,
  isDrawCommand,
  isLayerDrawCommand,
  isStructuralCommand,
} from "@headless-paint/stroke";
export {
  addPointToSession,
  createAddLayerCommand,
  createClearCommand,
  createRemoveLayerCommand,
  createReorderLayerCommand,
  createStrokeCommand,
  createTransformLayerCommand,
  createWrapShiftCommand,
  endStrokeSession,
  startStrokeSession,
} from "@headless-paint/stroke";
export {
  canRedo,
  canUndo,
  computeCumulativeOffset,
  createHistoryState,
  findBestCheckpoint,
  findBestCheckpointForLayer,
  getAffectedLayerIds,
  getCommandPixelScope,
  getCommandsToReplay,
  getCommandsToReplayForLayer,
  pushCommand,
  redo,
  undo,
} from "@headless-paint/stroke";
export { createCheckpoint, restoreFromCheckpoint } from "@headless-paint/stroke";
export {
  rebuildLayerFromHistory,
  rebuildLayerState,
  replayCommand,
  replayCommands,
} from "@headless-paint/stroke";
