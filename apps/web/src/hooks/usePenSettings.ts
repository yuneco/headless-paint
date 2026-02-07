import type { PressureCurve, StrokeStyle } from "@headless-paint/engine";
import { useCallback, useState } from "react";
import {
  DEFAULT_LINE_WIDTH,
  DEFAULT_PEN_COLOR,
  DEFAULT_PRESSURE_CURVE,
  DEFAULT_PRESSURE_SENSITIVITY,
} from "../config";

export interface UsePenSettingsResult {
  readonly lineWidth: number;
  readonly pressureSensitivity: number;
  readonly pressureCurve: PressureCurve;
  readonly strokeStyle: StrokeStyle;
  readonly setLineWidth: (width: number) => void;
  readonly setPressureSensitivity: (sensitivity: number) => void;
  readonly setPressureCurve: (curve: PressureCurve) => void;
}

export function usePenSettings(): UsePenSettingsResult {
  const [lineWidth, setLineWidth] = useState(DEFAULT_LINE_WIDTH);
  const [pressureSensitivity, setPressureSensitivity] = useState(
    DEFAULT_PRESSURE_SENSITIVITY,
  );
  const [pressureCurve, setPressureCurve] = useState<PressureCurve>(
    DEFAULT_PRESSURE_CURVE,
  );

  const strokeStyle: StrokeStyle = {
    color: DEFAULT_PEN_COLOR,
    lineWidth,
    pressureSensitivity,
    pressureCurve,
  };

  const handleSetLineWidth = useCallback((width: number) => {
    setLineWidth(width);
  }, []);

  const handleSetPressureSensitivity = useCallback((sensitivity: number) => {
    setPressureSensitivity(sensitivity);
  }, []);

  const handleSetPressureCurve = useCallback((curve: PressureCurve) => {
    setPressureCurve(curve);
  }, []);

  return {
    lineWidth,
    pressureSensitivity,
    pressureCurve,
    strokeStyle,
    setLineWidth: handleSetLineWidth,
    setPressureSensitivity: handleSetPressureSensitivity,
    setPressureCurve: handleSetPressureCurve,
  };
}
