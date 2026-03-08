import type { BackgroundSettings } from "@headless-paint/engine";
import type { LayerEntry } from "@headless-paint/react";
import { ArrowDown, ArrowUp, Circle, Eye, EyeOff, Trash2 } from "lucide-react";
import { memo } from "react";

const BLEND_MODES: readonly {
  readonly value: string;
  readonly label: string;
}[] = [
  { value: "", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "color-burn", label: "Color Burn" },
  { value: "hard-light", label: "Hard Light" },
  { value: "soft-light", label: "Soft Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

interface LayerPanelProps {
  entries: readonly LayerEntry[];
  activeLayerId: string | null;
  background: BackgroundSettings;
  onSelectLayer: (id: string) => void;
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleBackground: () => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onSetOpacity: (layerId: string, opacity: number) => void;
  onSetBlendMode: (
    layerId: string,
    blendMode: GlobalCompositeOperation | undefined,
  ) => void;
  onTransform?: (layerId: string) => void;
}

function LayerPanelComponent({
  entries,
  activeLayerId,
  background,
  onSelectLayer,
  onAddLayer,
  onRemoveLayer,
  onToggleVisibility,
  onToggleBackground,
  onMoveUp,
  onMoveDown,
  onSetOpacity,
  onSetBlendMode,
  onTransform,
}: LayerPanelProps) {
  // 表示順: 上=前面（配列の逆順）
  const reversedEntries = [...entries].reverse();
  const activeEntry = entries.find((e) => e.id === activeLayerId);

  return (
    <div>
      {/* Active Layer Controls */}
      {activeEntry && (
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 4,
            alignItems: "center",
            fontSize: 11,
          }}
        >
          <select
            value={activeEntry.committedLayer.meta.compositeOperation ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              onSetBlendMode(
                activeEntry.id,
                val === "" ? undefined : (val as GlobalCompositeOperation),
              );
            }}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              padding: "2px 4px",
              border: "1px solid #ccc",
              borderRadius: 3,
            }}
          >
            {BLEND_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(activeEntry.committedLayer.meta.opacity * 100)}
            onChange={(e) => {
              onSetOpacity(activeEntry.id, Number(e.target.value) / 100);
            }}
            style={{ width: 64 }}
            title="Opacity"
          />
          <span style={{ width: 28, textAlign: "right" }}>
            {Math.round(activeEntry.committedLayer.meta.opacity * 100)}%
          </span>
          {onTransform && (
            <button
              type="button"
              onClick={() => onTransform(activeEntry.id)}
              style={{
                padding: "2px 6px",
                fontSize: 10,
                border: "1px solid #ccc",
                borderRadius: 3,
                backgroundColor: "#fff",
                cursor: "pointer",
              }}
              title="Transform layer"
            >
              T
            </button>
          )}
        </div>
      )}

      {/* Add Layer Button */}
      <button
        type="button"
        onClick={onAddLayer}
        style={{
          width: "100%",
          padding: "4px 8px",
          marginBottom: 4,
          border: "1px dashed #aaa",
          borderRadius: 4,
          backgroundColor: "transparent",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        + Add Layer
      </button>

      {/* Layer List */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {reversedEntries.map((entry, i) => {
          const isActive = entry.id === activeLayerId;
          const isFirst = i === 0;
          const isLast = i === reversedEntries.length - 1 && !background;
          const canMoveUp = entries.indexOf(entry) < entries.length - 1;
          const canMoveDown = entries.indexOf(entry) > 0;

          return (
            <div
              key={entry.id}
              onClick={() => onSelectLayer(entry.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  onSelectLayer(entry.id);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                backgroundColor: isActive ? "#007bff22" : "transparent",
                borderBottom: isLast ? "none" : "1px solid #eee",
                cursor: "pointer",
              }}
            >
              {/* Active indicator */}
              <span
                style={{
                  width: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#007bff",
                }}
              >
                {isActive && <Circle size={8} fill="currentColor" />}
              </span>

              {/* Layer name */}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.committedLayer.meta.name}
              </span>

              {/* Visibility toggle */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(entry.id);
                }}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                  opacity: entry.committedLayer.meta.visible ? 1 : 0.3,
                }}
                title={entry.committedLayer.meta.visible ? "Hide" : "Show"}
              >
                {entry.committedLayer.meta.visible ? (
                  <Eye size={14} />
                ) : (
                  <EyeOff size={14} />
                )}
              </button>

              {/* Move Up */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp(entry.id);
                }}
                disabled={!canMoveUp}
                style={{
                  border: "none",
                  background: "none",
                  cursor: canMoveUp ? "pointer" : "default",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                  opacity: canMoveUp ? 1 : 0.3,
                }}
                title="Move up"
              >
                <ArrowUp size={12} />
              </button>

              {/* Move Down */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown(entry.id);
                }}
                disabled={!canMoveDown}
                style={{
                  border: "none",
                  background: "none",
                  cursor: canMoveDown ? "pointer" : "default",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                  opacity: canMoveDown ? 1 : 0.3,
                }}
                title="Move down"
              >
                <ArrowDown size={12} />
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveLayer(entry.id);
                }}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                }}
                title="Delete layer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}

        {/* Background row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            backgroundColor: "#f8f9fa",
          }}
        >
          <span style={{ width: 12 }} />
          <span style={{ flex: 1, color: "#666" }}>Background</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleBackground();
            }}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: 2,
              display: "flex",
              alignItems: "center",
              opacity: background.visible ? 1 : 0.3,
            }}
            title={background.visible ? "Hide background" : "Show background"}
          >
            {background.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export const LayerPanel = memo(LayerPanelComponent);
