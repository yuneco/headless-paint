import type { BrushConfig, StampBrushConfig } from "@headless-paint/engine";
import {
  AIRBRUSH,
  DEFAULT_BRUSH_DYNAMICS,
  MARKER,
  ROUND_PEN,
} from "@headless-paint/engine";

export interface BrushPresetEntry {
  readonly label: string;
  readonly config: BrushConfig;
}

const PENCIL_TEXTURED: StampBrushConfig = {
  type: "stamp",
  tip: { type: "image", imageId: "pencil-grain" },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.25,
    flow: 0.5,
    sizeJitter: 0.05,
    scatter: 0.03,
    rotationJitter: Math.PI * 0.2,
  },
};

const STAR_SCATTER: StampBrushConfig = {
  type: "stamp",
  tip: { type: "image", imageId: "star" },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.8,
    sizeJitter: 0.4,
    opacityJitter: 0.3,
    rotationJitter: Math.PI,
    scatter: 1.5,
    flow: 0.9,
  },
};

export const APP_BRUSH_PRESETS: readonly BrushPresetEntry[] = [
  { label: "Pen", config: ROUND_PEN },
  { label: "Airbrush", config: AIRBRUSH },
  { label: "Pencil", config: PENCIL_TEXTURED },
  { label: "Marker", config: MARKER },
  { label: "Star", config: STAR_SCATTER },
];
