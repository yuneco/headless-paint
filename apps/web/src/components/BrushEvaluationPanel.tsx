import type { BrushConfig } from "@headless-paint/engine";
import { memo } from "react";
import type { StrokeCallMetrics } from "../hooks/useStrokeCallMetrics";

interface BrushEvaluationPanelProps {
  readonly brush: BrushConfig;
  readonly metrics: StrokeCallMetrics;
  readonly onResetMetrics: () => void;
}

function BrushEvaluationPanelComponent({
  brush,
  metrics,
  onResetMetrics,
}: BrushEvaluationPanelProps) {
  const mode = getEvaluationMode(brush);
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 11, lineHeight: 1.45 }}>
      <div
        style={{
          padding: 8,
          borderRadius: 5,
          background: mode === "other" ? "#f5f5f5" : "#eef6ff",
          color: "#344454",
        }}
      >
        {mode === "acrylic" && (
          <>
            <strong>Acrylic v2 / MIX（混色）</strong>
            <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>Penで赤青の境界と小さな色spotを下地に作る</li>
              <li>Acrylicで境界・spotを一方向に横切る</li>
              <li>同じ1stroke内で往復・交差する</li>
            </ol>
            <div style={{ marginTop: 5 }}>
              自色が残りつつ後方へ色を引くこと、接触前方へ色が漏れないこと、往復で直前の塗色を拾うことを確認します。
            </div>
          </>
        )}
        {mode === "bristle" && (
          <>
            <strong>Rough bristle / COMB（荒いハケ）</strong>
            <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>50〜120pxで遅いS字と速いS字を描く</li>
              <li>8の字、反復交差、短いzigzag折返しを描く</li>
              <li>25〜100% zoomで速く往復する</li>
            </ol>
            <div style={{ marginTop: 5 }}>
              面掠れと細い毛束が共存すること、継ぎ目・内周の直線化・掠れ線の分断が目立たないことを確認します。
            </div>
          </>
        )}
        {mode === "other" &&
          "AcrylicまたはRough bristleを選ぶと、統合評価の観点を表示します。"}
      </div>

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
      <div style={{ color: "#68727c" }}>
        {metrics.sampleCount}{" "}
        samples。入力callback内の同期engine時間です。画面合成やGPU完了時間は含みません。
      </div>
      <button type="button" onClick={onResetMetrics} style={{ padding: 5 }}>
        Reset metrics
      </button>
      <div style={{ color: "#68727c" }}>
        Undo / Redo後の見た目一致も確認してください。Rough
        bristle初期版は不透明paint専用です。
      </div>
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

function getEvaluationMode(
  brush: BrushConfig,
): "acrylic" | "bristle" | "other" {
  if (brush.type === "bristle") return "bristle";
  if (brush.type === "stamp" && brush.mixing?.enabled) return "acrylic";
  return "other";
}

export const BrushEvaluationPanel = memo(BrushEvaluationPanelComponent);
