import type { ExpandMode } from "@headless-paint/engine";
import { type ViewTransform, decomposeTransform } from "@headless-paint/input";
import type { GUI } from "lil-gui";
import { useEffect, useRef } from "react";
import type { UseExpandResult } from "../hooks/useExpand";
import type { UsePenSettingsResult } from "../hooks/usePenSettings";
import type { UseSmoothingResult } from "../hooks/useSmoothing";
import { BezierCurveEditor } from "./BezierCurveEditor";

interface DebugPanelProps {
  transform: ViewTransform;
  strokeCount: number;
  expand: UseExpandResult;
  smoothing: UseSmoothingResult;
  penSettings: UsePenSettingsResult;
}

const EXPAND_MODES: ExpandMode[] = ["none", "axial", "radial", "kaleidoscope"];

export function DebugPanel({
  transform,
  strokeCount,
  expand,
  smoothing,
  penSettings,
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
    mode: "none" as ExpandMode,
    divisions: 6,
    angleDeg: 0,
  });

  const smoothingDataRef = useRef({
    enabled: false,
    windowSize: 5,
  });

  const penDataRef = useRef({
    lineWidth: 3,
    pressureSensitivity: 0,
  });

  const expandRef = useRef(expand);
  expandRef.current = expand;

  const smoothingRef = useRef(smoothing);
  smoothingRef.current = smoothing;

  const penSettingsRef = useRef(penSettings);
  penSettingsRef.current = penSettings;

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
        .onChange((value: ExpandMode) => {
          expandRef.current.setMode(value);
        });

      expandFolder
        .add(expandDataRef.current, "divisions", 2, 12, 1)
        .name("Divisions")
        .onChange((value: number) => {
          expandRef.current.setDivisions(value);
        });

      expandFolder
        .add(expandDataRef.current, "angleDeg", 0, 360, 1)
        .name("Angle (deg)")
        .onChange((value: number) => {
          expandRef.current.setAngle((value * Math.PI) / 180);
        });

      expandFolder.open();

      const smoothingFolder = gui.addFolder("Smoothing");

      smoothingFolder
        .add(smoothingDataRef.current, "enabled")
        .name("Enable")
        .onChange((value: boolean) => {
          smoothingRef.current.setEnabled(value);
        });

      smoothingFolder
        .add(smoothingDataRef.current, "windowSize", 3, 13, 2)
        .name("Window Size")
        .onChange((value: number) => {
          smoothingRef.current.setWindowSize(value);
        });

      smoothingFolder.open();

      const penFolder = gui.addFolder("Pen Settings");

      penFolder
        .add(penDataRef.current, "lineWidth", 1, 50, 1)
        .name("Line Width")
        .onChange((value: number) => {
          penSettingsRef.current.setLineWidth(value);
        });

      penFolder
        .add(penDataRef.current, "pressureSensitivity", 0, 1, 0.05)
        .name("Pressure")
        .onChange((value: number) => {
          penSettingsRef.current.setPressureSensitivity(value);
        });

      penFolder.open();

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
