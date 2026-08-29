import {
  DEFAULT_BACKGROUND_COLOR,
  createBrushTipRegistry,
} from "@headless-paint/engine";
import type { BackgroundSettings } from "@headless-paint/engine";
import {
  compileFilterPipeline,
  createViewTransform,
} from "@headless-paint/input";
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
import {
  BRISTLE_S_CURVE_FIXTURE_HEIGHT,
  BRISTLE_S_CURVE_FIXTURE_WIDTH,
  createBristleSCurveEvaluationPoints,
} from "./brush-evaluation-fixtures";
import { APP_BRUSH_PRESETS, registerAppBrushTips } from "./brush-presets";
import { DebugPanel } from "./components/DebugPanel";
import { PaintCanvas } from "./components/PaintCanvas";
import { SidebarPanel } from "./components/SidebarPanel";
import { SymmetryOverlay } from "./components/SymmetryOverlay";
import { Toolbar } from "./components/Toolbar";
import { TouchDebugOverlay } from "./components/TouchDebugOverlay";
import { TransformOverlay } from "./components/TransformOverlay";
import { DEFAULT_PEN_CONFIG, DEFAULT_SMOOTHING_CONFIG } from "./config";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePatternPreview } from "./hooks/usePatternPreview";
import { useStrokeCallMetrics } from "./hooks/useStrokeCallMetrics";
import { useTransformMode } from "./hooks/useTransformMode";

const EXPERIMENT_LAYER_SIZE = Number(
  new URLSearchParams(window.location.search).get("layerSize") ?? "0",
);
const LAYER_WIDTH =
  EXPERIMENT_LAYER_SIZE > 0 ? EXPERIMENT_LAYER_SIZE : 1024 * 2;
const LAYER_HEIGHT = LAYER_WIDTH;
const SETTINGS_STORAGE_KEY = "headless-paint:settings";

type InputCaptureStatus = "idle" | "armed" | "capturing" | "captured";

interface UndoTimingEntry {
  readonly sequence: number;
  readonly durationMs: number;
  readonly drainMs: number;
}

interface UndoTimingDebug {
  readonly entries: UndoTimingEntry[];
  reset(): void;
  snapshot(): readonly UndoTimingEntry[];
}

interface HpDebugUi {
  setColor(hex: string): void;
  setLineWidth(px: number): void;
  selectBrush(label: string): void;
  setSymmetry?(mode: string, divisions: number): void;
}

declare global {
  var __hpUndoTiming: UndoTimingDebug | undefined;
  var __hpDebugUi: HpDebugUi | undefined;
}

function configureBrushPerfDebugFromUrl(): void {
  const perf = globalThis.__hpBrushPerf;
  if (!perf) return;
  const params = new URLSearchParams(window.location.search);
  perf.enabled = params.get("perfDebug") === "1";
  perf.experiments.spacingScale =
    Number(params.get("spacingScale") ?? "1") || 1;
  perf.experiments.checkpointScale =
    Number(params.get("checkpointScale") ?? "1") || 1;
  const checkpointLagSteps = Number(params.get("checkpointLag") ?? "1");
  perf.experiments.checkpointLagSteps =
    Number.isSafeInteger(checkpointLagSteps) && checkpointLagSteps >= 1
      ? checkpointLagSteps
      : 1;
  perf.experiments.updateScale = Number(params.get("updateScale") ?? "1") || 1;
  perf.experiments.bitmapDab = params.get("bitmapDab") === "1";
  perf.experiments.gpuDab =
    params.get("gpuDab") === "webgl2" ? "webgl2" : "off";
  perf.experiments.gpuReadback =
    params.get("gpuReadback") === "sync" ? "sync" : "gpu-field";
  perf.experiments.gpuResident = params.get("gpuResident") !== "0";
  const stallThresholdMs = Number(params.get("stallThresholdMs") ?? "60");
  perf.experiments.stallThresholdMs =
    Number.isFinite(stallThresholdMs) && stallThresholdMs >= 0
      ? stallThresholdMs
      : 60;
  for (const name of Object.keys(perf.nullStages) as Array<
    keyof typeof perf.nullStages
  >) {
    perf.nullStages[name] = false;
  }
  for (const name of (params.get("nullStages") ?? "").split(",")) {
    switch (name.trim().toLowerCase()) {
      case "field":
        perf.nullStages.nullField = true;
        break;
      case "contact":
        perf.nullStages.nullContact = true;
        break;
      case "raster":
        perf.nullStages.nullRaster = true;
        break;
      case "drawsweep":
      case "draw-sweep":
        perf.nullStages.nullDrawSweep = true;
        break;
      case "fullcopy":
      case "full-copy":
        perf.nullStages.nullFullCopy = true;
        break;
      case "checkpoint":
        perf.nullStages.nullCheckpoint = true;
        break;
      case "fieldadvance":
      case "field-advance":
        perf.nullStages.nullFieldAdvance = true;
        break;
      case "upload":
      case "material-upload":
        perf.nullStages.nullMaterialUpload = true;
        break;
      case "render":
        perf.nullStages.nullRender = true;
        break;
      case "dabdraw":
      case "dab-draw":
        perf.nullStages.nullDabDraw = true;
        break;
      case "rotate":
        perf.nullStages.nullRotate = true;
        break;
    }
  }
  perf.reset();
}

function ensureUndoTimingDebug(): UndoTimingDebug {
  if (globalThis.__hpUndoTiming) return globalThis.__hpUndoTiming;
  const entries: UndoTimingEntry[] = [];
  globalThis.__hpUndoTiming = {
    entries,
    reset() {
      entries.length = 0;
    },
    snapshot() {
      return entries.map((entry) => ({ ...entry }));
    },
  };
  return globalThis.__hpUndoTiming;
}

configureBrushPerfDebugFromUrl();
ensureUndoTimingDebug();

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
    initialPressureCurve:
      restoredSettings?.pen.pressureCurve ??
      DEFAULT_PEN_CONFIG.initialPressureCurve,
    initialBrush:
      restoredSettings?.pen.brush ?? DEFAULT_PEN_CONFIG.initialBrush,
  });
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("perfDebug") !== "1") {
      return;
    }
    const debugUi: HpDebugUi = {
      setColor(hex) {
        if (!/^#[0-9a-f]{6}$/i.test(hex)) {
          throw new Error(`Invalid debug color: ${hex}`);
        }
        penSettings.setColor({
          r: Number.parseInt(hex.slice(1, 3), 16),
          g: Number.parseInt(hex.slice(3, 5), 16),
          b: Number.parseInt(hex.slice(5, 7), 16),
          a: 255,
        });
      },
      setLineWidth(px) {
        if (!Number.isFinite(px) || px <= 0) {
          throw new Error(`Invalid debug line width: ${px}`);
        }
        penSettings.setLineWidth(px);
      },
      selectBrush(label) {
        const preset = APP_BRUSH_PRESETS.find(
          (candidate) => candidate.label === label,
        );
        if (!preset) throw new Error(`Unknown debug brush: ${label}`);
        penSettings.setBrush(preset.config);
      },
    };
    globalThis.__hpDebugUi = debugUi;
    return () => {
      if (globalThis.__hpDebugUi === debugUi) {
        globalThis.__hpDebugUi = undefined;
      }
    };
  }, [penSettings.setBrush, penSettings.setColor, penSettings.setLineWidth]);
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
  useEffect(() => {
    const ui = globalThis.__hpDebugUi;
    if (!ui) return;
    ui.setSymmetry = (mode, divisions) => {
      expand.setMode(mode as Parameters<typeof expand.setMode>[0]);
      expand.setDivisions(divisions);
    };
  }, [expand.setMode, expand.setDivisions]);
  const patternPreview = usePatternPreview();

  // メインエンジン
  const engine = usePaintEngine({
    layerWidth: LAYER_WIDTH,
    layerHeight: LAYER_HEIGHT,
    strokeStyle: penSettings.strokeStyle,
    compiledFilterPipeline: effectiveFilterPipeline,
    expandConfig: expand.config,
    compiledExpand: expand.compiled,
    registry: registryRef.current,
  });
  const inputCaptureArmedRef = useRef(false);
  const inputCaptureActiveRef = useRef(false);
  const inputCapturePointsRef = useRef<InputPoint[]>([]);
  const inputCaptureBatchSizesRef = useRef<number[]>([]);
  const inputCaptureSettingsRef = useRef<{
    readonly brush: typeof penSettings.brush;
    readonly lineWidth: number;
    readonly pressureCurve: typeof penSettings.pressureCurve;
    readonly filterPipeline:
      | { readonly type: "causal-adaptive" }
      | {
          readonly type: "common-smoothing" | "none";
          readonly windowSize: number;
        };
  } | null>(null);
  const [inputCaptureStatus, setInputCaptureStatus] =
    useState<InputCaptureStatus>("idle");
  const [inputCaptureJson, setInputCaptureJson] = useState<string | null>(null);

  const handleArmInputCapture = useCallback(() => {
    inputCaptureArmedRef.current = true;
    inputCaptureActiveRef.current = false;
    inputCapturePointsRef.current = [];
    inputCaptureBatchSizesRef.current = [];
    inputCaptureSettingsRef.current = null;
    setInputCaptureJson(null);
    setInputCaptureStatus("armed");
  }, []);

  const appendCapturedInput = useCallback((points: readonly InputPoint[]) => {
    if (!inputCaptureActiveRef.current) return;
    inputCapturePointsRef.current.push(...points);
    inputCaptureBatchSizesRef.current.push(points.length);
  }, []);

  const finalizeInputCapture = useCallback(() => {
    if (!inputCaptureActiveRef.current) return;
    inputCaptureActiveRef.current = false;
    const json = JSON.stringify({
      format: "headless-paint-production-input",
      version: 1,
      settings: inputCaptureSettingsRef.current,
      batchSizes: inputCaptureBatchSizesRef.current,
      points: inputCapturePointsRef.current,
    });
    setInputCaptureJson(json);
    setInputCaptureStatus("captured");
    console.log(`[ProductionInputCapture] ${json}`);
  }, []);

  const handleCopyInputCapture = useCallback(async () => {
    if (!inputCaptureJson) return;
    await navigator.clipboard.writeText(inputCaptureJson);
  }, [inputCaptureJson]);
  const {
    metrics: strokeCallMetrics,
    measure: measureStrokeCall,
    flush: flushStrokeCallMetrics,
    reset: resetStrokeCallMetrics,
  } = useStrokeCallMetrics();
  const handleMeasuredStrokeMove = useCallback(
    (point: InputPoint) => {
      appendCapturedInput([point]);
      measureStrokeCall(() => engine.onStrokeMove(point));
    },
    [appendCapturedInput, engine.onStrokeMove, measureStrokeCall],
  );
  const handleMeasuredStrokeMoves = useCallback(
    (points: readonly InputPoint[]) => {
      appendCapturedInput(points);
      measureStrokeCall(() => engine.onStrokeMoves(points));
    },
    [appendCapturedInput, engine.onStrokeMoves, measureStrokeCall],
  );
  const handleMeasuredTouchStrokeStart = useCallback(
    (point: InputPoint) => {
      measureStrokeCall(() => engine.onStrokeStart(point));
    },
    [engine.onStrokeStart, measureStrokeCall],
  );
  const handleMeasuredStrokeEnd = useCallback(() => {
    measureStrokeCall(engine.onStrokeEnd);
    flushStrokeCallMetrics();
    finalizeInputCapture();
  }, [
    engine.onStrokeEnd,
    finalizeInputCapture,
    flushStrokeCallMetrics,
    measureStrokeCall,
  ]);

  const handleDrawBristleSCurve = useCallback(() => {
    if (
      penSettings.brush.type !== "bristle" ||
      !engine.canDraw ||
      engine.isDrawing
    ) {
      return;
    }

    const points = createBristleSCurveEvaluationPoints(
      (LAYER_WIDTH - BRISTLE_S_CURVE_FIXTURE_WIDTH) / 2,
      (LAYER_HEIGHT - BRISTLE_S_CURVE_FIXTURE_HEIGHT) / 2,
    );
    const firstPoint = points[0];
    if (!firstPoint) return;

    resetStrokeCallMetrics();
    measureStrokeCall(() => engine.onStrokeStart(firstPoint, { brushSeed: 1 }));
    for (let index = 1; index < points.length; index += 4) {
      handleMeasuredStrokeMoves(points.slice(index, index + 4));
    }
    handleMeasuredStrokeEnd();
  }, [
    engine.canDraw,
    engine.isDrawing,
    engine.onStrokeStart,
    handleMeasuredStrokeEnd,
    handleMeasuredStrokeMoves,
    penSettings.brush.type,
    measureStrokeCall,
    resetStrokeCallMetrics,
  ]);

  const [background, setBackground] = useState<BackgroundSettings>({
    color: restoredSettings?.background.color ?? DEFAULT_BACKGROUND_COLOR,
    visible: restoredSettings?.background.visible ?? true,
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
      if (inputCaptureArmedRef.current) {
        inputCaptureArmedRef.current = false;
        inputCaptureActiveRef.current = true;
        inputCapturePointsRef.current = [point];
        inputCaptureBatchSizesRef.current = [1];
        inputCaptureSettingsRef.current = {
          brush: penSettings.brush,
          lineWidth: penSettings.lineWidth,
          pressureCurve: penSettings.pressureCurve,
          filterPipeline: usesStatefulMaterial
            ? { type: "causal-adaptive" }
            : {
                type: smoothing.enabled ? "common-smoothing" : "none",
                windowSize: smoothing.windowSize,
              },
        };
        setInputCaptureStatus("capturing");
      }
      measureStrokeCall(() =>
        engine.onStrokeStart(point, { straightLine: shiftHeld.current }),
      );
    },
    [
      engine.onStrokeStart,
      measureStrokeCall,
      penSettings.brush,
      penSettings.lineWidth,
      penSettings.pressureCurve,
      shiftHeld,
      smoothing.enabled,
      smoothing.windowSize,
      usesStatefulMaterial,
    ],
  );

  const strokeCount = engine.historyState.currentIndex + 1;
  const handleTimedUndo = useCallback(() => {
    const timing = ensureUndoTimingDebug();
    const sequence = timing.entries.length;
    const startMark = `hp-undo-${sequence}-start`;
    const endMark = `hp-undo-${sequence}-end`;
    const measureName = `hp-undo-${sequence}`;
    performance.mark(startMark);
    engine.undo();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const drainStartedAt = performance.now();
        const canvas = document.querySelector<HTMLCanvasElement>(
          "canvas[data-headless-paint-main]",
        );
        canvas?.getContext("2d")?.getImageData(0, 0, 1, 1);
        const drainMs = performance.now() - drainStartedAt;
        performance.mark(endMark);
        const measure = performance.measure(measureName, startMark, endMark);
        timing.entries.push({
          sequence,
          durationMs: measure.duration,
          drainMs,
        });
        performance.clearMarks(startMark);
        performance.clearMarks(endMark);
        performance.clearMeasures(measureName);
      }),
    );
  }, [engine.undo]);

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
        inputCapturePointCount={inputCapturePointsRef.current.length}
        onArmInputCapture={handleArmInputCapture}
        onCopyInputCapture={
          inputCaptureJson ? handleCopyInputCapture : undefined
        }
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
      />
    </div>
  );
}
