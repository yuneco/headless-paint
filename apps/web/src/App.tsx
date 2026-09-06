import { createBrushTipRegistry } from "@headless-paint/engine";
import { compileFilterPipeline } from "@headless-paint/input";
import type { InputPoint } from "@headless-paint/input";
import {
  type ToolType,
  useExpand,
  usePaintEngine,
  usePenSettings,
  useSmoothing,
  useTouchGesture,
  useViewTransform,
  useWindowSize,
} from "@headless-paint/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { registerAppBrushTips } from "./brush-presets";
import { DebugPanel } from "./components/DebugPanel";
import { PaintCanvas } from "./components/PaintCanvas";
import { SidebarPanel } from "./components/SidebarPanel";
import { SymmetryOverlay } from "./components/SymmetryOverlay";
import { Toolbar } from "./components/Toolbar";
import { TouchDebugOverlay } from "./components/TouchDebugOverlay";
import { TransformOverlay } from "./components/TransformOverlay";
import { DEFAULT_PEN_CONFIG, DEFAULT_SMOOTHING_CONFIG } from "./config";
import { usePerfDebugBridge } from "./debug/perf-debug-bridge";
import { useStrokeDebugControls } from "./debug/useStrokeDebugControls";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePatternPreview } from "./hooks/usePatternPreview";
import { useTransformMode } from "./hooks/useTransformMode";
import {
  type PersistedAppSettings,
  clearSettingsSnapshot,
  getGpuBackendUrlOverride,
  getGpuCommitModeUrlOverride,
  loadSettingsSnapshot,
  useSettingsStorage,
} from "./settings-storage";

const EXPERIMENT_LAYER_SIZE = Number(
  new URLSearchParams(window.location.search).get("layerSize") ?? "0",
);
const LAYER_WIDTH =
  EXPERIMENT_LAYER_SIZE > 0 ? EXPERIMENT_LAYER_SIZE : 1024 * 2;
const LAYER_HEIGHT = LAYER_WIDTH;
export function App() {
  const [sessionKey, setSessionKey] = useState(0);
  const [initialSettings, setInitialSettings] =
    useState<PersistedAppSettings | null>(() => loadSettingsSnapshot());

  const handleReset = useCallback(() => {
    const confirmed = window.confirm(
      "設定と現在の描画内容をリセットします。保存されるのは設定のみです。よろしいですか？",
    );
    if (!confirmed) return;
    clearSettingsSnapshot();
    setInitialSettings(null);
    setSessionKey((prev) => prev + 1);
  }, []);

  return (
    <PaintWorkspace
      key={sessionKey}
      initialSettings={initialSettings}
      onReset={handleReset}
    />
  );
}

interface PaintWorkspaceProps {
  readonly initialSettings: PersistedAppSettings | null;
  readonly onReset: () => void;
}

function PaintWorkspace({ initialSettings, onReset }: PaintWorkspaceProps) {
  const restoredSettings = initialSettings?.paint ?? null;
  const persistedGpuBackend = initialSettings?.engineBackend ?? "auto";
  const gpuBackendUrlOverride = getGpuBackendUrlOverride();
  const gpuBackend = gpuBackendUrlOverride ?? persistedGpuBackend;
  const gpuCommitMode = getGpuCommitModeUrlOverride() ?? "bitmap";
  const [tool, setTool] = useState<ToolType>("pen");
  const { width: viewWidth, height: viewHeight } = useWindowSize();
  const {
    transform,
    handlePan,
    handleZoom,
    handleRotate,
    handleSetTransform,
    setInitialFit,
  } = useViewTransform();

  const fitToView = useCallback(() => {
    setInitialFit(viewWidth, viewHeight, LAYER_WIDTH, LAYER_HEIGHT);
  }, [viewWidth, viewHeight, setInitialFit]);

  // 初回マウント時にレイヤーがビュー中央にフィットするよう初期化
  const initialFitDone = useRef(false);
  useEffect(() => {
    if (!initialFitDone.current) {
      if (!restoredSettings) {
        fitToView();
      }
      initialFitDone.current = true;
    }
  }, [fitToView, restoredSettings]);

  // ブラシチップレジストリ
  const registryRef = useRef(createBrushTipRegistry());
  const [registryReady, setRegistryReady] = useState(false);
  useEffect(() => {
    registerAppBrushTips(registryRef.current).then(() =>
      setRegistryReady(true),
    );
  }, []);

  // 設定系 hooks
  const penSettings = usePenSettings({
    initialColor:
      restoredSettings?.pen.color ?? DEFAULT_PEN_CONFIG.initialColor,
    initialLineWidth:
      restoredSettings?.pen.lineWidth ?? DEFAULT_PEN_CONFIG.initialLineWidth,
    initialPressureCurve:
      restoredSettings?.pen.pressureCurve ??
      DEFAULT_PEN_CONFIG.initialPressureCurve,
    initialBrush:
      restoredSettings?.pen.brush ?? DEFAULT_PEN_CONFIG.initialBrush,
  });
  const smoothing = useSmoothing({
    initialEnabled:
      restoredSettings?.smoothing.enabled ??
      DEFAULT_SMOOTHING_CONFIG.initialEnabled,
    initialWindowSize:
      restoredSettings?.smoothing.windowSize ??
      DEFAULT_SMOOTHING_CONFIG.initialWindowSize,
  });
  const usesStatefulMaterial =
    penSettings.brush.type === "bristle" ||
    (penSettings.brush.type === "stamp" && !!penSettings.brush.mixing?.enabled);
  const effectiveFilterPipeline = useMemo(
    () =>
      usesStatefulMaterial
        ? compileFilterPipeline({
            filters: [{ type: "causal-adaptive", config: {} }],
          })
        : smoothing.compiledFilterPipeline,
    [smoothing.compiledFilterPipeline, usesStatefulMaterial],
  );
  const expand = useExpand(LAYER_WIDTH, LAYER_HEIGHT);
  const handleDebugSetSymmetry = useCallback(
    (mode: string, divisions: number) => {
      expand.setMode(mode as Parameters<typeof expand.setMode>[0]);
      expand.setDivisions(divisions);
    },
    [expand.setMode, expand.setDivisions],
  );
  const patternPreview = usePatternPreview();
  const { background, handleToggleBackground, handleGpuBackendChange } =
    useSettingsStorage({
      restoredSettings,
      persistedGpuBackend,
      gpuBackendUrlOverride,
      tool,
      setTool,
      transform,
      handleSetTransform,
      penSettings,
      smoothing,
      expand,
    });

  // メインエンジン
  const engine = usePaintEngine({
    layerWidth: LAYER_WIDTH,
    layerHeight: LAYER_HEIGHT,
    strokeStyle: penSettings.strokeStyle,
    compiledFilterPipeline: effectiveFilterPipeline,
    expandConfig: expand.config,
    compiledExpand: expand.compiled,
    registry: registryRef.current,
    gpuBackend,
    gpuCommitMode,
  });
  const {
    strokeCallMetrics,
    resetStrokeCallMetrics,
    handleStrokeStart: handleMeasuredStrokeStart,
    handleTouchStrokeStart: handleMeasuredTouchStrokeStart,
    handleStrokeMove: handleMeasuredStrokeMove,
    handleStrokeMoves: handleMeasuredStrokeMoves,
    handleStrokeEnd: handleMeasuredStrokeEnd,
    handleDrawBristleSCurve,
    inputCaptureStatus,
    inputCapturePointCount,
    handleArmInputCapture,
    handleCopyInputCapture,
  } = useStrokeDebugControls({
    brush: penSettings.brush,
    lineWidth: penSettings.lineWidth,
    pressureCurve: penSettings.pressureCurve,
    usesStatefulMaterial,
    smoothingEnabled: smoothing.enabled,
    smoothingWindowSize: smoothing.windowSize,
    layerWidth: LAYER_WIDTH,
    layerHeight: LAYER_HEIGHT,
    canDraw: engine.canDraw,
    isDrawing: engine.isDrawing,
    onStrokeStart: engine.onStrokeStart,
    onStrokeMove: engine.onStrokeMove,
    onStrokeMoves: engine.onStrokeMoves,
    onStrokeEnd: engine.onStrokeEnd,
  });
  const { handleTimedUndo } = usePerfDebugBridge({
    setColor: penSettings.setColor,
    setLineWidth: penSettings.setLineWidth,
    setBrush: penSettings.setBrush,
    setSymmetry: handleDebugSetSymmetry,
    undo: engine.undo,
  });

  // 変換モード
  const transformMode = useTransformMode({
    commitTransform: engine.commitTransform,
  });
  const isTransformLocked = transformMode.isActive;

  const handleStartTransform = useCallback(
    (layerId: string) => {
      const entry = engine.entries.find((e) => e.id === layerId);
      if (!entry) return;
      const started = transformMode.start(layerId, entry.committedLayer);
      if (!started) {
        window.alert("空のレイヤーは変換できません");
      }
    },
    [engine.entries, transformMode.start],
  );

  const [showTouchDebug, setShowTouchDebug] = useState(false);

  const handleToolChange = useCallback((newTool: ToolType) => {
    setTool(newTool);
  }, []);

  const handleToggleTouchDebug = useCallback(() => {
    setShowTouchDebug((prev) => !prev);
  }, []);

  useEffect(() => {
    penSettings.setEraser(tool === "eraser");
  }, [tool, penSettings.setEraser]);

  // タッチジェスチャー
  const touchGesture = useTouchGesture({
    transform,
    onStrokeStart: engine.canDraw ? handleMeasuredTouchStrokeStart : undefined,
    onStrokeMove: engine.canDraw ? handleMeasuredStrokeMove : undefined,
    onStrokeEnd: engine.canDraw ? handleMeasuredStrokeEnd : undefined,
    onDrawConfirm: engine.onDrawConfirm,
    onDrawCancel: engine.onDrawCancel,
    onSetTransform: handleSetTransform,
    onUndo: engine.undo,
    debugEnabled: showTouchDebug,
  });

  // キーボードショートカット
  const { shiftHeld } = useKeyboardShortcuts({
    tool,
    setTool: handleToolChange,
    isDrawing: engine.isDrawing,
    onUndo: engine.undo,
    onRedo: engine.redo,
    expandMode: expand.config.levels[0].mode,
    setExpandMode: expand.setMode,
    expandDivisions: expand.config.levels[0].divisions,
    setExpandDivisions: expand.setDivisions,
    lineWidth: penSettings.lineWidth,
    setLineWidth: penSettings.setLineWidth,
  });

  // Shift+ドラッグで直線モード
  const handleStrokeStart = useCallback(
    (point: InputPoint) => {
      handleMeasuredStrokeStart(point, { straightLine: shiftHeld.current });
    },
    [handleMeasuredStrokeStart, shiftHeld],
  );

  const strokeCount = engine.historyState.currentIndex + 1;
  // レイヤーID→表示名の解決関数
  const layerIdToName = useCallback(
    (layerId: string) => {
      const idx = engine.entries.findIndex((e) => e.id === layerId);
      if (idx === -1) return "?";
      return `L${idx + 1}`;
    },
    [engine.entries],
  );
  const minimapLayers = useMemo(
    () => engine.entries.map((entry) => entry.committedLayer),
    [engine.entries],
  );

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <PaintCanvas
        layers={engine.layers}
        transform={transform}
        background={background}
        patternPreview={patternPreview.config}
        pendingOverlay={engine.pendingOverlay}
        layerTransformPreview={transformMode.preview}
        tool={tool}
        onPan={!isTransformLocked ? handlePan : undefined}
        onZoom={!isTransformLocked ? handleZoom : undefined}
        onRotate={!isTransformLocked ? handleRotate : undefined}
        onStrokeStart={
          !isTransformLocked && engine.canDraw ? handleStrokeStart : undefined
        }
        onStrokeMove={
          !isTransformLocked && engine.canDraw
            ? handleMeasuredStrokeMove
            : undefined
        }
        onStrokeMoves={
          !isTransformLocked && engine.canDraw
            ? handleMeasuredStrokeMoves
            : undefined
        }
        onStrokeEnd={
          !isTransformLocked && engine.canDraw
            ? handleMeasuredStrokeEnd
            : undefined
        }
        onTouchPointerEvent={
          !isTransformLocked ? touchGesture.handlePointerEvent : undefined
        }
        onWrapShift={!isTransformLocked ? engine.onWrapShift : undefined}
        onWrapShiftEnd={!isTransformLocked ? engine.onWrapShiftEnd : undefined}
        wrapOffset={engine.cumulativeOffset}
        width={viewWidth}
        height={viewHeight}
        layerWidth={LAYER_WIDTH}
        layerHeight={LAYER_HEIGHT}
        renderVersion={engine.renderVersion}
      />

      {transformMode.state && (
        <TransformOverlay
          state={transformMode.state}
          transform={transform}
          width={viewWidth}
          height={viewHeight}
          onUpdateMatrix={transformMode.updateMatrix}
          onConfirm={transformMode.confirm}
          onCancel={transformMode.cancel}
        />
      )}

      <SymmetryOverlay
        config={expand.config}
        transform={transform}
        width={viewWidth}
        height={viewHeight}
        onSubOffsetChange={expand.setSubOffset}
      />

      <TouchDebugOverlay
        enabled={showTouchDebug}
        touchPoints={touchGesture.touchPoints}
        gesturePhase={touchGesture.gesturePhase}
        width={viewWidth}
        height={viewHeight}
      />

      {/* ツールバーを上部中央にオーバーレイ配置 */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
        }}
      >
        <Toolbar
          currentTool={tool}
          onToolChange={handleToolChange}
          onUndo={handleTimedUndo}
          onRedo={engine.redo}
          canUndo={engine.canUndo}
          canRedo={engine.canRedo}
          color={penSettings.color}
          onColorChange={penSettings.setColor}
          onReset={onReset}
        />
      </div>

      <SidebarPanel
        minimapLayers={minimapLayers}
        viewTransform={transform}
        mainCanvasWidth={viewWidth}
        mainCanvasHeight={viewHeight}
        renderVersion={engine.renderVersion}
        historyState={engine.historyState}
        onUndo={handleTimedUndo}
        onRedo={engine.redo}
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
        brush={penSettings.brush}
        onBrushChange={penSettings.setBrush}
        registry={registryRef.current}
        registryReady={registryReady}
        strokeCallMetrics={strokeCallMetrics}
        onResetStrokeCallMetrics={resetStrokeCallMetrics}
        onDrawBristleSCurve={
          !isTransformLocked && penSettings.brush.type === "bristle"
            ? handleDrawBristleSCurve
            : undefined
        }
        inputCaptureStatus={inputCaptureStatus}
        inputCapturePointCount={inputCapturePointCount}
        onArmInputCapture={handleArmInputCapture}
        onCopyInputCapture={handleCopyInputCapture}
        entries={engine.entries}
        activeLayerId={engine.activeLayerId}
        background={background}
        onSelectLayer={engine.setActiveLayerId}
        onAddLayer={engine.addLayer}
        onRemoveLayer={engine.removeLayer}
        onToggleVisibility={engine.toggleVisibility}
        onToggleAlphaLock={engine.toggleAlphaLock}
        onToggleBackground={handleToggleBackground}
        onMoveUp={engine.moveLayerUp}
        onMoveDown={engine.moveLayerDown}
        onDuplicateLayer={engine.duplicateLayer}
        onMergeLayerDown={engine.mergeLayerDown}
        onSetOpacity={engine.setLayerOpacity}
        onSetBlendMode={engine.setLayerBlendMode}
        onTransform={!isTransformLocked ? handleStartTransform : undefined}
        layerIdToName={layerIdToName}
      />

      <DebugPanel
        transform={transform}
        strokeCount={strokeCount}
        expand={expand}
        smoothing={smoothing}
        penSettings={penSettings}
        patternPreview={patternPreview}
        layerOffset={engine.cumulativeOffset}
        onResetOffset={engine.onResetOffset}
        showTouchDebug={showTouchDebug}
        onToggleTouchDebug={handleToggleTouchDebug}
        gpuBackendSetting={gpuBackend}
        gpuBackend={engine.gpuBackend}
        gpuBackendReason={engine.gpuBackendReason}
        gpuCommitMode={gpuCommitMode}
        onGpuBackendChange={handleGpuBackendChange}
      />
    </div>
  );
}
