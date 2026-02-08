import type {
  CompiledExpand,
  ExpandConfig,
  ExpandLevel,
  ExpandMode,
  Point,
} from "@headless-paint/engine";
import {
  compileExpand,
  createDefaultExpandConfig,
} from "@headless-paint/engine";
import { useCallback, useMemo, useRef, useState } from "react";

export interface UseExpandResult {
  config: ExpandConfig;
  compiled: CompiledExpand;
  // Root level
  setMode: (mode: ExpandMode) => void;
  setDivisions: (divisions: number) => void;
  setAngle: (angle: number) => void;
  // Sub level (child)
  subEnabled: boolean;
  setSubEnabled: (enabled: boolean) => void;
  setSubMode: (mode: ExpandMode) => void;
  setSubDivisions: (divisions: number) => void;
  setSubAngle: (angle: number) => void;
  setSubOffset: (offset: Point) => void;
}

const DEFAULT_SUB_LEVEL: ExpandLevel = {
  mode: "radial",
  offset: { x: 0, y: -80 },
  angle: 0,
  divisions: 4,
};

export function useExpand(
  layerWidth: number,
  layerHeight: number,
): UseExpandResult {
  const [rootLevel, setRootLevel] = useState<ExpandLevel>(() => {
    const defaultConfig = createDefaultExpandConfig(layerWidth, layerHeight);
    return defaultConfig.levels[0];
  });

  const [subLevel, setSubLevel] = useState<ExpandLevel>(DEFAULT_SUB_LEVEL);
  const [subEnabled, setSubEnabled] = useState(false);

  const config = useMemo<ExpandConfig>(
    () => ({
      levels: subEnabled ? [rootLevel, subLevel] : [rootLevel],
    }),
    [rootLevel, subLevel, subEnabled],
  );

  const compiled = useMemo(() => compileExpand(config), [config]);

  // refs for stable callbacks
  const rootRef = useRef(rootLevel);
  rootRef.current = rootLevel;
  const subRef = useRef(subLevel);
  subRef.current = subLevel;

  const setMode = useCallback((mode: ExpandMode) => {
    setRootLevel((prev) => ({ ...prev, mode }));
  }, []);

  const setDivisions = useCallback((divisions: number) => {
    const safe = Math.max(2, Math.floor(divisions));
    setRootLevel((prev) => ({ ...prev, divisions: safe }));
  }, []);

  const setAngle = useCallback((angle: number) => {
    setRootLevel((prev) => ({ ...prev, angle }));
  }, []);

  const setSubMode = useCallback((mode: ExpandMode) => {
    setSubLevel((prev) => ({ ...prev, mode }));
  }, []);

  const setSubDivisions = useCallback((divisions: number) => {
    const safe = Math.max(2, Math.floor(divisions));
    setSubLevel((prev) => ({ ...prev, divisions: safe }));
  }, []);

  const setSubAngle = useCallback((angle: number) => {
    setSubLevel((prev) => ({ ...prev, angle }));
  }, []);

  const setSubOffset = useCallback((offset: Point) => {
    setSubLevel((prev) => ({ ...prev, offset }));
  }, []);

  return {
    config,
    compiled,
    setMode,
    setDivisions,
    setAngle,
    subEnabled,
    setSubEnabled,
    setSubMode,
    setSubDivisions,
    setSubAngle,
    setSubOffset,
  };
}
