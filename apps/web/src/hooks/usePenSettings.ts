import type { StrokeStyle } from "@headless-paint/engine";
import { useCallback, useState } from "react";

const PEN_COLOR = { r: 50, g: 50, b: 50, a: 255 };
const DEFAULT_LINE_WIDTH = 3;
const DEFAULT_PRESSURE_SENSITIVITY = 0;

export interface UsePenSettingsResult {
  readonly lineWidth: number;
  readonly pressureSensitivity: number;
  readonly strokeStyle: StrokeStyle;
  readonly setLineWidth: (width: number) => void;
  readonly setPressureSensitivity: (sensitivity: number) => void;
}

export function usePenSettings(): UsePenSettingsResult {
  const [lineWidth, setLineWidth] = useState(DEFAULT_LINE_WIDTH);
  const [pressureSensitivity, setPressureSensitivity] = useState(
    DEFAULT_PRESSURE_SENSITIVITY,
  );

  const strokeStyle: StrokeStyle = {
    color: PEN_COLOR,
    lineWidth,
    pressureSensitivity,
  };

  const handleSetLineWidth = useCallback((width: number) => {
    setLineWidth(width);
  }, []);

  const handleSetPressureSensitivity = useCallback((sensitivity: number) => {
    setPressureSensitivity(sensitivity);
  }, []);

  return {
    lineWidth,
    pressureSensitivity,
    strokeStyle,
    setLineWidth: handleSetLineWidth,
    setPressureSensitivity: handleSetPressureSensitivity,
  };
}
