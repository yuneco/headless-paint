import type { Color, PressureCurve, StrokeStyle } from "@headless-paint/engine";
import { useCallback, useState } from "react";
import {
  DEFAULT_LINE_WIDTH,
  DEFAULT_PEN_COLOR,
  DEFAULT_PRESSURE_CURVE,
  DEFAULT_PRESSURE_SENSITIVITY,
} from "../config";

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

export function usePenSettings(): UsePenSettingsResult {
  const [color, setColor] = useState<Color>(DEFAULT_PEN_COLOR);
  const [lineWidth, setLineWidth] = useState(DEFAULT_LINE_WIDTH);
  const [pressureSensitivity, setPressureSensitivity] = useState(
    DEFAULT_PRESSURE_SENSITIVITY,
  );
  const [pressureCurve, setPressureCurve] = useState<PressureCurve>(
    DEFAULT_PRESSURE_CURVE,
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
