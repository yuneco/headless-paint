import type { Command, HistoryState } from "@headless-paint/stroke";
import { isDrawCommand } from "@headless-paint/stroke";
import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";

function getCommandLabel(
  command: Command,
  layerIdToName: (layerId: string) => string,
): string {
  // wrap-shift はグローバル（レイヤープレフィックスなし）
  if (command.type === "wrap-shift") {
    return "Offset";
  }

  if (isDrawCommand(command)) {
    const name = layerIdToName(command.layerId);
    switch (command.type) {
      case "stroke":
        return command.compositeOperation === "destination-out"
          ? `${name} Eraser`
          : `${name} Stroke`;
      case "clear":
        return `${name} Clear`;
    }
  }

  // 構造コマンド
  switch (command.type) {
    case "add-layer":
      return "+ Layer";
    case "remove-layer":
      return "- Layer";
    case "reorder-layer":
      return "\u21D5 Layer";
    default:
      return "Unknown";
  }
}

interface HistoryEntry {
  index: number;
  command: Command;
  hasCheckpoint: boolean;
}

function getHistoryEntries(state: HistoryState): HistoryEntry[] {
  const checkpointIndices = new Set(
    state.checkpoints.map((cp) => cp.commandIndex),
  );
  return state.commands.map((command, index) => ({
    index,
    command,
    hasCheckpoint: checkpointIndices.has(index),
  }));
}

interface HistoryContentProps {
  historyState: HistoryState;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  layerIdToName: (layerId: string) => string;
}

export function HistoryContent({
  historyState,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  layerIdToName,
}: HistoryContentProps) {
  const entries = useMemo(
    () => getHistoryEntries(historyState),
    [historyState],
  );

  return (
    <>
      {/* Undo/Redo Buttons */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          style={{
            flex: 1,
            padding: 4,
            border: "none",
            borderRadius: 4,
            cursor: canUndo ? "pointer" : "not-allowed",
            backgroundColor: canUndo ? "#6c757d" : "#e9ecef",
            color: canUndo ? "#fff" : "#999",
          }}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          style={{
            flex: 1,
            padding: 4,
            border: "none",
            borderRadius: 4,
            cursor: canRedo ? "pointer" : "not-allowed",
            backgroundColor: canRedo ? "#6c757d" : "#e9ecef",
            color: canRedo ? "#fff" : "#999",
          }}
        >
          Redo
        </button>
      </div>

      {/* History List */}
      <div
        style={{
          maxHeight: 200,
          overflowY: "auto",
          border: "1px solid #ddd",
          borderRadius: 4,
        }}
      >
        {entries.length === 0 ? (
          <div style={{ padding: 8, color: "#999", textAlign: "center" }}>
            No history
          </div>
        ) : (
          entries.map((entry) => {
            const isCurrent = entry.index === historyState.currentIndex;
            const isAfterCurrent = entry.index > historyState.currentIndex;
            return (
              <div
                key={entry.index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  backgroundColor: isCurrent
                    ? "#007bff22"
                    : isAfterCurrent
                      ? "#f8f9fa"
                      : "transparent",
                  borderBottom: "1px solid #eee",
                  opacity: isAfterCurrent ? 0.5 : 1,
                }}
              >
                {/* Command Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.index + 1}.{" "}
                    {getCommandLabel(entry.command, layerIdToName)}
                  </div>
                </div>

                {/* Indicators */}
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  {entry.hasCheckpoint && (
                    <span
                      title="Checkpoint"
                      style={{ fontSize: 10, color: "#28a745" }}
                    >
                      CP
                    </span>
                  )}
                  {isCurrent && (
                    <ChevronLeft size={14} style={{ color: "#007bff" }} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

export function getHistoryEntryCount(historyState: HistoryState): number {
  return getHistoryEntries(historyState).length;
}
