import {
  type InputPoint,
  type SamplingConfig,
  type SamplingState,
  type ViewTransform,
  createSamplingState,
  screenToLayer,
  shouldAcceptPoint,
} from "@headless-paint/input";
import { useCallback, useRef } from "react";

export type ToolType = "pen" | "scroll" | "rotate" | "zoom";

export interface UsePointerHandlerOptions {
  transform: ViewTransform;
  onPan: (dx: number, dy: number) => void;
  onZoom: (scale: number, centerX: number, centerY: number) => void;
  onRotate: (angleRad: number, centerX: number, centerY: number) => void;
  onStrokeStart: (point: InputPoint) => void;
  onStrokeMove: (point: InputPoint) => void;
  onStrokeEnd: () => void;
  canvasWidth: number;
  canvasHeight: number;
  samplingConfig?: SamplingConfig;
}

export interface PointerHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onWheel: (e: WheelEvent) => void;
}

export function usePointerHandler(
  tool: ToolType,
  options: UsePointerHandlerOptions,
): PointerHandlers {
  const {
    transform,
    onPan,
    onZoom,
    onRotate,
    onStrokeStart,
    onStrokeMove,
    onStrokeEnd,
    canvasWidth,
    canvasHeight,
    samplingConfig = { minDistance: 2 },
  } = options;

  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const samplingStateRef = useRef<SamplingState>(createSamplingState());

  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      isDrawingRef.current = true;
      lastPosRef.current = {
        x: e.nativeEvent.offsetX,
        y: e.nativeEvent.offsetY,
      };

      if (tool === "pen") {
        samplingStateRef.current = createSamplingState();
        const screenPoint = {
          x: e.nativeEvent.offsetX,
          y: e.nativeEvent.offsetY,
        };
        const layerPoint = screenToLayer(screenPoint, transform);
        if (layerPoint) {
          const [accepted, newState] = shouldAcceptPoint(
            layerPoint,
            e.timeStamp,
            samplingStateRef.current,
            samplingConfig,
          );
          samplingStateRef.current = newState;
          if (accepted) {
            onStrokeStart({
              x: layerPoint.x,
              y: layerPoint.y,
              pressure: e.nativeEvent.pressure,
              timestamp: e.timeStamp,
            });
          }
        }
      }

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [tool, transform, onStrokeStart, samplingConfig],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawingRef.current || !lastPosRef.current) return;

      const currentX = e.nativeEvent.offsetX;
      const currentY = e.nativeEvent.offsetY;
      const dx = currentX - lastPosRef.current.x;
      const dy = currentY - lastPosRef.current.y;

      switch (tool) {
        case "pen": {
          const screenPoint = { x: currentX, y: currentY };
          const layerPoint = screenToLayer(screenPoint, transform);
          if (layerPoint) {
            const [accepted, newState] = shouldAcceptPoint(
              layerPoint,
              e.timeStamp,
              samplingStateRef.current,
              samplingConfig,
            );
            samplingStateRef.current = newState;
            if (accepted) {
              onStrokeMove({
                x: layerPoint.x,
                y: layerPoint.y,
                pressure: e.nativeEvent.pressure,
                timestamp: e.timeStamp,
              });
            }
          }
          break;
        }
        case "scroll":
          onPan(dx, dy);
          break;
        case "rotate": {
          // 中心点からの角度変化で回転
          const prevAngle = Math.atan2(
            lastPosRef.current.y - centerY,
            lastPosRef.current.x - centerX,
          );
          const currentAngle = Math.atan2(
            currentY - centerY,
            currentX - centerX,
          );
          const deltaAngle = currentAngle - prevAngle;
          onRotate(deltaAngle, centerX, centerY);
          break;
        }
        case "zoom": {
          // 垂直ドラッグでズーム
          const scale = 1 - dy / 200;
          onZoom(scale, centerX, centerY);
          break;
        }
      }

      lastPosRef.current = { x: currentX, y: currentY };
    },
    [
      tool,
      transform,
      onPan,
      onZoom,
      onRotate,
      onStrokeMove,
      centerX,
      centerY,
      samplingConfig,
    ],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isDrawingRef.current && tool === "pen") {
        onStrokeEnd();
      }
      isDrawingRef.current = false;
      lastPosRef.current = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [tool, onStrokeEnd],
  );

  const onWheel = useCallback(
    (e: WheelEvent) => {
      const scale = e.deltaY > 0 ? 0.9 : 1.1;
      onZoom(scale, e.offsetX, e.offsetY);
    },
    [onZoom],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onWheel };
}
