import {
  type ViewTransform,
  createViewTransform,
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
      // レイヤー全体がビューに収まる最大スケールを求める
      const scale = Math.min(viewW / layerW, viewH / layerH);
      // スケール後のレイヤーをビュー中央に配置するためのオフセット
      const offsetX = (viewW - layerW * scale) / 2;
      const offsetY = (viewH - layerH * scale) / 2;

      // identity → zoom(原点基準) → pan でフィット用 transform を構築
      let t = createViewTransform();
      t = zoom(t, scale, 0, 0);
      t = pan(t, offsetX, offsetY);
      setTransform(t);
    },
    [],
  );

  const reset = useCallback(() => {
    setTransform(createViewTransform());
  }, []);

  return {
    transform,
    handlePan,
    handleZoom,
    handleRotate,
    reset,
    setInitialFit,
  };
}
