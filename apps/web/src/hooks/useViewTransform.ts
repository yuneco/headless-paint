import {
  type ViewTransform,
  createViewTransform,
  fitToView,
  pan,
  rotate,
  zoom,
} from "@headless-paint/input";
import { useCallback, useState } from "react";

export interface UseViewTransformResult {
  transform: ViewTransform;
  handlePan: (dx: number, dy: number) => void;
  handleZoom: (scale: number, centerX: number, centerY: number) => void;
  handleRotate: (angleRad: number, centerX: number, centerY: number) => void;
  handleSetTransform: (newTransform: ViewTransform) => void;
  reset: () => void;
  /**
   * レイヤー全体がビューに収まるようにスケール・オフセットを設定する。
   * 初回マウント時やリセット時に呼ぶ。
   */
  setInitialFit: (
    viewW: number,
    viewH: number,
    layerW: number,
    layerH: number,
  ) => void;
}

export function useViewTransform(): UseViewTransformResult {
  const [transform, setTransform] =
    useState<ViewTransform>(createViewTransform);

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

  const setInitialFit = useCallback(
    (viewW: number, viewH: number, layerW: number, layerH: number) => {
      setTransform(fitToView(viewW, viewH, layerW, layerH));
    },
    [],
  );

  const handleSetTransform = useCallback((newTransform: ViewTransform) => {
    setTransform(newTransform);
  }, []);

  const reset = useCallback(() => {
    setTransform(createViewTransform());
  }, []);

  return {
    transform,
    handlePan,
    handleZoom,
    handleRotate,
    handleSetTransform,
    reset,
    setInitialFit,
  };
}
