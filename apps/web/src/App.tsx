import {
  DEFAULT_BACKGROUND_COLOR,
  createBrushTipRegistry,
} from "@headless-paint/engine";
import type { BackgroundSettings } from "@headless-paint/engine";
import { createViewTransform } from "@headless-paint/input";
import type { InputPoint } from "@headless-paint/input";
import {
  type PaintSettingsSnapshot,
  type ToolType,
  exportPaintSettings,
  importPaintSettings,
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
import { DEFAULT_PEN_CONFIG, DEFAULT_SMOOTHING_CONFIG } from "./config";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePatternPreview } from "./hooks/usePatternPreview";

const LAYER_WIDTH = 1024 * 2;
const LAYER_HEIGHT = 1024 * 2;
const SETTINGS_STORAGE_KEY = "headless-paint:settings";

function saveSettingsSnapshot(snapshot: PaintSettingsSnapshot): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // noop: localStorage の容量超過時もアプリは継続
  }
}

function loadSettingsSnapshot(): PaintSettingsSnapshot | null {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return importPaintSettings(parsed);
  } catch {
    return null;
  }
}

export function App() {
  const [sessionKey, setSessionKey] = useState(0);
  const [initialSettings, setInitialSettings] =
    useState<PaintSettingsSnapshot | null>(() => loadSettingsSnapshot());

  const handleReset = useCallback(() => {
    const confirmed = window.confirm(
      "設定と現在の描画内容をリセットします。保存されるのは設定のみです。よろしいですか？",
    );
    if (!confirmed) return;
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
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
  readonly initialSettings: PaintSettingsSnapshot | null;
  readonly onReset: () => void;
}

function PaintWorkspace({ initialSettings, onReset }: PaintWorkspaceProps) {
  const restoredSettings = initialSettings;
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
    initialPressureSensitivity:
      restoredSettings?.pen.pressureSensitivity ??
      DEFAULT_PEN_CONFIG.initialPressureSensitivity,
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
  const expand = useExpand(LAYER_WIDTH, LAYER_HEIGHT);
  const patternPreview = usePatternPreview();

  // メインエンジン
  const engine = usePaintEngine({
    layerWidth: LAYER_WIDTH,
    layerHeight: LAYER_HEIGHT,
    strokeStyle: penSettings.strokeStyle,
    compiledFilterPipeline: smoothing.compiledFilterPipeline,
    expandConfig: expand.config,
    compiledExpand: expand.compiled,
    registry: registryRef.current,
  });

  const [background, setBackground] = useState<BackgroundSettings>({
    color: restoredSettings?.background.color ?? DEFAULT_BACKGROUND_COLOR,
    visible: restoredSettings?.background.visible ?? true,
  });

  const [showTouchDebug, setShowTouchDebug] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  useEffect(() => {
    if (!restoredSettings) {
      setSettingsHydrated(true);
      return;
    }

    const restoredTransform = createViewTransform();
    for (let i = 0; i < 9; i++) {
      restoredTransform[i] = restoredSettings.transform[i];
    }
    handleSetTransform(restoredTransform);

    const root = restoredSettings.expand.levels[0];
    if (root) {
      expand.setMode(root.mode);
      expand.setDivisions(root.divisions);
      expand.setAngle(root.angle);
    }

    const sub = restoredSettings.expand.levels[1];
    if (sub) {
      expand.setSubEnabled(true);
      expand.setSubMode(sub.mode);
      expand.setSubDivisions(sub.divisions);
      expand.setSubAngle(sub.angle);
      expand.setSubOffset(sub.offset);
    } else {
      expand.setSubEnabled(false);
    }

    setTool(restoredSettings.tool);
    setSettingsHydrated(true);
  }, [
    restoredSettings,
    handleSetTransform,
    expand.setMode,
    expand.setDivisions,
    expand.setAngle,
    expand.setSubEnabled,
    expand.setSubMode,
    expand.setSubDivisions,
    expand.setSubAngle,
    expand.setSubOffset,
  ]);

  const handleToolChange = useCallback((newTool: ToolType) => {
    setTool(newTool);
  }, []);

  const handleToggleBackground = useCallback(() => {
    setBackground((prev) => ({ ...prev, visible: !prev.visible }));
  }, []);
  const handleToggleTouchDebug = useCallback(() => {
    setShowTouchDebug((prev) => !prev);
  }, []);

  useEffect(() => {
    penSettings.setEraser(tool === "eraser");
  }, [tool, penSettings.setEraser]);

  useEffect(() => {
    if (!settingsHydrated) return;
    const timerId = window.setTimeout(() => {
      const snapshot = exportPaintSettings({
        tool,
        transform,
        background,
        pen: {
          color: penSettings.color,
          lineWidth: penSettings.lineWidth,
          pressureSensitivity: penSettings.pressureSensitivity,
          pressureCurve: penSettings.pressureCurve,
          eraser: penSettings.eraser,
          brush: penSettings.brush,
        },
        smoothing: {
          enabled: smoothing.enabled,
          windowSize: smoothing.windowSize,
        },
        expand: expand.config,
      });
      saveSettingsSnapshot(snapshot);
    }, 300);
    return () => window.clearTimeout(timerId);
  }, [
    settingsHydrated,
    tool,
    transform,
    background,
    penSettings.color,
    penSettings.lineWidth,
    penSettings.pressureSensitivity,
    penSettings.pressureCurve,
    penSettings.eraser,
    penSettings.brush,
    smoothing.enabled,
    smoothing.windowSize,
    expand.config,
  ]);

  // タッチジェスチャー
  const touchGesture = useTouchGesture({
    transform,
    onStrokeStart: engine.canDraw ? engine.onStrokeStart : undefined,
    onStrokeMove: engine.canDraw ? engine.onStrokeMove : undefined,
    onStrokeEnd: engine.canDraw ? engine.onStrokeEnd : undefined,
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
      engine.onStrokeStart(point, { straightLine: shiftHeld.current });
    },
    [engine.onStrokeStart, shiftHeld],
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
        tool={tool}
        onPan={handlePan}
        onZoom={handleZoom}
        onRotate={handleRotate}
        onStrokeStart={engine.canDraw ? handleStrokeStart : undefined}
        onStrokeMove={engine.canDraw ? engine.onStrokeMove : undefined}
        onStrokeEnd={engine.canDraw ? engine.onStrokeEnd : undefined}
        onTouchPointerEvent={touchGesture.handlePointerEvent}
        onWrapShift={engine.onWrapShift}
        onWrapShiftEnd={engine.onWrapShiftEnd}
        wrapOffset={engine.cumulativeOffset}
        width={viewWidth}
        height={viewHeight}
        layerWidth={LAYER_WIDTH}
        layerHeight={LAYER_HEIGHT}
        renderVersion={engine.renderVersion}
      />

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
          onUndo={engine.undo}
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
        onUndo={engine.undo}
        onRedo={engine.redo}
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
        brush={penSettings.brush}
        onBrushChange={penSettings.setBrush}
        registry={registryRef.current}
        registryReady={registryReady}
        entries={engine.entries}
        activeLayerId={engine.activeLayerId}
        background={background}
        onSelectLayer={engine.setActiveLayerId}
        onAddLayer={engine.addLayer}
        onRemoveLayer={engine.removeLayer}
        onToggleVisibility={engine.toggleVisibility}
        onToggleBackground={handleToggleBackground}
        onMoveUp={engine.moveLayerUp}
        onMoveDown={engine.moveLayerDown}
        onSetOpacity={engine.setLayerOpacity}
        onSetBlendMode={engine.setLayerBlendMode}
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
      />
    </div>
  );
}
