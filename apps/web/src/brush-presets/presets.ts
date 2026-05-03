import type { BrushConfig, StampBrushConfig } from "@headless-paint/engine";
import {
  AIRBRUSH,
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_DYNAMICS,
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
    spacing: 0.2,
    flow: 0.45,
    sizeJitter: 0.04,
    scatter: 0.025,
    rotationJitter: Math.PI * 0.2,
  },
  pressureDynamics: { size: 1, flow: 0 },
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
  pressureDynamics: { ...DEFAULT_PRESSURE_DYNAMICS, flow: 0.4 },
};

const ACRYLIC: StampBrushConfig = {
  type: "stamp",
  tip: { type: "circle", hardness: 0.78 },
  dynamics: {
    ...DEFAULT_BRUSH_DYNAMICS,
    spacing: 0.12,
    flow: 0.72,
  },
  pressureDynamics: { size: 0.3, flow: 0.4 },
  mixing: {
    ...DEFAULT_BRUSH_MIXING,
    enabled: true,
    pickup: 0.28,
    restore: 0.08,
  },
};

export const APP_BRUSH_PRESETS: readonly BrushPresetEntry[] = [
  { label: "Pen", config: ROUND_PEN },
  { label: "Airbrush", config: AIRBRUSH },
  { label: "Pencil", config: PENCIL_TEXTURED },
  { label: "Acrylic", config: ACRYLIC },
  { label: "Star", config: STAR_SCATTER },
];
