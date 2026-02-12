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

export type ToolType =
  | "pen"
  | "eraser"
  | "scroll"
  | "rotate"
  | "zoom"
  | "offset";

export interface UsePointerHandlerOptions {
  readonly transform: ViewTransform;
  readonly onPan: (dx: number, dy: number) => void;
  readonly onZoom: (scale: number, centerX: number, centerY: number) => void;
  readonly onRotate: (
    angleRad: number,
    centerX: number,
    centerY: number,
  ) => void;
  readonly onStrokeStart?: (point: InputPoint) => void;
  readonly onStrokeMove?: (point: InputPoint) => void;
  readonly onStrokeEnd?: () => void;
  readonly onWrapShift?: (dx: number, dy: number) => void;
  readonly onWrapShiftEnd?: (totalDx: number, totalDy: number) => void;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly samplingConfig?: SamplingConfig;
}

export interface PointerHandlers {
  readonly onPointerDown: (e: React.PointerEvent) => void;
  readonly onPointerMove: (e: React.PointerEvent) => void;
  readonly onPointerUp: (e: React.PointerEvent) => void;
  readonly onWheel: (e: WheelEvent) => void;
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
    onWrapShift,
    onWrapShiftEnd,
    canvasWidth,
    canvasHeight,
    samplingConfig = { minDistance: 2 },
  } = options;

  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const samplingStateRef = useRef<SamplingState>(createSamplingState());
  const totalShiftRef = useRef({ x: 0, y: 0 });
  const fractionalShiftRef = useRef({ x: 0, y: 0 });

  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      isDrawingRef.current = true;
      lastPosRef.current = {
        x: e.nativeEvent.offsetX,
        y: e.nativeEvent.offsetY,
      };

      if (tool === "pen" || tool === "eraser") {
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
            onStrokeStart?.({
              x: layerPoint.x,
              y: layerPoint.y,
              pressure: e.nativeEvent.pressure,
              timestamp: e.timeStamp,
            });
          }
        }
      } else if (tool === "offset") {
        totalShiftRef.current = { x: 0, y: 0 };
        fractionalShiftRef.current = { x: 0, y: 0 };
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
        case "pen":
        case "eraser": {
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
              onStrokeMove?.({
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
          const scale = 1 - dy / 200;
          onZoom(scale, centerX, centerY);
          break;
        }
        case "offset": {
          const layerCurrent = screenToLayer(
            { x: currentX, y: currentY },
            transform,
          );
          const layerPrev = screenToLayer(lastPosRef.current, transform);
          if (layerCurrent && layerPrev) {
            const rawDx =
              layerCurrent.x - layerPrev.x + fractionalShiftRef.current.x;
            const rawDy =
              layerCurrent.y - layerPrev.y + fractionalShiftRef.current.y;
            const ldx = Math.round(rawDx);
            const ldy = Math.round(rawDy);
            fractionalShiftRef.current = { x: rawDx - ldx, y: rawDy - ldy };
            if (ldx !== 0 || ldy !== 0) {
              onWrapShift?.(ldx, ldy);
              totalShiftRef.current.x += ldx;
              totalShiftRef.current.y += ldy;
            }
          }
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
      onWrapShift,
      centerX,
      centerY,
      samplingConfig,
    ],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isDrawingRef.current) {
        if (tool === "pen" || tool === "eraser") {
          onStrokeEnd?.();
        } else if (tool === "offset") {
          onWrapShiftEnd?.(totalShiftRef.current.x, totalShiftRef.current.y);
        }
      }
      isDrawingRef.current = false;
      lastPosRef.current = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [tool, onStrokeEnd, onWrapShiftEnd],
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
