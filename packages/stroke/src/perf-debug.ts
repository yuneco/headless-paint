type StrokePerfStageName =
  | "appendCommitted"
  | "processBatch"
  | "renderUpdateCallback"
  | "samplingLayerCopy";

interface StrokePerfDebugBridge {
  readonly enabled: boolean;
  readonly nullStages: { readonly nullFullCopy: boolean };
  beginBatch(
    pointCount: number,
    branchCount: number,
    kind?: "moveMany" | "strokeStart",
    ownerLabel?: string,
  ): void;
  endBatch(): void;
  recordStage(name: StrokePerfStageName, startedAt: number): void;
  recordSample(name: "samplingCopyPixels", value: number): void;
}

export function getBrushPerfDebug(): StrokePerfDebugBridge | undefined {
  return (
    globalThis as typeof globalThis & {
      __hpBrushPerf?: StrokePerfDebugBridge;
    }
  ).__hpBrushPerf;
}

export function perfStage<T>(name: StrokePerfStageName, operation: () => T): T {
  const perf = getBrushPerfDebug();
  if (!perf?.enabled) return operation();
  const startedAt = performance.now();
  const result = operation();
  perf.recordStage(name, startedAt);
  return result;
}

export function perfSample(name: "samplingCopyPixels", value: number): void {
  const perf = getBrushPerfDebug();
  if (!perf?.enabled) return;
  perf.recordSample(name, value);
}
