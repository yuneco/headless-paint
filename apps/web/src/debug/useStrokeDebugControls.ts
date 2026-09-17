import type { BrushConfig, PressureCurve } from "@headless-paint/engine";
import type { InputPoint } from "@headless-paint/input";
import { useCallback } from "react";
import {
  BRISTLE_S_CURVE_FIXTURE_HEIGHT,
  BRISTLE_S_CURVE_FIXTURE_WIDTH,
  createBristleSCurveEvaluationPoints,
} from "../brush-evaluation-fixtures";
import { useInputCapture } from "./useInputCapture";
import { useStrokeCallMetrics } from "./useStrokeCallMetrics";

interface StrokeStartOptions {
  readonly straightLine?: boolean;
  readonly brushSeed?: number;
}

export interface StrokeDebugControlsOptions {
  readonly brush: BrushConfig;
  readonly lineWidth: number;
  readonly pressureCurve: PressureCurve;
  readonly usesStatefulMaterial: boolean;
  readonly smoothingEnabled: boolean;
  readonly smoothingWindowSize: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly canDraw: boolean;
  readonly isDrawing: boolean;
  readonly onStrokeStart: (
    point: InputPoint,
    options?: StrokeStartOptions,
  ) => void;
  readonly onStrokeMove: (point: InputPoint) => void;
  readonly onStrokeMoves: (points: readonly InputPoint[]) => void;
  readonly onStrokeEnd: () => void;
}

export function useStrokeDebugControls(options: StrokeDebugControlsOptions) {
  const inputCapture = useInputCapture();
  const metrics = useStrokeCallMetrics();

  const handleStrokeStart = useCallback(
    (point: InputPoint, startOptions?: StrokeStartOptions) => {
      inputCapture.start(point, {
        brush: options.brush,
        lineWidth: options.lineWidth,
        pressureCurve: options.pressureCurve,
        filterPipeline: options.usesStatefulMaterial
          ? { type: "causal-adaptive" }
          : {
              type: options.smoothingEnabled ? "common-smoothing" : "none",
              windowSize: options.smoothingWindowSize,
            },
      });
      metrics.measure(() => options.onStrokeStart(point, startOptions));
    },
    [
      inputCapture.start,
      metrics.measure,
      options.brush,
      options.lineWidth,
      options.onStrokeStart,
      options.pressureCurve,
      options.smoothingEnabled,
      options.smoothingWindowSize,
      options.usesStatefulMaterial,
    ],
  );

  const handleTouchStrokeStart = useCallback(
    (point: InputPoint) => {
      metrics.measure(() => options.onStrokeStart(point));
    },
    [metrics.measure, options.onStrokeStart],
  );

  const handleStrokeMove = useCallback(
    (point: InputPoint) => {
      inputCapture.append([point]);
      metrics.measure(() => options.onStrokeMove(point));
    },
    [inputCapture.append, metrics.measure, options.onStrokeMove],
  );

  const handleStrokeMoves = useCallback(
    (points: readonly InputPoint[]) => {
      inputCapture.append(points);
      metrics.measure(() => options.onStrokeMoves(points));
    },
    [inputCapture.append, metrics.measure, options.onStrokeMoves],
  );

  const handleStrokeEnd = useCallback(() => {
    metrics.measure(options.onStrokeEnd);
    metrics.flush();
    inputCapture.finalize();
  }, [
    inputCapture.finalize,
    metrics.flush,
    metrics.measure,
    options.onStrokeEnd,
  ]);

  const handleDrawBristleSCurve = useCallback(() => {
    if (
      options.brush.type !== "bristle" ||
      !options.canDraw ||
      options.isDrawing
    ) {
      return;
    }
    const points = createBristleSCurveEvaluationPoints(
      (options.layerWidth - BRISTLE_S_CURVE_FIXTURE_WIDTH) / 2,
      (options.layerHeight - BRISTLE_S_CURVE_FIXTURE_HEIGHT) / 2,
    );
    const firstPoint = points[0];
    if (!firstPoint) return;

    metrics.reset();
    metrics.measure(() => options.onStrokeStart(firstPoint, { brushSeed: 1 }));
    for (let index = 1; index < points.length; index += 4) {
      handleStrokeMoves(points.slice(index, index + 4));
    }
    handleStrokeEnd();
  }, [
    handleStrokeEnd,
    handleStrokeMoves,
    metrics.measure,
    metrics.reset,
    options.brush.type,
    options.canDraw,
    options.isDrawing,
    options.layerHeight,
    options.layerWidth,
    options.onStrokeStart,
  ]);

  return {
    strokeCallMetrics: metrics.metrics,
    resetStrokeCallMetrics: metrics.reset,
    handleStrokeStart,
    handleTouchStrokeStart,
    handleStrokeMove,
    handleStrokeMoves,
    handleStrokeEnd,
    handleDrawBristleSCurve,
    inputCaptureStatus: inputCapture.status,
    inputCapturePointCount: inputCapture.pointCount,
    handleArmInputCapture: inputCapture.arm,
    handleCopyInputCapture: inputCapture.canCopy
      ? inputCapture.copy
      : undefined,
  };
}
