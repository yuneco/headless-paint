import {
  DEFAULT_GESTURE_CONFIG,
  type GestureEvent,
  type GesturePointerEvent,
  type GestureState,
  type InputPoint,
  type Point,
  type SamplingConfig,
  type SamplingState,
  type ViewTransform,
  createGestureState,
  createSamplingState,
  processGestureEvent,
  screenToLayer,
  shouldAcceptPoint,
} from "@headless-paint/input";
import { useCallback, useRef, useState } from "react";

interface UseTouchGestureOptions {
  readonly transform: ViewTransform;
  readonly onStrokeStart?: (point: InputPoint, pendingOnly?: boolean) => void;
  readonly onStrokeMove?: (point: InputPoint) => void;
  readonly onStrokeEnd?: () => void;
  readonly onDrawConfirm?: () => void;
  readonly onDrawCancel?: () => void;
  readonly onSetTransform?: (t: ViewTransform) => void;
  readonly onUndo?: () => void;
  readonly samplingConfig?: SamplingConfig;
  readonly debugEnabled?: boolean;
}

interface UseTouchGestureResult {
  readonly handlePointerEvent: (e: React.PointerEvent) => void;
  readonly touchPoints: ReadonlyMap<number, Point>;
  readonly gesturePhase: string;
}

export function useTouchGesture(
  options: UseTouchGestureOptions,
): UseTouchGestureResult {
  const gestureStateRef = useRef<GestureState>(createGestureState());
  const transformRef = useRef(options.transform);
  transformRef.current = options.transform;

  const samplingStateRef = useRef<SamplingState>(createSamplingState());

  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const [touchPoints, setTouchPoints] = useState<Map<number, Point>>(
    () => new Map(),
  );
  const [gesturePhase, setGesturePhase] = useState("idle");

  const dispatchGestureEvent = useCallback((evt: GestureEvent) => {
    const cb = callbacksRef.current;
    const samplingCfg = cb.samplingConfig ?? { minDistance: 2 };

    switch (evt.type) {
      case "draw-start": {
        samplingStateRef.current = createSamplingState();
        const layerPt = screenToLayer(
          { x: evt.point.x, y: evt.point.y },
          transformRef.current,
        );
        if (layerPt) {
          const [accepted, newState] = shouldAcceptPoint(
            layerPt,
            evt.point.timestamp,
            samplingStateRef.current,
            samplingCfg,
          );
          samplingStateRef.current = newState;
          if (accepted) {
            cb.onStrokeStart?.(
              {
                x: layerPt.x,
                y: layerPt.y,
                pressure: evt.point.pressure,
                timestamp: evt.point.timestamp,
              },
              true,
            );
          }
        }
        break;
      }
      case "draw-move": {
        const layerPt = screenToLayer(
          { x: evt.point.x, y: evt.point.y },
          transformRef.current,
        );
        if (layerPt) {
          const [accepted, newState] = shouldAcceptPoint(
            layerPt,
            evt.point.timestamp,
            samplingStateRef.current,
            samplingCfg,
          );
          samplingStateRef.current = newState;
          if (accepted) {
            cb.onStrokeMove?.({
              x: layerPt.x,
              y: layerPt.y,
              pressure: evt.point.pressure,
              timestamp: evt.point.timestamp,
            });
          }
        }
        break;
      }
      case "draw-confirm":
        cb.onDrawConfirm?.();
        break;
      case "draw-end":
        cb.onStrokeEnd?.();
        break;
      case "draw-cancel":
        cb.onDrawCancel?.();
        break;
      case "pinch-start":
      case "pinch-move":
        cb.onSetTransform?.(evt.transform);
        break;
      case "pinch-end":
        break;
      case "undo":
        cb.onUndo?.();
        break;
    }
  }, []);

  const handlePointerEvent = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;

      let eventType: "down" | "move" | "up" | "cancel";
      switch (e.type) {
        case "pointerdown":
          eventType = "down";
          break;
        case "pointermove":
          eventType = "move";
          break;
        case "pointerup":
        case "pointerleave":
          eventType = "up";
          break;
        case "pointercancel":
          eventType = "cancel";
          break;
        default:
          return;
      }

      if (eventType === "down") {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }

      if (options.debugEnabled) {
        if (eventType === "down" || eventType === "move") {
          setTouchPoints((prev) => {
            const next = new Map(prev);
            next.set(e.pointerId, {
              x: e.nativeEvent.offsetX,
              y: e.nativeEvent.offsetY,
            });
            return next;
          });
        } else {
          setTouchPoints((prev) => {
            const next = new Map(prev);
            next.delete(e.pointerId);
            return next;
          });
        }
      }

      const gestureEvent: GesturePointerEvent = {
        pointerId: e.pointerId,
        pointerType: "touch",
        x: e.nativeEvent.offsetX,
        y: e.nativeEvent.offsetY,
        pressure: e.nativeEvent.pressure,
        timestamp: e.timeStamp,
        eventType,
      };

      const [newState, events] = processGestureEvent(
        gestureStateRef.current,
        gestureEvent,
        DEFAULT_GESTURE_CONFIG,
        transformRef.current,
      );
      gestureStateRef.current = newState;

      if (options.debugEnabled) {
        setGesturePhase(newState.phase);
      }

      for (const evt of events) {
        dispatchGestureEvent(evt);
      }
    },
    [options.debugEnabled, dispatchGestureEvent],
  );

  return { handlePointerEvent, touchPoints, gesturePhase };
}
