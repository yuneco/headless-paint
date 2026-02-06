import { useCallback, useMemo, useState } from "react";
import type {
  CompiledExpand,
  ExpandConfig,
  ExpandMode,
} from "@headless-paint/engine";
import {
  compileExpand,
  createDefaultExpandConfig,
} from "@headless-paint/engine";

export interface UseExpandResult {
  config: ExpandConfig;
  compiled: CompiledExpand;
  setMode: (mode: ExpandMode) => void;
  setDivisions: (divisions: number) => void;
  setAngle: (angle: number) => void;
}

export function useExpand(
  layerWidth: number,
  layerHeight: number,
): UseExpandResult {
  const [config, setConfig] = useState<ExpandConfig>(() =>
    createDefaultExpandConfig(layerWidth, layerHeight),
  );

  const compiled = useMemo(() => compileExpand(config), [config]);

  const setMode = useCallback((mode: ExpandMode) => {
    setConfig((prev) => ({ ...prev, mode }));
  }, []);

  const setDivisions = useCallback((divisions: number) => {
    const safeDivisions = Math.max(2, Math.floor(divisions));
    setConfig((prev) => ({ ...prev, divisions: safeDivisions }));
  }, []);

  const setAngle = useCallback((angle: number) => {
    setConfig((prev) => ({ ...prev, angle }));
  }, []);

  return { config, compiled, setMode, setDivisions, setAngle };
}
