import { ChevronDown, ChevronRight } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";

interface AccordionPanelProps {
  title: string;
  badge?: string | number;
  defaultExpanded?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  children: ReactNode;
}

export function AccordionPanel({
  title,
  badge,
  defaultExpanded = true,
  isFirst = true,
  isLast = true,
  children,
}: AccordionPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const containerStyle: CSSProperties = {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius:
      isFirst && isLast
        ? 8
        : isFirst
          ? "8px 8px 0 0"
          : isLast
            ? "0 0 8px 8px"
            : 0,
    boxShadow: isFirst ? "0 2px 8px rgba(0,0,0,0.15)" : undefined,
    fontSize: 12,
    fontFamily: "monospace",
    overflow: "hidden",
  };

  const headerStyle: CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    border: "none",
    backgroundColor: "#333",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textAlign: "left",
  };

  return (
    <div style={containerStyle}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        style={headerStyle}
      >
        <span>
          {title}
          {badge !== undefined && ` (${badge})`}
        </span>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {isExpanded && <div style={{ padding: 8 }}>{children}</div>}
    </div>
  );
}
