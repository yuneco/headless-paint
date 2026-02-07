import type { PatternMode, PatternPreviewConfig } from "@headless-paint/engine";
import { DEFAULT_PATTERN_PREVIEW_CONFIG } from "@headless-paint/engine";
import { useCallback, useState } from "react";

export interface UsePatternPreviewResult {
  readonly config: PatternPreviewConfig;
  readonly setMode: (mode: PatternMode) => void;
  readonly setOpacity: (opacity: number) => void;
  readonly setOffsetX: (offset: number) => void;
  readonly setOffsetY: (offset: number) => void;
}

export function usePatternPreview(): UsePatternPreviewResult {
  const [config, setConfig] = useState<PatternPreviewConfig>(
    DEFAULT_PATTERN_PREVIEW_CONFIG,
  );

  const setMode = useCallback((mode: PatternMode) => {
    setConfig((prev) => ({ ...prev, mode }));
  }, []);

  const setOpacity = useCallback((opacity: number) => {
    setConfig((prev) => ({ ...prev, opacity }));
  }, []);

  const setOffsetX = useCallback((offsetX: number) => {
    setConfig((prev) => ({ ...prev, offsetX, offsetY: 0 }));
  }, []);

  const setOffsetY = useCallback((offsetY: number) => {
    setConfig((prev) => ({ ...prev, offsetY, offsetX: 0 }));
  }, []);

  return { config, setMode, setOpacity, setOffsetX, setOffsetY };
}
