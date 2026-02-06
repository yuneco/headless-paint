import { getFilterPlugin } from "./plugins";
import type {
  CompiledFilterPipeline,
  FilterConfig,
  FilterOutput,
  FilterPipelineConfig,
  FilterPipelineState,
  FilterProcessResult,
  InputPoint,
} from "./types";

/**
 * フィルタパイプライン設定をコンパイルする
 * 設定変更時に1回だけ呼び出す
 */
export function compileFilterPipeline(
  config: FilterPipelineConfig,
): CompiledFilterPipeline {
  const plugins = config.filters.map((filterConfig) =>
    getFilterPlugin(filterConfig.type),
  );

  return {
    config,
    plugins,
  };
}

/**
 * パイプラインの初期状態を作成する
 * ストローク開始時に呼び出す
 */
export function createFilterPipelineState(
  compiled: CompiledFilterPipeline,
): FilterPipelineState {
  const filterStates = compiled.config.filters.map(
    (filterConfig: FilterConfig, index: number) => {
      const plugin = compiled.plugins[index];
      return plugin.createState(filterConfig.config);
    },
  );

  return {
    filterStates,
    allCommitted: [],
  };
}

/**
 * 入力点をパイプラインで処理する
 */
export function processPoint(
  state: FilterPipelineState,
  point: InputPoint,
  compiled: CompiledFilterPipeline,
): FilterProcessResult {
  // フィルタがない場合：点をそのまま確定
  if (compiled.plugins.length === 0) {
    return {
      state: {
        filterStates: [],
        allCommitted: [...state.allCommitted, point],
      },
      output: {
        committed: [...state.allCommitted, point],
        pending: [],
      },
    };
  }

  // フィルタチェーンを通す
  let currentPoints: InputPoint[] = [point];
  const newFilterStates = [...state.filterStates];
  let finalCommitted: InputPoint[] = [];
  let finalPending: InputPoint[] = [];

  for (let i = 0; i < compiled.plugins.length; i++) {
    const plugin = compiled.plugins[i];
    const filterState = newFilterStates[i];

    // この段階での全入力点を処理
    let stageCommitted: InputPoint[] = [];
    let stagePending: InputPoint[] = [];
    let currentState = filterState;

    for (const p of currentPoints) {
      const result = plugin.process(currentState, p);
      currentState = result.state;
      stageCommitted = [...stageCommitted, ...result.committed];
      stagePending = [...result.pending]; // pendingは常に最新のものに置き換わる
    }

    newFilterStates[i] = currentState;

    // 最後のフィルタの場合
    if (i === compiled.plugins.length - 1) {
      finalCommitted = stageCommitted;
      finalPending = stagePending;
    } else {
      // 次のフィルタへの入力は、committed + pending
      currentPoints = [...stageCommitted, ...stagePending];
    }
  }

  const newAllCommitted = [...state.allCommitted, ...finalCommitted];

  return {
    state: {
      filterStates: newFilterStates,
      allCommitted: newAllCommitted,
    },
    output: {
      committed: newAllCommitted,
      pending: finalPending,
    },
  };
}

/**
 * パイプラインを終了し、残りの未確定点を確定する
 * ストローク終了時に呼び出す
 */
export function finalizePipeline(
  state: FilterPipelineState,
  compiled: CompiledFilterPipeline,
): FilterOutput {
  // フィルタがない場合：そのまま返す
  if (compiled.plugins.length === 0) {
    return {
      committed: state.allCommitted,
      pending: [],
    };
  }

  // 各フィルタをfinalize
  let currentCommitted: InputPoint[] = [];

  for (let i = 0; i < compiled.plugins.length; i++) {
    const plugin = compiled.plugins[i];
    const filterState = state.filterStates[i];

    const result = plugin.finalize(filterState);
    currentCommitted = [...currentCommitted, ...result.committed];
  }

  return {
    committed: [...state.allCommitted, ...currentCommitted],
    pending: [],
  };
}

/**
 * 全ての入力点を一括処理する（履歴リプレイ用）
 */
export function processAllPoints(
  points: readonly InputPoint[],
  compiled: CompiledFilterPipeline,
): InputPoint[] {
  let state = createFilterPipelineState(compiled);

  for (const point of points) {
    const result = processPoint(state, point, compiled);
    state = result.state;
  }

  const finalOutput = finalizePipeline(state, compiled);
  return [...finalOutput.committed];
}
