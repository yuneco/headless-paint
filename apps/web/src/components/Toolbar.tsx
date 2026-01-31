import type { ToolType } from "../hooks/usePointerHandler";

interface ToolbarProps {
  currentTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onReset: () => void;
}

const tools: { type: ToolType; label: string; icon: string }[] = [
  { type: "pen", label: "Pen", icon: "✏️" },
  { type: "scroll", label: "Scroll", icon: "✋" },
  { type: "rotate", label: "Rotate", icon: "🔄" },
  { type: "zoom", label: "Zoom", icon: "🔍" },
];

export function Toolbar({ currentTool, onToolChange, onReset }: ToolbarProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: 8,
        backgroundColor: "#fff",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
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
