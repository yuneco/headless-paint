import type {
  BrushTipRegistry,
  CompiledExpand,
  ExpandConfig,
  Layer,
  StrokeCommand,
  StrokeRuntime,
  StrokeStyle,
} from "@headless-paint/core";
import type {
  CompiledFilterPipeline,
  FilterPipelineConfig,
  InputPoint,
} from "@headless-paint/core";
import { createStrokeRuntime } from "@headless-paint/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRafRenderVersion } from "./useRafRenderVersion";

export interface StrokeCompleteData {
  readonly inputPoints: readonly InputPoint[];
  readonly filterPipelineConfig: FilterPipelineConfig;
  readonly expandConfig: ExpandConfig;
  readonly strokeStyle: StrokeStyle;
  readonly brushSeed: number;
  readonly alphaLocked: boolean;
  readonly totalPoints: number;
}

export interface StrokeStartOptions {
  readonly pendingOnly?: boolean;
  readonly straightLine?: boolean;
}

export interface UseStrokeSessionConfig {
  readonly layer: Layer | null;
  readonly pendingLayer: Layer;
  readonly strokeStyle: StrokeStyle;
  readonly compiledFilterPipeline: CompiledFilterPipeline;
  readonly expandConfig: ExpandConfig;
  readonly compiledExpand: CompiledExpand;
  readonly onStrokeComplete?: (data: StrokeCompleteData) => void;
  readonly registry?: BrushTipRegistry;
}

export interface UseStrokeSessionResult {
  readonly onStrokeStart: (
    point: InputPoint,
    options?: StrokeStartOptions,
  ) => void;
  readonly onStrokeMove: (point: InputPoint) => void;
  readonly onStrokeEnd: () => void;
  readonly onDrawConfirm: () => void;
  readonly onDrawCancel: () => void;
  readonly canDraw: boolean;
  readonly renderVersion: number;
  readonly strokePoints: readonly InputPoint[];
  readonly isDrawing: boolean;
}

const STRAIGHT_LINE_FILTER_PIPELINE: FilterPipelineConfig = {
  filters: [{ type: "straight-line", config: {} }],
};

function toStrokeCompleteData(command: StrokeCommand): StrokeCompleteData {
  return {
    inputPoints: command.inputPoints,
    filterPipelineConfig: command.filterPipeline,
    expandConfig: command.expand,
    strokeStyle: command.style,
    brushSeed: command.brushSeed,
    alphaLocked: command.alphaLocked,
    totalPoints: command.inputPoints.length,
  };
}

export function useStrokeSession(
  config: UseStrokeSessionConfig,
): UseStrokeSessionResult {
  const [renderVersion, bumpRenderVersion] = useRafRenderVersion();
  const [isDrawing, setIsDrawing] = useState(false);

  const configRef = useRef(config);
  configRef.current = config;
  const onStrokeCompleteRef = useRef(config.onStrokeComplete);
  onStrokeCompleteRef.current = config.onStrokeComplete;

  const mountedRef = useRef(true);
  const strokePointsRef = useRef<readonly InputPoint[]>([]);
  const pendingOnlyRef = useRef(false);
  const runtimeRef = useRef<StrokeRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = createStrokeRuntime({
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => {
        clearTimeout(id as ReturnType<typeof setTimeout>);
      },
      now: () => performance.now(),
      requestRender: bumpRenderVersion,
      onCommit: (command) => {
        onStrokeCompleteRef.current?.(toStrokeCompleteData(command));
      },
      onDrawingChanged: (nextIsDrawing) => {
        if (mountedRef.current) {
          setIsDrawing(nextIsDrawing);
        }
        if (!nextIsDrawing) {
          strokePointsRef.current = [];
          pendingOnlyRef.current = false;
        }
      },
    });
  }

  useEffect(
    () => () => {
      mountedRef.current = false;
      runtimeRef.current?.dispose();
    },
    [],
  );

  const canDraw = config.layer?.meta.visible ?? false;

  const appendStrokePoint = useCallback((point: InputPoint) => {
    strokePointsRef.current = [...strokePointsRef.current, point];
  }, []);

  const onStrokeStart = useCallback(
    (point: InputPoint, options?: StrokeStartOptions) => {
      const {
        layer,
        pendingLayer,
        strokeStyle,
        compiledFilterPipeline,
        expandConfig,
        registry,
      } = configRef.current;
      if (!layer || !layer.meta.visible) return;

      pendingOnlyRef.current = options?.pendingOnly ?? false;
      strokePointsRef.current = [point];
      runtimeRef.current?.start(point, {
        layer,
        pendingLayer,
        style: strokeStyle,
        filterPipeline: options?.straightLine
          ? STRAIGHT_LINE_FILTER_PIPELINE
          : compiledFilterPipeline.config,
        expand: expandConfig,
        alphaLocked: layer.meta.alphaLocked,
        pendingOnly: options?.pendingOnly,
        tipRegistry: registry,
      });
      bumpRenderVersion();
    },
    [bumpRenderVersion],
  );

  const onStrokeMove = useCallback(
    (point: InputPoint) => {
      if (!runtimeRef.current?.isDrawing) return;
      appendStrokePoint(point);
      runtimeRef.current.move(point);
    },
    [appendStrokePoint],
  );

  const onStrokeEnd = useCallback(() => {
    if (!runtimeRef.current?.isDrawing) return;
    if (pendingOnlyRef.current) {
      runtimeRef.current.cancel();
    } else {
      runtimeRef.current.end();
    }
    bumpRenderVersion();
  }, [bumpRenderVersion]);

  const onDrawConfirm = useCallback(() => {
    runtimeRef.current?.confirm();
    pendingOnlyRef.current = false;
    bumpRenderVersion();
  }, [bumpRenderVersion]);

  const onDrawCancel = useCallback(() => {
    runtimeRef.current?.cancel();
    pendingOnlyRef.current = false;
    bumpRenderVersion();
  }, [bumpRenderVersion]);

  return {
    onStrokeStart,
    onStrokeMove,
    onStrokeEnd,
    onDrawConfirm,
    onDrawCancel,
    canDraw,
    renderVersion,
    strokePoints: strokePointsRef.current,
    isDrawing,
  };
}
