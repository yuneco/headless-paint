import type {
  BrushConfig,
  Color,
  PressureCurve,
  PressureDynamics,
  StrokeStyle,
} from "@headless-paint/core";
import {
  DEFAULT_PRESSURE_CURVE,
  DEFAULT_PRESSURE_DYNAMICS,
  ROUND_PEN,
} from "@headless-paint/core";
import { useCallback, useMemo, useState } from "react";

export interface PenSettingsConfig {
  readonly initialColor?: Color;
  readonly initialLineWidth?: number;
  readonly initialPressureCurve?: PressureCurve;
  readonly initialBrush?: BrushConfig;
}

export interface UsePenSettingsResult {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureCurve: PressureCurve;
  readonly eraser: boolean;
  readonly brush: BrushConfig;
  readonly strokeStyle: StrokeStyle;
  readonly setColor: (color: Color) => void;
  readonly setLineWidth: (width: number) => void;
  readonly setPressureCurve: (curve: PressureCurve) => void;
  readonly setEraser: (eraser: boolean) => void;
  readonly setBrush: (brush: BrushConfig) => void;
  readonly setBrushPressureDynamics: (dynamics: PressureDynamics) => void;
}

const DEFAULT_COLOR: Color = { r: 0, g: 0, b: 0, a: 255 };
const DEFAULT_LINE_WIDTH = 8;

function normalizePressureDynamics(
  value: PressureDynamics | undefined,
): PressureDynamics {
  return {
    size: value?.size ?? DEFAULT_PRESSURE_DYNAMICS.size,
    flow: value?.flow ?? DEFAULT_PRESSURE_DYNAMICS.flow,
  };
}

function normalizeBrushConfig(brush: BrushConfig): BrushConfig {
  if (brush.type === "round-pen") {
    return {
      type: "round-pen",
      pressureDynamics: normalizePressureDynamics(brush.pressureDynamics),
    };
  }
  return {
    ...brush,
    pressureDynamics: normalizePressureDynamics(brush.pressureDynamics),
  };
}

export function usePenSettings(
  config?: PenSettingsConfig,
): UsePenSettingsResult {
  const [color, setColor] = useState<Color>(
    () => config?.initialColor ?? DEFAULT_COLOR,
  );
  const [lineWidth, setLineWidth] = useState(
    () => config?.initialLineWidth ?? DEFAULT_LINE_WIDTH,
  );
  const [pressureCurve, setPressureCurve] = useState<PressureCurve>(
    () => config?.initialPressureCurve ?? DEFAULT_PRESSURE_CURVE,
  );
  const [eraser, setEraser] = useState(false);
  const [brush, setBrush] = useState<BrushConfig>(() =>
    normalizeBrushConfig(config?.initialBrush ?? ROUND_PEN),
  );

  const strokeStyle = useMemo<StrokeStyle>(
    () => ({
      color,
      lineWidth,
      pressureCurve,
      compositeOperation: eraser ? "destination-out" : "source-over",
      brush,
    }),
    [color, lineWidth, pressureCurve, eraser, brush],
  );

  const handleSetColor = useCallback((c: Color) => {
    setColor(c);
  }, []);

  const handleSetLineWidth = useCallback((width: number) => {
    setLineWidth(width);
  }, []);

  const handleSetPressureCurve = useCallback((curve: PressureCurve) => {
    setPressureCurve(curve);
  }, []);

  const handleSetEraser = useCallback((e: boolean) => {
    setEraser(e);
  }, []);

  const handleSetBrush = useCallback((b: BrushConfig) => {
    setBrush(normalizeBrushConfig(b));
  }, []);

  const handleSetBrushPressureDynamics = useCallback(
    (dynamics: PressureDynamics) => {
      setBrush((current) =>
        normalizeBrushConfig({ ...current, pressureDynamics: dynamics }),
      );
    },
    [],
  );

  return useMemo(
    () => ({
      color,
      lineWidth,
      pressureCurve,
      eraser,
      brush,
      strokeStyle,
      setColor: handleSetColor,
      setLineWidth: handleSetLineWidth,
      setPressureCurve: handleSetPressureCurve,
      setEraser: handleSetEraser,
      setBrush: handleSetBrush,
      setBrushPressureDynamics: handleSetBrushPressureDynamics,
    }),
    [
      color,
      lineWidth,
      pressureCurve,
      eraser,
      brush,
      strokeStyle,
      handleSetColor,
      handleSetLineWidth,
      handleSetPressureCurve,
      handleSetEraser,
      handleSetBrush,
      handleSetBrushPressureDynamics,
    ],
  );
}
