import {
  type BrushConfig,
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_PRESSURE_DYNAMICS,
  DEFAULT_SPRAY_DYNAMICS,
  DEFAULT_SPRAY_PRESSURE_DYNAMICS,
  type ExpandMode,
  type PatternMode,
  type Point,
  type SprayBrushConfig,
  type StampBrushConfig,
} from "@headless-paint/engine";
import { type ViewTransform, decomposeTransform } from "@headless-paint/input";
import type {
  UseExpandResult,
  UsePenSettingsResult,
  UseSmoothingResult,
} from "@headless-paint/react";
import type { Controller, GUI } from "lil-gui";
import { memo, useEffect, useRef } from "react";
import type { UsePatternPreviewResult } from "../hooks/usePatternPreview";
import { BezierCurveEditor } from "./BezierCurveEditor";
import { DensityProfileCurveEditor } from "./DensityProfileCurveEditor";

interface DebugPanelProps {
  transform: ViewTransform;
  strokeCount: number;
  expand: UseExpandResult;
  smoothing: UseSmoothingResult;
  penSettings: UsePenSettingsResult;
  patternPreview: UsePatternPreviewResult;
  layerOffset?: { readonly x: number; readonly y: number };
  onResetOffset?: () => void;
  showTouchDebug?: boolean;
  onToggleTouchDebug?: () => void;
  gpuBackendSetting: "auto" | "webgl2" | "cpu";
  gpuBackend: "webgl2" | "cpu";
  gpuBackendReason: string;
  gpuCommitMode: "bitmap" | "direct";
  onGpuBackendChange: (backend: "auto" | "webgl2" | "cpu") => void;
}

const EXPAND_MODES: ExpandMode[] = ["none", "axial", "radial", "kaleidoscope"];
const PATTERN_MODES: PatternMode[] = ["none", "grid", "repeat-x", "repeat-y"];
const SIZE_JITTER_MODES = ["lognormal", "bimodal"] as const;

function getPrimaryPressureResponse(brush: BrushConfig): number {
  return brush.type === "bristle"
    ? brush.pressureDynamics.coverage
    : brush.pressureDynamics.size;
}

function supportsCommonSmoothing(brush: BrushConfig): boolean {
  return !(
    brush.type === "bristle" ||
    (brush.type === "stamp" && brush.mixing?.enabled)
  );
}

function DebugPanelComponent({
  transform,
  strokeCount,
  expand,
  smoothing,
  penSettings,
  patternPreview,
  layerOffset = { x: 0, y: 0 },
  onResetOffset,
  showTouchDebug = false,
  onToggleTouchDebug,
  gpuBackendSetting,
  gpuBackend,
  gpuBackendReason,
  gpuCommitMode,
  onGpuBackendChange,
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
    mode: expand.config.levels[0].mode,
    divisions: expand.config.levels[0].divisions,
    angleDeg: (expand.config.levels[0].angle * 180) / Math.PI,
  });

  const subExpandDataRef = useRef({
    enabled: expand.subEnabled,
    mode: expand.config.levels[1]?.mode ?? "radial",
    divisions: expand.config.levels[1]?.divisions ?? 4,
    angleDeg: ((expand.config.levels[1]?.angle ?? 0) * 180) / Math.PI,
    offsetX: expand.config.levels[1]?.offset.x ?? 0,
    offsetY: expand.config.levels[1]?.offset.y ?? -80,
  });

  const smoothingDataRef = useRef({
    enabled: smoothing.enabled,
    windowSize: smoothing.windowSize,
  });
  const smoothingControllerRefs = useRef<readonly Controller[]>([]);

  const penDataRef = useRef({
    lineWidth: penSettings.lineWidth,
    pressureResponse: getPrimaryPressureResponse(penSettings.brush),
  });

  const brushDynamics =
    penSettings.brush.type === "stamp"
      ? penSettings.brush.dynamics
      : DEFAULT_BRUSH_DYNAMICS;
  const brushDynamicsDataRef = useRef({
    spacing: brushDynamics.spacing,
    flow: brushDynamics.flow,
    opacityJitter: brushDynamics.opacityJitter,
    sizeJitter: brushDynamics.sizeJitter,
    rotationJitter: brushDynamics.rotationJitter,
    scatter: brushDynamics.scatter,
    flowPressure:
      penSettings.brush.type === "stamp"
        ? penSettings.brush.pressureDynamics.flow
        : DEFAULT_PRESSURE_DYNAMICS.flow,
  });

  const sprayDynamics =
    penSettings.brush.type === "spray"
      ? penSettings.brush.dynamics
      : DEFAULT_SPRAY_DYNAMICS;
  const sprayDynamicsDataRef = useRef({
    spacing: sprayDynamics.spacing,
    density: sprayDynamics.density,
    particleSize: sprayDynamics.particleSize,
    particleSizeJitter: sprayDynamics.particleSizeJitter,
    sizeJitterMode: sprayDynamics.sizeJitterMode,
    opacityJitter: sprayDynamics.opacityJitter,
    flow: sprayDynamics.flow,
    flowPressure:
      penSettings.brush.type === "spray"
        ? penSettings.brush.pressureDynamics.flow
        : DEFAULT_SPRAY_PRESSURE_DYNAMICS.flow,
    densityPressure:
      penSettings.brush.type === "spray"
        ? penSettings.brush.pressureDynamics.density
        : DEFAULT_SPRAY_PRESSURE_DYNAMICS.density,
  });

  const stampDynamicsFolderRef = useRef<ReturnType<GUI["addFolder"]> | null>(
    null,
  );
  const sprayDynamicsFolderRef = useRef<ReturnType<GUI["addFolder"]> | null>(
    null,
  );

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

  const touchDebugDataRef = useRef({
    showTouchDebug: showTouchDebug,
  });

  const onResetOffsetRef = useRef(onResetOffset);
  onResetOffsetRef.current = onResetOffset;

  const onToggleTouchDebugRef = useRef(onToggleTouchDebug);
  onToggleTouchDebugRef.current = onToggleTouchDebug;

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

      const subExpandFolder = expandFolder.addFolder("Sub Symmetry");

      subExpandFolder
        .add(subExpandDataRef.current, "enabled")
        .name("Enabled")
        .listen()
        .onChange((value: boolean) => {
          expandRef.current.setSubEnabled(value);
        });

      subExpandFolder
        .add(subExpandDataRef.current, "mode", EXPAND_MODES)
        .name("Mode")
        .listen()
        .onChange((value: ExpandMode) => {
          expandRef.current.setSubMode(value);
        });

      subExpandFolder
        .add(subExpandDataRef.current, "divisions", 2, 12, 1)
        .name("Divisions")
        .listen()
        .onChange((value: number) => {
          expandRef.current.setSubDivisions(value);
        });

      subExpandFolder
        .add(subExpandDataRef.current, "angleDeg", 0, 360, 1)
        .name("Angle (deg)")
        .listen()
        .onChange((value: number) => {
          expandRef.current.setSubAngle((value * Math.PI) / 180);
        });

      subExpandFolder
        .add(subExpandDataRef.current, "offsetX", -200, 200, 1)
        .name("Offset X")
        .listen()
        .onChange((value: number) => {
          const current = expandRef.current.config.levels[1]?.offset ?? {
            x: 0,
            y: -80,
          };
          expandRef.current.setSubOffset({ x: value, y: current.y } as Point);
        });

      subExpandFolder
        .add(subExpandDataRef.current, "offsetY", -200, 200, 1)
        .name("Offset Y")
        .listen()
        .onChange((value: number) => {
          const current = expandRef.current.config.levels[1]?.offset ?? {
            x: 0,
            y: -80,
          };
          expandRef.current.setSubOffset({ x: current.x, y: value } as Point);
        });

      subExpandFolder.open();

      expandFolder.open();

      const smoothingFolder = gui.addFolder("Smoothing");

      const smoothingEnabledController = smoothingFolder
        .add(smoothingDataRef.current, "enabled")
        .name("Enable")
        .listen()
        .onChange((value: boolean) => {
          smoothingRef.current.setEnabled(value);
        });

      const smoothingWindowController = smoothingFolder
        .add(smoothingDataRef.current, "windowSize", 3, 13, 2)
        .name("Window Size")
        .listen()
        .onChange((value: number) => {
          smoothingRef.current.setWindowSize(value);
        });

      smoothingControllerRefs.current = [
        smoothingEnabledController,
        smoothingWindowController,
      ];
      const smoothingSupported = supportsCommonSmoothing(
        penSettingsRef.current.brush,
      );
      smoothingDataRef.current.enabled = smoothingSupported
        ? smoothingRef.current.enabled
        : false;
      for (const controller of smoothingControllerRefs.current) {
        controller.disable(!smoothingSupported);
      }

      smoothingFolder.open();

      const penFolder = gui.addFolder("Pen Settings");

      penFolder
        .add(penDataRef.current, "lineWidth", 1, 250, 1)
        .name("Line Width")
        .listen()
        .onChange((value: number) => {
          penSettingsRef.current.setLineWidth(value);
        });

      penFolder
        .add(penDataRef.current, "pressureResponse", 0, 1, 0.05)
        .name("Pressure Response")
        .listen()
        .onChange((value: number) => {
          const ps = penSettingsRef.current;
          if (ps.brush.type === "bristle") {
            ps.setBrushPressureDynamics({ coverage: value });
            return;
          }
          ps.setBrushPressureDynamics({
            ...ps.brush.pressureDynamics,
            size: value,
          });
        });

      penFolder.open();

      const dynamicsFolder = gui.addFolder("Stamp Dynamics");

      const updateDynamics = (field: string, value: number) => {
        const ps = penSettingsRef.current;
        if (ps.brush.type !== "stamp") return;
        const updated: StampBrushConfig = {
          ...ps.brush,
          dynamics: { ...ps.brush.dynamics, [field]: value },
        };
        ps.setBrush(updated);
      };

      dynamicsFolder
        .add(brushDynamicsDataRef.current, "spacing", 0.01, 2.0, 0.01)
        .name("Spacing")
        .listen()
        .onChange((v: number) => updateDynamics("spacing", v));

      dynamicsFolder
        .add(brushDynamicsDataRef.current, "flow", 0, 1, 0.05)
        .name("Flow")
        .listen()
        .onChange((v: number) => updateDynamics("flow", v));

      dynamicsFolder
        .add(brushDynamicsDataRef.current, "flowPressure", 0, 1, 0.05)
        .name("Flow Pressure")
        .listen()
        .onChange((value: number) => {
          const ps = penSettingsRef.current;
          if (ps.brush.type !== "stamp") return;
          ps.setBrushPressureDynamics({
            ...ps.brush.pressureDynamics,
            flow: value,
          });
        });

      dynamicsFolder
        .add(brushDynamicsDataRef.current, "opacityJitter", 0, 1, 0.05)
        .name("Opacity Jitter")
        .listen()
        .onChange((v: number) => updateDynamics("opacityJitter", v));

      dynamicsFolder
        .add(brushDynamicsDataRef.current, "sizeJitter", 0, 1, 0.05)
        .name("Size Jitter")
        .listen()
        .onChange((v: number) => updateDynamics("sizeJitter", v));

      dynamicsFolder
        .add(
          brushDynamicsDataRef.current,
          "rotationJitter",
          0,
          Math.PI * 2,
          0.1,
        )
        .name("Rotation Jitter")
        .listen()
        .onChange((v: number) => updateDynamics("rotationJitter", v));

      dynamicsFolder
        .add(brushDynamicsDataRef.current, "scatter", 0, 3.0, 0.01)
        .name("Scatter")
        .listen()
        .onChange((v: number) => updateDynamics("scatter", v));

      if (penSettingsRef.current.brush.type !== "stamp") {
        dynamicsFolder.hide();
      }
      dynamicsFolder.open();
      stampDynamicsFolderRef.current = dynamicsFolder;

      const sprayFolder = gui.addFolder("Spray Dynamics");

      const updateSprayDynamics = (
        field: string,
        value: number | (typeof SIZE_JITTER_MODES)[number],
      ) => {
        const ps = penSettingsRef.current;
        if (ps.brush.type !== "spray") return;
        const updated: SprayBrushConfig = {
          ...ps.brush,
          dynamics: { ...ps.brush.dynamics, [field]: value },
        };
        ps.setBrush(updated);
      };

      sprayFolder
        .add(sprayDynamicsDataRef.current, "spacing", 0.01, 1.0, 0.01)
        .name("Spacing")
        .listen()
        .onChange((v: number) => updateSprayDynamics("spacing", v));

      sprayFolder
        .add(sprayDynamicsDataRef.current, "density", 0, 40, 0.1)
        .name("Density")
        .listen()
        .onChange((v: number) => updateSprayDynamics("density", v));

      sprayFolder
        .add(sprayDynamicsDataRef.current, "particleSize", 0.5, 12, 0.1)
        .name("Particle Size")
        .listen()
        .onChange((v: number) => updateSprayDynamics("particleSize", v));

      sprayFolder
        .add(sprayDynamicsDataRef.current, "particleSizeJitter", 0, 1, 0.05)
        .name("Size Jitter")
        .listen()
        .onChange((v: number) => updateSprayDynamics("particleSizeJitter", v));

      sprayFolder
        .add(sprayDynamicsDataRef.current, "sizeJitterMode", SIZE_JITTER_MODES)
        .name("Size Jitter Mode")
        .listen()
        .onChange((v: (typeof SIZE_JITTER_MODES)[number]) =>
          updateSprayDynamics("sizeJitterMode", v),
        );

      sprayFolder
        .add(sprayDynamicsDataRef.current, "opacityJitter", 0, 1, 0.05)
        .name("Opacity Jitter")
        .listen()
        .onChange((v: number) => updateSprayDynamics("opacityJitter", v));

      sprayFolder
        .add(sprayDynamicsDataRef.current, "flow", 0, 1, 0.05)
        .name("Flow")
        .listen()
        .onChange((v: number) => updateSprayDynamics("flow", v));

      sprayFolder
        .add(sprayDynamicsDataRef.current, "flowPressure", 0, 1, 0.05)
        .name("Flow Pressure")
        .listen()
        .onChange((value: number) => {
          const ps = penSettingsRef.current;
          if (ps.brush.type !== "spray") return;
          ps.setBrushPressureDynamics({
            ...ps.brush.pressureDynamics,
            flow: value,
          });
        });

      sprayFolder
        .add(sprayDynamicsDataRef.current, "densityPressure", 0, 1, 0.05)
        .name("Density Pressure")
        .listen()
        .onChange((value: number) => {
          const ps = penSettingsRef.current;
          if (ps.brush.type !== "spray") return;
          ps.setBrushPressureDynamics({
            ...ps.brush.pressureDynamics,
            density: value,
          });
        });

      if (penSettingsRef.current.brush.type !== "spray") {
        sprayFolder.hide();
      }
      sprayFolder.open();
      sprayDynamicsFolderRef.current = sprayFolder;

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

      const layerOffsetFolder = gui.addFolder("Offset");

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

      const touchFolder = gui.addFolder("Touch Debug");
      touchFolder
        .add(touchDebugDataRef.current, "showTouchDebug")
        .name("Show Overlay")
        .listen()
        .onChange((_value: boolean) => {
          onToggleTouchDebugRef.current?.();
        });
      touchFolder.open();

      guiRef.current = gui;
    });

    return () => {
      mounted = false;
      guiRef.current?.destroy();
      guiRef.current = null;
      smoothingControllerRefs.current = [];
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
    expandDataRef.current.mode = expand.config.levels[0].mode;
    expandDataRef.current.divisions = expand.config.levels[0].divisions;
    expandDataRef.current.angleDeg =
      (expand.config.levels[0].angle * 180) / Math.PI;
  }, [expand.config]);

  useEffect(() => {
    subExpandDataRef.current.enabled = expand.subEnabled;
    const sub = expand.config.levels[1];
    if (sub) {
      subExpandDataRef.current.mode = sub.mode;
      subExpandDataRef.current.divisions = sub.divisions;
      subExpandDataRef.current.angleDeg = (sub.angle * 180) / Math.PI;
      subExpandDataRef.current.offsetX = sub.offset.x;
      subExpandDataRef.current.offsetY = sub.offset.y;
    }
  }, [expand.config, expand.subEnabled]);

  useEffect(() => {
    const smoothingSupported = supportsCommonSmoothing(penSettings.brush);
    smoothingDataRef.current.enabled = smoothingSupported
      ? smoothing.enabled
      : false;
    smoothingDataRef.current.windowSize = smoothing.windowSize;
    for (const controller of smoothingControllerRefs.current) {
      controller.disable(!smoothingSupported);
    }
  }, [smoothing.enabled, smoothing.windowSize, penSettings.brush]);

  useEffect(() => {
    penDataRef.current.lineWidth = penSettings.lineWidth;
    penDataRef.current.pressureResponse = getPrimaryPressureResponse(
      penSettings.brush,
    );
  }, [penSettings.lineWidth, penSettings.brush]);

  useEffect(() => {
    const d =
      penSettings.brush.type === "stamp"
        ? penSettings.brush.dynamics
        : DEFAULT_BRUSH_DYNAMICS;
    brushDynamicsDataRef.current.spacing = d.spacing;
    brushDynamicsDataRef.current.flow = d.flow;
    brushDynamicsDataRef.current.opacityJitter = d.opacityJitter;
    brushDynamicsDataRef.current.sizeJitter = d.sizeJitter;
    brushDynamicsDataRef.current.rotationJitter = d.rotationJitter;
    brushDynamicsDataRef.current.scatter = d.scatter;
    brushDynamicsDataRef.current.flowPressure =
      penSettings.brush.type === "stamp"
        ? penSettings.brush.pressureDynamics.flow
        : DEFAULT_PRESSURE_DYNAMICS.flow;

    if (penSettings.brush.type === "stamp") {
      stampDynamicsFolderRef.current?.show();
    } else {
      stampDynamicsFolderRef.current?.hide();
    }
    const spray =
      penSettings.brush.type === "spray"
        ? penSettings.brush.dynamics
        : DEFAULT_SPRAY_DYNAMICS;
    sprayDynamicsDataRef.current.spacing = spray.spacing;
    sprayDynamicsDataRef.current.density = spray.density;
    sprayDynamicsDataRef.current.particleSize = spray.particleSize;
    sprayDynamicsDataRef.current.particleSizeJitter = spray.particleSizeJitter;
    sprayDynamicsDataRef.current.sizeJitterMode = spray.sizeJitterMode;
    sprayDynamicsDataRef.current.opacityJitter = spray.opacityJitter;
    sprayDynamicsDataRef.current.flow = spray.flow;
    sprayDynamicsDataRef.current.flowPressure =
      penSettings.brush.type === "spray"
        ? penSettings.brush.pressureDynamics.flow
        : DEFAULT_SPRAY_PRESSURE_DYNAMICS.flow;
    sprayDynamicsDataRef.current.densityPressure =
      penSettings.brush.type === "spray"
        ? penSettings.brush.pressureDynamics.density
        : DEFAULT_SPRAY_PRESSURE_DYNAMICS.density;

    if (penSettings.brush.type === "spray") {
      sprayDynamicsFolderRef.current?.show();
    } else {
      sprayDynamicsFolderRef.current?.hide();
    }
  }, [penSettings.brush]);

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

  useEffect(() => {
    touchDebugDataRef.current.showTouchDebug = showTouchDebug;
  }, [showTouchDebug]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        zIndex: 100,
        maxHeight: "100vh",
        overflowY: "auto",
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
            display: "grid",
            gap: 5,
            marginBottom: 8,
            paddingBottom: 8,
            borderBottom: "1px solid #444",
            color: "#ebebeb",
            fontSize: 11,
          }}
        >
          <div>
            Engine: <strong>{gpuBackend}</strong> ({gpuBackendReason}) · commit:{" "}
            {gpuCommitMode}
          </div>
          <label style={{ display: "grid", gridTemplateColumns: "1fr 110px" }}>
            Backend
            <select
              value={gpuBackendSetting}
              onChange={(event) => {
                const nextBackend = event.currentTarget.value as
                  | "auto"
                  | "webgl2"
                  | "cpu";
                if (!window.confirm("リロードして切り替えます")) {
                  event.currentTarget.value = gpuBackendSetting;
                  return;
                }
                onGpuBackendChange(nextBackend);
              }}
            >
              <option value="auto">auto</option>
              <option value="webgl2">webgl2</option>
              <option value="cpu">cpu</option>
            </select>
          </label>
        </div>
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
        {penSettings.brush.type === "spray" ? (
          <>
            <div
              style={{
                fontSize: 11,
                color: "#ebebeb",
                marginTop: 8,
                marginBottom: 4,
              }}
            >
              Radial Distribution
            </div>
            <DensityProfileCurveEditor
              value={penSettings.brush.dynamics.radialDistribution}
              onChange={(curve) => {
                if (penSettings.brush.type !== "spray") return;
                penSettings.setBrush({
                  ...penSettings.brush,
                  dynamics: {
                    ...penSettings.brush.dynamics,
                    radialDistribution: curve,
                  },
                });
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

export const DebugPanel = memo(DebugPanelComponent);
