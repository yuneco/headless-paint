import { useCallback, useMemo, useState } from "react";
import type { CompiledSymmetry, SymmetryConfig, SymmetryMode } from "@headless-paint/input";
import { compileSymmetry, createDefaultSymmetryConfig } from "@headless-paint/input";

export interface UseSymmetryResult {
  config: SymmetryConfig;
  compiled: CompiledSymmetry;
  setMode: (mode: SymmetryMode) => void;
  setDivisions: (divisions: number) => void;
  setAngle: (angle: number) => void;
}

export function useSymmetry(
  layerWidth: number,
  layerHeight: number,
): UseSymmetryResult {
  const [config, setConfig] = useState<SymmetryConfig>(() =>
    createDefaultSymmetryConfig(layerWidth, layerHeight),
  );

  // 設定が変わった時だけ行列を再計算
  const compiled = useMemo(() => compileSymmetry(config), [config]);

  const setMode = useCallback((mode: SymmetryMode) => {
    setConfig((prev) => ({ ...prev, mode }));
  }, []);

  const setDivisions = useCallback((divisions: number) => {
    // 分割数は2以上
    const safeDivisions = Math.max(2, Math.floor(divisions));
    setConfig((prev) => ({ ...prev, divisions: safeDivisions }));
  }, []);

  const setAngle = useCallback((angle: number) => {
    setConfig((prev) => ({ ...prev, angle }));
  }, []);

  return { config, compiled, setMode, setDivisions, setAngle };
}
