import type { Color, PressureCurve, StrokeStyle } from "@headless-paint/engine";
import { DEFAULT_PRESSURE_CURVE } from "@headless-paint/engine";
import { useCallback, useState } from "react";

export interface PenSettingsConfig {
  readonly initialColor?: Color;
  readonly initialLineWidth?: number;
  readonly initialPressureSensitivity?: number;
  readonly initialPressureCurve?: PressureCurve;
}

export interface UsePenSettingsResult {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity: number;
  readonly pressureCurve: PressureCurve;
  readonly eraser: boolean;
  readonly strokeStyle: StrokeStyle;
  readonly setColor: (color: Color) => void;
  readonly setLineWidth: (width: number) => void;
  readonly setPressureSensitivity: (sensitivity: number) => void;
  readonly setPressureCurve: (curve: PressureCurve) => void;
  readonly setEraser: (eraser: boolean) => void;
}

const DEFAULT_COLOR: Color = { r: 0, g: 0, b: 0, a: 255 };
const DEFAULT_LINE_WIDTH = 8;
const DEFAULT_PRESSURE_SENSITIVITY = 1.0;

export function usePenSettings(
  config?: PenSettingsConfig,
): UsePenSettingsResult {
  const [color, setColor] = useState<Color>(
    () => config?.initialColor ?? DEFAULT_COLOR,
  );
  const [lineWidth, setLineWidth] = useState(
    () => config?.initialLineWidth ?? DEFAULT_LINE_WIDTH,
  );
  const [pressureSensitivity, setPressureSensitivity] = useState(
    () => config?.initialPressureSensitivity ?? DEFAULT_PRESSURE_SENSITIVITY,
  );
  const [pressureCurve, setPressureCurve] = useState<PressureCurve>(
    () => config?.initialPressureCurve ?? DEFAULT_PRESSURE_CURVE,
  );
  const [eraser, setEraser] = useState(false);

  const strokeStyle: StrokeStyle = {
    color,
    lineWidth,
    pressureSensitivity,
    pressureCurve,
    compositeOperation: eraser ? "destination-out" : undefined,
  };

  const handleSetColor = useCallback((c: Color) => {
    setColor(c);
  }, []);

  const handleSetLineWidth = useCallback((width: number) => {
    setLineWidth(width);
  }, []);

  const handleSetPressureSensitivity = useCallback((sensitivity: number) => {
    setPressureSensitivity(sensitivity);
  }, []);

  const handleSetPressureCurve = useCallback((curve: PressureCurve) => {
    setPressureCurve(curve);
  }, []);

  const handleSetEraser = useCallback((e: boolean) => {
    setEraser(e);
  }, []);

  return {
    color,
    lineWidth,
    pressureSensitivity,
    pressureCurve,
    eraser,
    strokeStyle,
    setColor: handleSetColor,
    setLineWidth: handleSetLineWidth,
    setPressureSensitivity: handleSetPressureSensitivity,
    setPressureCurve: handleSetPressureCurve,
    setEraser: handleSetEraser,
  };
}
