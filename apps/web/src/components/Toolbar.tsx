import type { Color } from "@headless-paint/engine";
import type { ToolType } from "../hooks/usePointerHandler";

function colorToHex(c: Color): string {
  const r = c.r.toString(16).padStart(2, "0");
  const g = c.g.toString(16).padStart(2, "0");
  const b = c.b.toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function hexToColor(hex: string): Color {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return { r, g, b, a: 255 };
}

interface ToolbarProps {
  currentTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onReset: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  color?: Color;
  onColorChange?: (color: Color) => void;
}

const tools: { type: ToolType; label: string; icon: string }[] = [
  { type: "pen", label: "Pen", icon: "✏️" },
  { type: "eraser", label: "Eraser", icon: "🧹" },
  { type: "scroll", label: "Scroll", icon: "✋" },
  { type: "rotate", label: "Rotate", icon: "🔄" },
  { type: "zoom", label: "Zoom", icon: "🔍" },
  { type: "offset", label: "Offset", icon: "↔" },
];

export function Toolbar({
  currentTool,
  onToolChange,
  onReset,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  color,
  onColorChange,
}: ToolbarProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: 8,
        backgroundColor: "#fff",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        alignItems: "center",
      }}
    >
      {tools.map(({ type, label, icon }) => (
        <button
          key={type}
          type="button"
          onClick={() => onToolChange(type)}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            backgroundColor: currentTool === type ? "#007bff" : "#e9ecef",
            color: currentTool === type ? "#fff" : "#333",
            fontWeight: currentTool === type ? "bold" : "normal",
          }}
          title={label}
        >
          {icon} {label}
        </button>
      ))}
      {onColorChange && color && (
        <input
          type="color"
          value={colorToHex(color)}
          onChange={(e) => onColorChange(hexToColor(e.target.value))}
          style={{
            width: 36,
            height: 36,
            padding: 2,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            backgroundColor: "transparent",
          }}
          title="Pen Color"
        />
      )}
      <div style={{ width: 1, backgroundColor: "#ddd", margin: "0 8px" }} />
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: 4,
            cursor: canUndo ? "pointer" : "not-allowed",
            backgroundColor: canUndo ? "#6c757d" : "#e9ecef",
            color: canUndo ? "#fff" : "#999",
          }}
          title="Undo (Cmd+Z)"
        >
          ↩ Undo
        </button>
      )}
      {onRedo && (
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: 4,
            cursor: canRedo ? "pointer" : "not-allowed",
            backgroundColor: canRedo ? "#6c757d" : "#e9ecef",
            color: canRedo ? "#fff" : "#999",
          }}
          title="Redo (Cmd+Shift+Z)"
        >
          ↪ Redo
        </button>
      )}
      <div style={{ width: 1, backgroundColor: "#ddd", margin: "0 8px" }} />
      <button
        type="button"
        onClick={onReset}
        style={{
          padding: "8px 16px",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
          backgroundColor: "#dc3545",
          color: "#fff",
        }}
        title="Reset View"
      >
        Reset
      </button>
    </div>
  );
}
