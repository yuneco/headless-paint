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
  readonly onStrokeMoves: (points: readonly InputPoint[]) => void;
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

  // runtime は遅延生成する。StrictMode はマウント直後に unmount/remount を
  // シミュレートするため、cleanup で dispose した runtime を使い回さないよう
  // ref を null に戻し、次の操作時に再生成する
  const getRuntime = useCallback((): StrokeRuntime => {
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
    return runtimeRef.current;
  }, [bumpRenderVersion]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, []);

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
      getRuntime().start(point, {
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
    [bumpRenderVersion, getRuntime],
  );

  const onStrokeMove = useCallback(
    (point: InputPoint) => {
      if (!runtimeRef.current?.isDrawing) return;
      appendStrokePoint(point);
      runtimeRef.current.move(point);
    },
    [appendStrokePoint],
  );

  const onStrokeMoves = useCallback((points: readonly InputPoint[]) => {
    if (!runtimeRef.current?.isDrawing || points.length === 0) return;
    strokePointsRef.current = [...strokePointsRef.current, ...points];
    runtimeRef.current.moveMany(points);
  }, []);

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
    onStrokeMoves,
    onStrokeEnd,
    onDrawConfirm,
    onDrawCancel,
    canDraw,
    renderVersion,
    strokePoints: strokePointsRef.current,
    isDrawing,
  };
}
