import { useCallback, useRef, useState } from "react";

const MAX_SAMPLES = 240;
const PUBLISH_INTERVAL_MS = 500;

export interface StrokeCallMetrics {
  readonly sampleCount: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface UseStrokeCallMetricsResult {
  readonly metrics: StrokeCallMetrics;
  readonly measure: (operation: () => void) => void;
  readonly flush: () => void;
  readonly reset: () => void;
}

const EMPTY_METRICS: StrokeCallMetrics = {
  sampleCount: 0,
  p50Ms: 0,
  p95Ms: 0,
  maxMs: 0,
};

export function useStrokeCallMetrics(): UseStrokeCallMetricsResult {
  const samplesRef = useRef<number[]>([]);
  const lastPublishedAtRef = useRef(0);
  const [metrics, setMetrics] = useState<StrokeCallMetrics>(EMPTY_METRICS);

  const measure = useCallback((operation: () => void) => {
    const start = performance.now();
    operation();
    const elapsed = performance.now() - start;
    const samples = samplesRef.current;
    samples.push(elapsed);
    if (samples.length > MAX_SAMPLES) samples.shift();
    const now = performance.now();
    if (now - lastPublishedAtRef.current >= PUBLISH_INTERVAL_MS) {
      lastPublishedAtRef.current = now;
      setMetrics(summarizeStrokeCallSamples(samples));
    }
  }, []);

  const flush = useCallback(() => {
    lastPublishedAtRef.current = performance.now();
    setMetrics(summarizeStrokeCallSamples(samplesRef.current));
  }, []);

  const reset = useCallback(() => {
    samplesRef.current = [];
    lastPublishedAtRef.current = 0;
    setMetrics(EMPTY_METRICS);
  }, []);

  return { metrics, measure, flush, reset };
}

export function summarizeStrokeCallSamples(
  samples: readonly number[],
): StrokeCallMetrics {
  if (samples.length === 0) return EMPTY_METRICS;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    sampleCount: samples.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index] ?? 0;
}
