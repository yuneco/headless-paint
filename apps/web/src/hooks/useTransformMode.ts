import type {
  ContentBounds,
  Layer,
  LayerTransformPreview,
} from "@headless-paint/engine";
import { getContentBounds } from "@headless-paint/engine";
import type { mat3 } from "gl-matrix";
import { mat3 as m3 } from "gl-matrix";
import { useCallback, useMemo, useRef, useState } from "react";

export interface TransformModeState {
  readonly layerId: string;
  readonly initialBounds: ContentBounds;
  readonly matrix: mat3;
}

export interface UseTransformModeConfig {
  readonly commitTransform: (layerId: string, matrix: mat3) => void;
}

export interface UseTransformModeResult {
  readonly state: TransformModeState | null;
  readonly isActive: boolean;
  readonly start: (layerId: string, layer: Layer) => boolean;
  readonly updateMatrix: (matrix: mat3) => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
  readonly preview: LayerTransformPreview | undefined;
}

export function useTransformMode({
  commitTransform,
}: UseTransformModeConfig): UseTransformModeResult {
  const [state, setState] = useState<TransformModeState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const start = useCallback((layerId: string, layer: Layer): boolean => {
    const bounds = getContentBounds(layer);
    if (!bounds) return false;
    setState({
      layerId,
      initialBounds: bounds,
      matrix: m3.create(),
    });
    return true;
  }, []);

  const updateMatrix = useCallback((matrix: mat3) => {
    const current = stateRef.current;
    if (!current) return;
    setState({ ...current, matrix });
  }, []);

  const confirm = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    commitTransform(current.layerId, current.matrix);
    setState(null);
  }, [commitTransform]);

  const cancel = useCallback(() => {
    setState(null);
  }, []);

  const preview: LayerTransformPreview | undefined = useMemo(() => {
    if (!state) return undefined;
    return {
      layerId: state.layerId,
      matrix: state.matrix as Float32Array,
    };
  }, [state]);

  return {
    state,
    isActive: state !== null,
    start,
    updateMatrix,
    confirm,
    cancel,
    preview,
  };
}
