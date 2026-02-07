import type { ExpandMode, PatternMode } from "@headless-paint/engine";
import { type ViewTransform, decomposeTransform } from "@headless-paint/input";
import type { GUI } from "lil-gui";
import { useEffect, useRef } from "react";
import type { UseExpandResult } from "../hooks/useExpand";
import type { UsePatternPreviewResult } from "../hooks/usePatternPreview";
import type { UsePenSettingsResult } from "../hooks/usePenSettings";
import type { UseSmoothingResult } from "../hooks/useSmoothing";
import { BezierCurveEditor } from "./BezierCurveEditor";

interface DebugPanelProps {
  transform: ViewTransform;
  strokeCount: number;
  expand: UseExpandResult;
  smoothing: UseSmoothingResult;
  penSettings: UsePenSettingsResult;
  patternPreview: UsePatternPreviewResult;
  layerOffset?: { readonly x: number; readonly y: number };
  onResetOffset?: () => void;
}

const EXPAND_MODES: ExpandMode[] = ["none", "axial", "radial", "kaleidoscope"];
const PATTERN_MODES: PatternMode[] = ["none", "grid", "repeat-x", "repeat-y"];

export function DebugPanel({
  transform,
  strokeCount,
  expand,
  smoothing,
  penSettings,
  patternPreview,
  layerOffset = { x: 0, y: 0 },
  onResetOffset,
}: DebugPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const guiRef = useRef<GUI | null>(null);
  const dataRef = useRef({
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
    strokeCount: 0,
  });

  const expandDataRef = useRef({
    mode: expand.config.mode,
    divisions: expand.config.divisions,
    angleDeg: (expand.config.angle * 180) / Math.PI,
  });

  const smoothingDataRef = useRef({
    enabled: smoothing.enabled,
    windowSize: smoothing.windowSize,
  });

  const penDataRef = useRef({
    lineWidth: penSettings.lineWidth,
    pressureSensitivity: penSettings.pressureSensitivity,
  });

  const patternDataRef = useRef({
    mode: patternPreview.config.mode,
    opacity: patternPreview.config.opacity,
    offsetX: patternPreview.config.offsetX,
    offsetY: patternPreview.config.offsetY,
  });

  const layerOffsetDataRef = useRef({
    offsetX: layerOffset.x,
    offsetY: layerOffset.y,
  });

  const onResetOffsetRef = useRef(onResetOffset);
  onResetOffsetRef.current = onResetOffset;

  const expandRef = useRef(expand);
  expandRef.current = expand;

  const smoothingRef = useRef(smoothing);
  smoothingRef.current = smoothing;

  const penSettingsRef = useRef(penSettings);
  penSettingsRef.current = penSettings;

  const patternPreviewRef = useRef(patternPreview);
  patternPreviewRef.current = patternPreview;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 既にguiが存在する場合は何もしない（StrictMode対策）
    if (guiRef.current) return;

    let mounted = true;

    import("lil-gui").then(({ GUI: LilGUI }) => {
      if (!mounted) return;

      const gui = new LilGUI({ title: "Debug Info", width: 250, container });

      gui.add(dataRef.current, "scaleX").name("Scale X").listen().disable();
      gui.add(dataRef.current, "scaleY").name("Scale Y").listen().disable();
      gui
        .add(dataRef.current, "rotation")
        .name("Rotation (deg)")
        .listen()
        .disable();
      gui
        .add(dataRef.current, "translateX")
        .name("Translate X")
        .listen()
        .disable();
      gui
        .add(dataRef.current, "translateY")
        .name("Translate Y")
        .listen()
        .disable();
      gui
        .add(dataRef.current, "strokeCount")
        .name("Strokes")
        .listen()
        .disable();

      const expandFolder = gui.addFolder("Symmetry");

      expandFolder
        .add(expandDataRef.current, "mode", EXPAND_MODES)
        .name("Mode")
        .listen()
        .onChange((value: ExpandMode) => {
          expandRef.current.setMode(value);
        });

      expandFolder
        .add(expandDataRef.current, "divisions", 2, 12, 1)
        .name("Divisions")
        .listen()
        .onChange((value: number) => {
          expandRef.current.setDivisions(value);
        });

      expandFolder
        .add(expandDataRef.current, "angleDeg", 0, 360, 1)
        .name("Angle (deg)")
        .listen()
        .onChange((value: number) => {
          expandRef.current.setAngle((value * Math.PI) / 180);
        });

      expandFolder.open();

      const smoothingFolder = gui.addFolder("Smoothing");

      smoothingFolder
        .add(smoothingDataRef.current, "enabled")
        .name("Enable")
        .listen()
        .onChange((value: boolean) => {
          smoothingRef.current.setEnabled(value);
        });

      smoothingFolder
        .add(smoothingDataRef.current, "windowSize", 3, 13, 2)
        .name("Window Size")
        .listen()
        .onChange((value: number) => {
          smoothingRef.current.setWindowSize(value);
        });

      smoothingFolder.open();

      const penFolder = gui.addFolder("Pen Settings");

      penFolder
        .add(penDataRef.current, "lineWidth", 1, 50, 1)
        .name("Line Width")
        .listen()
        .onChange((value: number) => {
          penSettingsRef.current.setLineWidth(value);
        });

      penFolder
        .add(penDataRef.current, "pressureSensitivity", 0, 1, 0.05)
        .name("Pressure")
        .listen()
        .onChange((value: number) => {
          penSettingsRef.current.setPressureSensitivity(value);
        });

      penFolder.open();

      const patternFolder = gui.addFolder("Pattern Preview");

      patternFolder
        .add(patternDataRef.current, "mode", PATTERN_MODES)
        .name("Mode")
        .listen()
        .onChange((value: PatternMode) => {
          patternPreviewRef.current.setMode(value);
        });

      patternFolder
        .add(patternDataRef.current, "opacity", 0, 1, 0.05)
        .name("Opacity")
        .listen()
        .onChange((value: number) => {
          patternPreviewRef.current.setOpacity(value);
        });

      patternFolder
        .add(patternDataRef.current, "offsetX", 0, 1, 0.05)
        .name("Offset X")
        .listen()
        .onChange((value: number) => {
          patternPreviewRef.current.setOffsetX(value);
        });

      patternFolder
        .add(patternDataRef.current, "offsetY", 0, 1, 0.05)
        .name("Offset Y")
        .listen()
        .onChange((value: number) => {
          patternPreviewRef.current.setOffsetY(value);
        });

      patternFolder.open();

      const layerOffsetFolder = gui.addFolder("Layer Offset");

      layerOffsetFolder
        .add(layerOffsetDataRef.current, "offsetX")
        .name("Offset X")
        .listen()
        .disable();

      layerOffsetFolder
        .add(layerOffsetDataRef.current, "offsetY")
        .name("Offset Y")
        .listen()
        .disable();

      layerOffsetFolder
        .add({ reset: () => onResetOffsetRef.current?.() }, "reset")
        .name("Reset Offset");

      layerOffsetFolder.open();

      guiRef.current = gui;
    });

    return () => {
      mounted = false;
      guiRef.current?.destroy();
      guiRef.current = null;
    };
  }, []);

  // Update values
  useEffect(() => {
    const components = decomposeTransform(transform);
    const rotationDeg = components.rotation * (180 / Math.PI);

    dataRef.current.scaleX = Number(components.scaleX.toFixed(3));
    dataRef.current.scaleY = Number(components.scaleY.toFixed(3));
    dataRef.current.rotation = Number(rotationDeg.toFixed(1));
    dataRef.current.translateX = Number(components.translateX.toFixed(1));
    dataRef.current.translateY = Number(components.translateY.toFixed(1));
    dataRef.current.strokeCount = strokeCount;
  }, [transform, strokeCount]);

  // Sync hook state → lil-gui data
  useEffect(() => {
    expandDataRef.current.mode = expand.config.mode;
    expandDataRef.current.divisions = expand.config.divisions;
    expandDataRef.current.angleDeg = (expand.config.angle * 180) / Math.PI;
  }, [expand.config]);

  useEffect(() => {
    smoothingDataRef.current.enabled = smoothing.enabled;
    smoothingDataRef.current.windowSize = smoothing.windowSize;
  }, [smoothing.enabled, smoothing.windowSize]);

  useEffect(() => {
    penDataRef.current.lineWidth = penSettings.lineWidth;
    penDataRef.current.pressureSensitivity = penSettings.pressureSensitivity;
  }, [penSettings.lineWidth, penSettings.pressureSensitivity]);

  useEffect(() => {
    patternDataRef.current.mode = patternPreview.config.mode;
    patternDataRef.current.opacity = patternPreview.config.opacity;
    patternDataRef.current.offsetX = patternPreview.config.offsetX;
    patternDataRef.current.offsetY = patternPreview.config.offsetY;
  }, [patternPreview.config]);

  useEffect(() => {
    layerOffsetDataRef.current.offsetX = layerOffset.x;
    layerOffsetDataRef.current.offsetY = layerOffset.y;
  }, [layerOffset.x, layerOffset.y]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        zIndex: 100,
      }}
    >
      <div ref={containerRef} />
      <div
        style={{
          backgroundColor: "#1a1a1a",
          padding: "6px 8px 8px",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#ebebeb",
            marginBottom: 4,
          }}
        >
          Pressure Curve
        </div>
        <BezierCurveEditor
          value={penSettings.pressureCurve}
          onChange={penSettings.setPressureCurve}
        />
      </div>
    </div>
  );
}
