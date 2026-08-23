import type { BrushConfig } from "@headless-paint/engine";
import { memo } from "react";
import type { StrokeCallMetrics } from "../hooks/useStrokeCallMetrics";
import { BristleGrainEvaluation } from "./BristleGrainEvaluation";

interface BrushEvaluationPanelProps {
  readonly brush: BrushConfig;
  readonly metrics: StrokeCallMetrics;
  readonly onResetMetrics: () => void;
  readonly onBrushChange: (brush: BrushConfig) => void;
  readonly onDrawBristleSCurve?: () => void;
}

function BrushEvaluationPanelComponent({
  brush,
  metrics,
  onResetMetrics,
  onBrushChange,
  onDrawBristleSCurve,
}: BrushEvaluationPanelProps) {
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
