import type { BrushConfig, StampBrushConfig } from "@headless-paint/engine";
import { AIRBRUSH, MARKER, PENCIL, ROUND_PEN } from "@headless-paint/engine";

interface BrushPreset {
  readonly label: string;
  readonly config: BrushConfig;
}

const BRUSH_PRESETS: readonly BrushPreset[] = [
  { label: "Pen", config: ROUND_PEN },
  { label: "Airbrush", config: AIRBRUSH },
  { label: "Pencil", config: PENCIL },
  { label: "Marker", config: MARKER },
];

interface BrushPanelProps {
  readonly brush: BrushConfig;
  readonly onBrushChange: (brush: BrushConfig) => void;
}

function isSameBrush(a: BrushConfig, b: BrushConfig): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "round-pen") return true;
  const sa = a as StampBrushConfig;
  const sb = b as StampBrushConfig;
  return (
    sa.tip.type === sb.tip.type &&
    sa.dynamics.spacing === sb.dynamics.spacing &&
    sa.dynamics.flow === sb.dynamics.flow
  );
}

export function BrushPanel({ brush, onBrushChange }: BrushPanelProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 4,
      }}
    >
      {BRUSH_PRESETS.map((preset) => {
        const isActive = isSameBrush(brush, preset.config);
        return (
          <button
            key={preset.label}
            type="button"
            onClick={() => onBrushChange(preset.config)}
            style={{
              padding: "6px 8px",
              border: isActive ? "2px solid #007bff" : "1px solid #ccc",
              borderRadius: 4,
              backgroundColor: isActive ? "#007bff18" : "transparent",
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "monospace",
              textAlign: "center",
              color: isActive ? "#007bff" : "#333",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
