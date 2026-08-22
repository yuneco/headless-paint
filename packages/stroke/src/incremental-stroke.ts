import type {
  BrushRenderState,
  BrushTipRegistry,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import {
  appendToCommittedLayer,
  compileExpand,
  copyLayerPixels,
  createLayer,
  generateBrushTip,
} from "@headless-paint/engine";
import {
  compileFilterPipeline,
  createFilterPipelineState,
  finalizePipeline,
  processPoint,
} from "@headless-paint/input";
import type {
  FilterPipelineConfig,
  FilterPipelineState,
  InputPoint,
} from "@headless-paint/input";
import { addPointToSession, startStrokeSession } from "./session";
import type { RenderUpdate, StrokeSessionState } from "./types";

export interface IncrementalStrokeRendererConfig {
  readonly layer: Layer;
  readonly style: StrokeStyle;
  readonly filterPipeline: FilterPipelineConfig;
  readonly expand: ExpandConfig;
  readonly brushSeed: number;
  readonly alphaLocked: boolean;
  readonly sourceLayer?: Layer;
  readonly registry?: BrushTipRegistry;
  readonly onRenderUpdate?: (update: IncrementalStrokeRenderUpdate) => void;
}

export interface IncrementalStrokeRenderUpdate {
  readonly session: StrokeSessionState;
  readonly renderUpdate: RenderUpdate;
  readonly brushState: BrushRenderState | undefined;
}

export interface IncrementalStrokeRenderer {
  feed(point: InputPoint): void;
  finalize(): void;
}

export function createIncrementalStrokeRenderer(
  config: IncrementalStrokeRendererConfig,
): IncrementalStrokeRenderer {
  const compiledFilterPipeline = compileFilterPipeline(config.filterPipeline);
  const compiledExpand = compileExpand(config.expand);
  const samplingLayer =
    config.sourceLayer ?? createSamplingLayer(config.layer, config.style);

  let filterState: FilterPipelineState = createFilterPipelineState(
    compiledFilterPipeline,
  );
  let strokeSession: StrokeSessionState | null = null;
  let brushState = createInitialBrushState(
    config.style,
    config.brushSeed,
    config.registry,
  ).brushState;
  let hasFed = false;
  let finalized = false;

  return {
    feed(point) {
      if (finalized) return;
      const filterResult = processPoint(
        filterState,
        point,
        compiledFilterPipeline,
      );
      filterState = filterResult.state;
      const strokeResult = strokeSession
        ? addPointToSession(strokeSession, filterResult.output)
        : startStrokeSession(filterResult.output, config.style, config.expand);
      strokeSession = strokeResult.state;
      brushState = appendToCommittedLayer(
        config.layer,
        strokeResult.renderUpdate.newlyCommitted,
        config.style,
        compiledExpand,
        strokeResult.renderUpdate.committedOverlapCount,
        brushState,
        samplingLayer,
        config.alphaLocked,
      );
      hasFed = true;
      config.onRenderUpdate?.({
        session: strokeResult.state,
        renderUpdate: strokeResult.renderUpdate,
        brushState,
      });
    },
    finalize() {
      if (finalized || !hasFed || !strokeSession) return;
      finalized = true;
      const finalOutput = finalizePipeline(filterState, compiledFilterPipeline);
      const strokeResult = addPointToSession(strokeSession, finalOutput);
      strokeSession = strokeResult.state;
      brushState = appendToCommittedLayer(
        config.layer,
        strokeResult.renderUpdate.newlyCommitted,
        config.style,
        compiledExpand,
        strokeResult.renderUpdate.committedOverlapCount,
        brushState,
        samplingLayer,
        config.alphaLocked,
      );
      config.onRenderUpdate?.({
        session: strokeResult.state,
        renderUpdate: strokeResult.renderUpdate,
        brushState,
      });
    },
  };
}

export function createInitialBrushState(
  style: StrokeStyle,
  seed: number,
  registry?: BrushTipRegistry,
): {
  readonly brushState: BrushRenderState | undefined;
  readonly brushSeed: number;
} {
  if (style.brush.type === "round-pen") {
    return { brushState: undefined, brushSeed: seed };
  }
  if (style.brush.type === "bristle") {
    return {
      brushState: {
        tipCanvas: null,
        seed,
        branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
      },
      brushSeed: seed,
    };
  }
  const tipCanvas =
    style.brush.type === "stamp"
      ? generateBrushTip(
          style.brush.tip,
          Math.ceil(style.lineWidth * 2),
          style.color,
          registry,
        )
      : generateBrushTip(
          style.brush.particle,
          calculateSprayTipSize(style),
          style.color,
          registry,
        );
  return {
    brushState: {
      tipCanvas,
      seed,
      branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
    },
    brushSeed: seed,
  };
}

function calculateSprayTipSize(style: StrokeStyle): number {
  if (style.brush.type !== "spray") return 0;
  const maxScale = style.brush.dynamics.sizeJitterMode === "lognormal" ? 4 : 1;
  return Math.ceil(style.brush.dynamics.particleSize * maxScale);
}

function createSamplingLayer(
  layer: Layer,
  style: StrokeStyle,
): Layer | undefined {
  if (
    (style.brush.type !== "stamp" && style.brush.type !== "bristle") ||
    !style.brush.mixing?.enabled
  ) {
    return undefined;
  }
  const samplingLayer = createLayer(layer.width, layer.height);
  copyLayerPixels(layer, samplingLayer);
  return samplingLayer;
}
