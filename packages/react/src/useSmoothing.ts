import type {
  CompiledFilterPipeline,
  FilterPipelineConfig,
} from "@headless-paint/input";
import { compileFilterPipeline } from "@headless-paint/input";
import { useCallback, useMemo, useState } from "react";

export interface SmoothingConfig {
  readonly initialEnabled?: boolean;
  readonly initialWindowSize?: number;
}

export interface UseSmoothingResult {
  readonly enabled: boolean;
  readonly windowSize: number;
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  readonly setEnabled: (enabled: boolean) => void;
  readonly setWindowSize: (windowSize: number) => void;
}

const DEFAULT_SMOOTHING_ENABLED = true;
const DEFAULT_SMOOTHING_WINDOW_SIZE = 5;

export function useSmoothing(config?: SmoothingConfig): UseSmoothingResult {
  const [enabled, setEnabled] = useState(
    () => config?.initialEnabled ?? DEFAULT_SMOOTHING_ENABLED,
  );
  const [windowSize, setWindowSizeState] = useState(
    () => config?.initialWindowSize ?? DEFAULT_SMOOTHING_WINDOW_SIZE,
  );

  const compiledFilterPipeline = useMemo(() => {
    const pipelineConfig: FilterPipelineConfig = enabled
      ? { filters: [{ type: "smoothing", config: { windowSize } }] }
      : { filters: [] };
    return compileFilterPipeline(pipelineConfig);
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
