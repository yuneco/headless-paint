import { DEFAULT_BACKGROUND_COLOR } from "@headless-paint/engine";
import type { BackgroundSettings } from "@headless-paint/engine";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PEN_CONFIG, DEFAULT_SMOOTHING_CONFIG } from "./config";
import { DebugPanel } from "./components/DebugPanel";
import { PaintCanvas } from "./components/PaintCanvas";
import { SidebarPanel } from "./components/SidebarPanel";
import { SymmetryOverlay } from "./components/SymmetryOverlay";
import { Toolbar } from "./components/Toolbar";
import { TouchDebugOverlay } from "./components/TouchDebugOverlay";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePatternPreview } from "./hooks/usePatternPreview";

const LAYER_WIDTH = 1024;
const LAYER_HEIGHT = 1024;

export function App() {
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
      fitToView();
      initialFitDone.current = true;
    }
  }, [fitToView]);

  // 設定系 hooks
  const penSettings = usePenSettings(DEFAULT_PEN_CONFIG);
  const smoothing = useSmoothing(DEFAULT_SMOOTHING_CONFIG);
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
  });

  const [background, setBackground] = useState<BackgroundSettings>({
    color: DEFAULT_BACKGROUND_COLOR,
    visible: true,
  });

  const [showTouchDebug, setShowTouchDebug] = useState(false);

  const handleToolChange = useCallback(
    (newTool: ToolType) => {
      setTool(newTool);
      penSettings.setEraser(newTool === "eraser");
    },
    [penSettings.setEraser],
  );

  const handleToggleBackground = useCallback(() => {
    setBackground((prev) => ({ ...prev, visible: !prev.visible }));
  }, []);

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
  useKeyboardShortcuts({
    tool,
    setTool: handleToolChange,
    isDrawing: engine.strokePoints.length > 0,
    onUndo: engine.undo,
    onRedo: engine.redo,
    expandMode: expand.config.levels[0].mode,
    setExpandMode: expand.setMode,
    expandDivisions: expand.config.levels[0].divisions,
    setExpandDivisions: expand.setDivisions,
    lineWidth: penSettings.lineWidth,
    setLineWidth: penSettings.setLineWidth,
  });

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

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <PaintCanvas
        layers={engine.layers}
        transform={transform}
        background={background}
        patternPreview={patternPreview.config}
        tool={tool}
        onPan={handlePan}
        onZoom={handleZoom}
        onRotate={handleRotate}
        onStrokeStart={engine.canDraw ? engine.onStrokeStart : undefined}
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
        />
      </div>

      <SidebarPanel
        layers={engine.layers}
        viewTransform={transform}
        mainCanvasWidth={viewWidth}
        mainCanvasHeight={viewHeight}
        renderVersion={engine.renderVersion}
        historyState={engine.historyState}
        onUndo={engine.undo}
        onRedo={engine.redo}
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
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
        onToggleTouchDebug={() => setShowTouchDebug((prev) => !prev)}
      />
    </div>
  );
}
