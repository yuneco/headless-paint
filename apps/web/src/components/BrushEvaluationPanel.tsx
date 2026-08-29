import type { BrushConfig } from "@headless-paint/engine";
import { memo } from "react";
import type { StrokeCallMetrics } from "../hooks/useStrokeCallMetrics";
import { BristleGrainEvaluation } from "./BristleGrainEvaluation";

type BrushPerfSnapshot = ReturnType<
  NonNullable<(typeof globalThis)["__hpBrushPerf"]>["snapshot"]
>;
type BrushPerfStall = BrushPerfSnapshot["stalls"][number];

interface BrushEvaluationPanelProps {
  readonly brush: BrushConfig;
  readonly metrics: StrokeCallMetrics;
  readonly onResetMetrics: () => void;
  readonly onBrushChange: (brush: BrushConfig) => void;
  readonly onDrawBristleSCurve?: () => void;
  readonly inputCaptureStatus: "idle" | "armed" | "capturing" | "captured";
  readonly inputCapturePointCount: number;
  readonly onArmInputCapture: () => void;
  readonly onCopyInputCapture?: () => void;
}

function BrushEvaluationPanelComponent({
  brush,
  metrics,
  onResetMetrics,
  onBrushChange,
  onDrawBristleSCurve,
  inputCaptureStatus,
  inputCapturePointCount,
  onArmInputCapture,
  onCopyInputCapture,
}: BrushEvaluationPanelProps) {
  const pressureSmoothingMs =
    brush.type === "stamp" ? (brush.pressureDynamics.smoothingMs ?? 0) : null;
  const perfDebug = globalThis.__hpBrushPerf;
  const stalls = perfDebug?.enabled ? perfDebug.snapshot().stalls : [];

  function copyStalls(): void {
    const currentStalls = globalThis.__hpBrushPerf?.snapshot().stalls ?? [];
    void navigator.clipboard.writeText(JSON.stringify(currentStalls, null, 2));
  }

  return (
    <div style={{ display: "grid", gap: 8, fontSize: 11, lineHeight: 1.45 }}>
      {brush.type === "bristle" && (
        <>
          <button
            type="button"
            onClick={onDrawBristleSCurve}
            disabled={!onDrawBristleSCurve}
            data-testid="draw-bristle-s-curve"
            style={{ width: "100%", padding: 7 }}
          >
            Draw Lab S-curve sample（Lab固定S字を描画）
          </button>
          <BristleGrainEvaluation brush={brush} onBrushChange={onBrushChange} />
        </>
      )}

      {brush.type === "stamp" && (
        <div style={{ display: "grid", gap: 5 }}>
          <div>
            Applied pressure smoothing: <strong>{pressureSmoothingMs}ms</strong>
          </div>
          <button
            type="button"
            onClick={onArmInputCapture}
            disabled={inputCaptureStatus === "capturing"}
            style={{ padding: 6 }}
          >
            {inputCaptureStatus === "armed"
              ? "Draw the next stroke（次の1本を描いてください）"
              : inputCaptureStatus === "capturing"
                ? "Capturing…"
                : "Capture next input stroke（次の実入力を採取）"}
          </button>
          {inputCaptureStatus === "captured" && (
            <button
              type="button"
              onClick={onCopyInputCapture}
              disabled={!onCopyInputCapture}
              style={{ padding: 6 }}
            >
              Copy captured JSON（{inputCapturePointCount} points）
            </button>
          )}
        </div>
      )}

      {perfDebug?.enabled && (
        <section
          data-testid="brush-perf-stalls"
          style={{
            display: "grid",
            gap: 5,
            padding: 6,
            border: "1px solid #d8dee4",
            borderRadius: 4,
            background: "#fff",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            <strong>Stalls ({stalls.length})</strong>
            <button type="button" onClick={copyStalls} style={{ padding: 4 }}>
              Copy JSON
            </button>
          </div>
          {stalls.length === 0 ? (
            <div style={{ color: "#68727c" }}>No stalls recorded</div>
          ) : (
            stalls.map((stall, index) => (
              <div
                // Timestamp remains stable while the ring buffer retains it.
                key={`${stall.timestampMs}-${index}`}
                style={{ overflowWrap: "anywhere" }}
              >
                {summarizeStall(stall)}
              </div>
            ))
          )}
        </section>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 4,
        }}
      >
        <Metric label="Call p50" value={metrics.p50Ms} />
        <Metric label="Call p95" value={metrics.p95Ms} emphasized />
        <Metric label="Call max" value={metrics.maxMs} />
      </div>
      <button type="button" onClick={onResetMetrics} style={{ padding: 5 }}>
        Reset metrics
      </button>
    </div>
  );
}

const STALL_STAGE_LABELS = {
  gpuUpload: "gpuUpload",
  gpuFieldUpdate: "fieldUpdate",
  gpuFlush: "gpuFlush",
  gpuCommit: "gpuCommit",
  checkpointReadback: "readback",
  dabDraw: "dabDraw",
  samplingLayerCopy: "samplingCopy",
  processBatch: "processBatch",
} as const;

function summarizeStall(stall: BrushPerfStall): string {
  const parts = [
    `${formatMs(stall.totalMs)}ms`,
    `${stall.pointCount}pt`,
    `${stall.branchCount}br`,
  ];
  const residency = stall.events.find((event) => event.name === "residency");
  if (residency?.hit !== undefined) {
    parts.push(`resident ${residency.hit ? "hit" : "miss"}`);
  }
  const uploadedBytes = stall.events.reduce(
    (total, event) =>
      event.name === "gpuUpload" ? total + (event.bytes ?? 0) : total,
    0,
  );
  if (uploadedBytes > 0) parts.push(`upload ${formatBytes(uploadedBytes)}`);
  for (const event of stall.events) {
    if (!event.name.startsWith("realloc:")) continue;
    const dimensions = [event.width, event.height, event.depth]
      .filter((value): value is number => value !== undefined)
      .join("x");
    parts.push(
      `realloc ${event.name.slice("realloc:".length)}${dimensions ? ` ${dimensions}` : ""}`,
    );
  }
  const commit = stall.events.reduce(
    (total, event) =>
      event.name === "gpuCommit"
        ? {
            passes: total.passes + (event.passes ?? 0),
            pixels: total.pixels + (event.pixels ?? 0),
          }
        : total,
    { passes: 0, pixels: 0 },
  );
  if (commit.passes > 0 || commit.pixels > 0) {
    parts.push(
      `commit ${commit.passes} ${commit.passes === 1 ? "pass" : "passes"} ${formatCount(commit.pixels)} px`,
    );
  }
  for (const [name, label] of Object.entries(STALL_STAGE_LABELS) as Array<
    [keyof typeof STALL_STAGE_LABELS, string]
  >) {
    const stage = stall.stages[name];
    if (stage.count > 0) {
      parts.push(`${label} ${stage.count}/${formatMs(stage.totalMs)}ms`);
    }
  }
  if (stall.gapMs !== null) parts.push(`gap ${formatMs(stall.gapMs)}ms`);
  return parts.join(" · ");
}

function formatMs(value: number): string {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1);
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${Number((value / (1024 * 1024)).toFixed(1))}MB`;
  }
  if (value >= 1024) return `${Number((value / 1024).toFixed(1))}KB`;
  return `${value}B`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}m`;
  }
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return value.toString();
}

function Metric({
  label,
  value,
  emphasized = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly emphasized?: boolean;
}) {
  const color = value > 33.3 ? "#b42318" : value > 16.7 ? "#9a6700" : "#176b3a";
  return (
    <div
      style={{
        padding: 5,
        border: emphasized ? `1px solid ${color}` : "1px solid #d8dee4",
        borderRadius: 4,
        background: emphasized ? `${color}10` : "#fff",
      }}
    >
      <div style={{ color: "#68727c", fontSize: 9 }}>{label}</div>
      <strong style={{ color }}>{value.toFixed(1)}ms</strong>
    </div>
  );
}

export const BrushEvaluationPanel = memo(BrushEvaluationPanelComponent);
