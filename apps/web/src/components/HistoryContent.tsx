import {
  estimateMemoryUsage,
  generateThumbnailDataUrl,
  getCommandLabel,
  getHistoryEntries,
} from "@headless-paint/history";
import type { HistoryState } from "@headless-paint/history";
import { useMemo } from "react";

interface HistoryContentProps {
  historyState: HistoryState;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function HistoryContent({
  historyState,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: HistoryContentProps) {
  const entries = useMemo(
    () => getHistoryEntries(historyState),
    [historyState],
  );

  const memoryUsage = useMemo(
    () => estimateMemoryUsage(historyState),
    [historyState],
  );

  const thumbnails = useMemo(() => {
    const map: Record<number, string> = {};
    for (const checkpoint of historyState.checkpoints) {
      map[checkpoint.commandIndex] = generateThumbnailDataUrl(
        checkpoint.imageData,
        24,
        24,
      );
    }
    return map;
  }, [historyState.checkpoints]);

  const formatMemory = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      {/* Memory Usage */}
      <div
        style={{
          marginBottom: 8,
          padding: 6,
          backgroundColor: "#f8f9fa",
          borderRadius: 4,
        }}
      >
        <div>Memory: {memoryUsage.formatted}</div>
        <div style={{ color: "#666", fontSize: 10 }}>
          CP: {formatMemory(memoryUsage.checkpointsBytes)} / Cmd:{" "}
          {formatMemory(memoryUsage.commandsBytes)}
        </div>
      </div>

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
                {/* Thumbnail */}
                <div
                  style={{
                    width: 24,
                    height: 24,
                    backgroundColor: "#f0f0f0",
                    borderRadius: 2,
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  {entry.hasCheckpoint && thumbnails[entry.index] && (
                    <img
                      src={thumbnails[entry.index]}
                      alt=""
                      style={{ width: "100%", height: "100%" }}
                    />
                  )}
                </div>

                {/* Command Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.index + 1}. {getCommandLabel(entry.command)}
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
                  {isCurrent && <span style={{ color: "#007bff" }}>◀</span>}
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
