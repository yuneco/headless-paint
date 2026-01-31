import { useCallback, useState } from "react";
import {
  type ViewTransform,
  createViewTransform,
  pan,
  zoom,
  rotate,
} from "@headless-paint/input";

export interface UseViewTransformResult {
  transform: ViewTransform;
  handlePan: (dx: number, dy: number) => void;
  handleZoom: (scale: number, centerX: number, centerY: number) => void;
  handleRotate: (angleRad: number, centerX: number, centerY: number) => void;
  reset: () => void;
}

export function useViewTransform(): UseViewTransformResult {
  const [transform, setTransform] = useState<ViewTransform>(
    createViewTransform,
  );

  const handlePan = useCallback((dx: number, dy: number) => {
    setTransform((prev) => pan(prev, dx, dy));
  }, []);

  const handleZoom = useCallback(
    (scale: number, centerX: number, centerY: number) => {
      setTransform((prev) => zoom(prev, scale, centerX, centerY));
    },
    [],
  );

  const handleRotate = useCallback(
    (angleRad: number, centerX: number, centerY: number) => {
      setTransform((prev) => rotate(prev, angleRad, centerX, centerY));
    },
    [],
  );

  const reset = useCallback(() => {
    setTransform(createViewTransform());
  }, []);

  return { transform, handlePan, handleZoom, handleRotate, reset };
}
