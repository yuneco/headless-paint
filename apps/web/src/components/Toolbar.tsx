import type { Color } from "@headless-paint/engine";
import type { ToolType } from "@headless-paint/react";
import {
  ArrowLeftRight,
  Eraser,
  Hand,
  Pen,
  Redo2,
  RotateCw,
  Undo2,
  ZoomIn,
} from "lucide-react";
import type { ComponentType } from "react";

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
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  color?: Color;
  onColorChange?: (color: Color) => void;
}

const tools: {
  type: ToolType;
  label: string;
  icon: ComponentType<{ size?: number }>;
}[] = [
  { type: "pen", label: "Pen", icon: Pen },
  { type: "eraser", label: "Eraser", icon: Eraser },
  { type: "scroll", label: "Scroll", icon: Hand },
  { type: "rotate", label: "Rotate", icon: RotateCw },
  { type: "zoom", label: "Zoom", icon: ZoomIn },
  { type: "offset", label: "Offset", icon: ArrowLeftRight },
];

export function Toolbar({
  currentTool,
  onToolChange,
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
        gap: 2,
        padding: 2,
        backgroundColor: "#fff",
        borderRadius: 4,
        alignItems: "center",
      }}
    >
      {tools.map(({ type, label, icon: Icon }) => (
        <button
          key={type}
          type="button"
          onClick={() => onToolChange(type)}
          style={{
            padding: 6,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            backgroundColor: currentTool === type ? "#007bff" : "#e9ecef",
            color: currentTool === type ? "#fff" : "#333",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title={label}
          aria-label={label}
        >
          <Icon size={16} />
        </button>
      ))}
      {onColorChange && color && (
        <input
          type="color"
          value={colorToHex(color)}
          onChange={(e) => onColorChange(hexToColor(e.target.value))}
          style={{
            width: 28,
            height: 28,
            padding: 2,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            backgroundColor: "transparent",
          }}
          title="Pen Color"
        />
      )}
      <div
        style={{
          width: 1,
          height: 20,
          backgroundColor: "#ddd",
          margin: "0 2px",
        }}
      />
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          style={{
            padding: 6,
            border: "none",
            borderRadius: 4,
            cursor: canUndo ? "pointer" : "not-allowed",
            backgroundColor: canUndo ? "#6c757d" : "#e9ecef",
            color: canUndo ? "#fff" : "#999",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Undo (Cmd+Z)"
          aria-label="Undo"
        >
          <Undo2 size={16} />
        </button>
      )}
      {onRedo && (
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          style={{
            padding: 6,
            border: "none",
            borderRadius: 4,
            cursor: canRedo ? "pointer" : "not-allowed",
            backgroundColor: canRedo ? "#6c757d" : "#e9ecef",
            color: canRedo ? "#fff" : "#999",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Redo (Cmd+Shift+Z)"
          aria-label="Redo"
        >
          <Redo2 size={16} />
        </button>
      )}
    </div>
  );
}
