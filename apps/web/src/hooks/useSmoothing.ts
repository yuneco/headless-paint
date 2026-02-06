import type {
  CompiledFilterPipeline,
  FilterPipelineConfig,
} from "@headless-paint/input";
import { compileFilterPipeline } from "@headless-paint/input";
import { useCallback, useMemo, useState } from "react";

export interface UseSmoothingResult {
  enabled: boolean;
  windowSize: number;
  compiledFilterPipeline: CompiledFilterPipeline;
  setEnabled: (enabled: boolean) => void;
  setWindowSize: (windowSize: number) => void;
}

const DEFAULT_WINDOW_SIZE = 5;

export function useSmoothing(): UseSmoothingResult {
  const [enabled, setEnabled] = useState(false);
  const [windowSize, setWindowSizeState] = useState(DEFAULT_WINDOW_SIZE);

  const compiledFilterPipeline = useMemo(() => {
    const config: FilterPipelineConfig = enabled
      ? { filters: [{ type: "smoothing", config: { windowSize } }] }
      : { filters: [] };
    return compileFilterPipeline(config);
  }, [enabled, windowSize]);

  // windowSize は奇数に正規化（移動平均の中央が一意に決まる必要があるため）
  const setWindowSize = useCallback((value: number) => {
    const clamped = Math.max(3, Math.min(13, value));
    const odd = clamped % 2 === 0 ? clamped + 1 : clamped;
    setWindowSizeState(odd);
  }, []);

  return {
    enabled,
    windowSize,
    compiledFilterPipeline,
    setEnabled,
    setWindowSize,
  };
}
