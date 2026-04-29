import { createLayer } from "@headless-paint/core";
import type {
  BackgroundSettings,
  BrushConfig,
  Color,
  ExpandConfig,
  Layer,
  LayerMeta,
  PressureCurve,
} from "@headless-paint/core";
import type { ViewTransform } from "@headless-paint/core";
import type { ToolType } from "./usePointerHandler";

export const PAINT_SNAPSHOT_VERSION = 1;

type Mat3Tuple = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface PaintPenSettingsSnapshot {
  readonly color: Color;
  readonly lineWidth: number;
  readonly pressureSensitivity: number;
  readonly pressureCurve: PressureCurve;
  readonly eraser: boolean;
  readonly brush: BrushConfig;
}

export interface PaintSmoothingSettingsSnapshot {
  readonly enabled: boolean;
  readonly windowSize: number;
}

export interface PaintSettingsSnapshot {
  readonly version: number;
  readonly tool: ToolType;
  readonly transform: Mat3Tuple;
  readonly background: BackgroundSettings;
  readonly pen: PaintPenSettingsSnapshot;
  readonly smoothing: PaintSmoothingSettingsSnapshot;
  readonly expand: ExpandConfig;
}

export interface ExportPaintSettingsInput {
  readonly tool: ToolType;
  readonly transform: ViewTransform;
  readonly background: BackgroundSettings;
  readonly pen: PaintPenSettingsSnapshot;
  readonly smoothing: PaintSmoothingSettingsSnapshot;
  readonly expand: ExpandConfig;
}

export interface PaintDocumentLayerSnapshot {
  readonly id: string;
  readonly meta: LayerMeta;
  readonly pngBytes: Uint8Array;
}

export interface PaintDocumentSnapshot {
  readonly version: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly activeLayerId: string | null;
  readonly layers: readonly PaintDocumentLayerSnapshot[];
}

export interface PaintDocumentLayerSource {
  readonly id: string;
  readonly committedLayer: Layer;
}

export interface ExportPaintDocumentInput {
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly activeLayerId: string | null;
  readonly entries: readonly PaintDocumentLayerSource[];
}

export interface PaintInitialLayer {
  readonly id: string;
  readonly meta: LayerMeta;
  readonly imageData: ImageData;
}

export interface PaintInitialDocument {
  readonly layers: readonly PaintInitialLayer[];
  readonly activeLayerId: string | null;
}

export function exportPaintSettings(
  input: ExportPaintSettingsInput,
): PaintSettingsSnapshot {
  return {
    version: PAINT_SNAPSHOT_VERSION,
    tool: input.tool,
    transform: [
      input.transform[0],
      input.transform[1],
      input.transform[2],
      input.transform[3],
      input.transform[4],
      input.transform[5],
      input.transform[6],
      input.transform[7],
      input.transform[8],
    ],
    background: {
      color: { ...input.background.color },
      visible: input.background.visible,
    },
    pen: {
      color: { ...input.pen.color },
      lineWidth: input.pen.lineWidth,
      pressureSensitivity: input.pen.pressureSensitivity,
      pressureCurve: { ...input.pen.pressureCurve },
      eraser: input.pen.eraser,
      brush: cloneBrushConfig(input.pen.brush),
    },
    smoothing: {
      enabled: input.smoothing.enabled,
      windowSize: input.smoothing.windowSize,
    },
    expand: cloneExpandConfig(input.expand),
  };
}

export function importPaintSettings(
  value: unknown,
): PaintSettingsSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== PAINT_SNAPSHOT_VERSION) return null;
  if (!isToolType(value.tool)) return null;
  if (!isMat3Tuple(value.transform)) return null;
  if (!isBackgroundSettings(value.background)) return null;
  if (!isRecord(value.pen)) return null;
  if (!isColor(value.pen.color)) return null;
  if (!isFiniteNumber(value.pen.lineWidth)) return null;
  if (!isFiniteNumber(value.pen.pressureSensitivity)) return null;
  if (!isPressureCurve(value.pen.pressureCurve)) return null;
  if (typeof value.pen.eraser !== "boolean") return null;
  if (!isBrushConfig(value.pen.brush)) return null;
  if (!isRecord(value.smoothing)) return null;
  if (typeof value.smoothing.enabled !== "boolean") return null;
  if (!isFiniteNumber(value.smoothing.windowSize)) return null;
  if (!isExpandConfig(value.expand)) return null;

  return {
    version: value.version,
    tool: value.tool,
    transform: [
      value.transform[0],
      value.transform[1],
      value.transform[2],
      value.transform[3],
      value.transform[4],
      value.transform[5],
      value.transform[6],
      value.transform[7],
      value.transform[8],
    ],
    background: {
      color: { ...value.background.color },
      visible: value.background.visible,
    },
    pen: {
      color: { ...value.pen.color },
      lineWidth: value.pen.lineWidth,
      pressureSensitivity: value.pen.pressureSensitivity,
      pressureCurve: { ...value.pen.pressureCurve },
      eraser: value.pen.eraser,
      brush: cloneBrushConfig(value.pen.brush),
    },
    smoothing: {
      enabled: value.smoothing.enabled,
      windowSize: value.smoothing.windowSize,
    },
    expand: cloneExpandConfig(value.expand),
  };
}

export async function exportPaintDocument(
  input: ExportPaintDocumentInput,
): Promise<PaintDocumentSnapshot> {
  const layers = await Promise.all(
    input.entries.map(async (entry) => ({
      id: entry.id,
      meta: cloneLayerMeta(entry.committedLayer.meta),
      pngBytes: await layerToPngBytes(entry.committedLayer),
    })),
  );

  return {
    version: PAINT_SNAPSHOT_VERSION,
    layerWidth: input.layerWidth,
    layerHeight: input.layerHeight,
    activeLayerId: input.activeLayerId,
    layers,
  };
}

export function parsePaintDocumentSnapshot(
  value: unknown,
): PaintDocumentSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== PAINT_SNAPSHOT_VERSION) return null;
  if (!isPositiveInteger(value.layerWidth)) return null;
  if (!isPositiveInteger(value.layerHeight)) return null;
  if (value.activeLayerId !== null && typeof value.activeLayerId !== "string") {
    return null;
  }
  if (!Array.isArray(value.layers)) return null;

  const layers: PaintDocumentLayerSnapshot[] = [];
  for (const layer of value.layers) {
    if (!isRecord(layer)) return null;
    if (typeof layer.id !== "string") return null;
    if (!isLayerMeta(layer.meta)) return null;
    if (!(layer.pngBytes instanceof Uint8Array)) return null;
    layers.push({
      id: layer.id,
      meta: cloneLayerMeta(layer.meta),
      pngBytes: new Uint8Array(layer.pngBytes),
    });
  }

  return {
    version: value.version,
    layerWidth: value.layerWidth,
    layerHeight: value.layerHeight,
    activeLayerId: value.activeLayerId,
    layers,
  };
}

export async function importPaintDocument(
  value: unknown,
): Promise<PaintInitialDocument | null> {
  const snapshot = parsePaintDocumentSnapshot(value);
  if (!snapshot) return null;
  if (snapshot.layers.length < 1) return null;
  if (typeof createImageBitmap !== "function") return null;

  const layers: PaintInitialLayer[] = [];
  for (const layer of snapshot.layers) {
    const imageData = await pngBytesToImageData(
      layer.pngBytes,
      snapshot.layerWidth,
      snapshot.layerHeight,
    );
    if (!imageData) return null;
    layers.push({
      id: layer.id,
      meta: cloneLayerMeta(layer.meta),
      imageData,
    });
  }

  return {
    layers,
    activeLayerId: resolveActiveLayerId(snapshot.activeLayerId, layers),
  };
}

export function createLayerFromInitialData(
  width: number,
  height: number,
  layer: PaintInitialLayer,
): Layer {
  const next = createLayer(width, height, layer.meta);
  next.ctx.putImageData(layer.imageData, 0, 0);
  (next as { id: string }).id = layer.id;
  return next;
}

async function layerToPngBytes(layer: Layer): Promise<Uint8Array> {
  const blob = await layer.canvas.convertToBlob({ type: "image/png" });
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

async function pngBytesToImageData(
  pngBytes: Uint8Array,
  width: number,
  height: number,
): Promise<ImageData | null> {
  try {
    const copied = new Uint8Array(pngBytes);
    const blob = new Blob([copied.buffer], { type: "image/png" });
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width !== width || bitmap.height !== height) {
      bitmap.close();
      return null;
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  }
}

function cloneLayerMeta(meta: LayerMeta): LayerMeta {
  return {
    name: meta.name,
    visible: meta.visible,
    opacity: meta.opacity,
    compositeOperation: meta.compositeOperation,
  };
}

function cloneBrushConfig(brush: BrushConfig): BrushConfig {
  if (brush.type === "round-pen") {
    return { type: "round-pen" };
  }
  const mixing = brush.mixing ? { ...brush.mixing } : undefined;
  if (brush.tip.type === "circle") {
    return {
      type: "stamp",
      tip: { type: "circle", hardness: brush.tip.hardness },
      dynamics: { ...brush.dynamics },
      mixing,
    };
  }
  return {
    type: "stamp",
    tip: { type: "image", imageId: brush.tip.imageId },
    dynamics: { ...brush.dynamics },
    mixing,
  };
}

function cloneExpandConfig(config: ExpandConfig): ExpandConfig {
  return {
    levels: config.levels.map((level) => ({
      mode: level.mode,
      offset: { x: level.offset.x, y: level.offset.y },
      angle: level.angle,
      divisions: level.divisions,
    })),
  };
}

function resolveActiveLayerId(
  activeLayerId: string | null,
  layers: readonly PaintInitialLayer[],
): string | null {
  if (activeLayerId && layers.some((layer) => layer.id === activeLayerId)) {
    return activeLayerId;
  }
  return layers[0]?.id ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isToolType(value: unknown): value is ToolType {
  return (
    value === "pen" ||
    value === "eraser" ||
    value === "scroll" ||
    value === "rotate" ||
    value === "zoom" ||
    value === "offset"
  );
}

function isMat3Tuple(value: unknown): value is Mat3Tuple {
  return (
    Array.isArray(value) &&
    value.length === 9 &&
    value.every((item) => isFiniteNumber(item))
  );
}

function isColor(value: unknown): value is Color {
  return (
    isRecord(value) &&
    isFiniteNumber(value.r) &&
    isFiniteNumber(value.g) &&
    isFiniteNumber(value.b) &&
    isFiniteNumber(value.a)
  );
}

function isPressureCurve(value: unknown): value is PressureCurve {
  return (
    isRecord(value) && isFiniteNumber(value.y1) && isFiniteNumber(value.y2)
  );
}

function isBackgroundSettings(value: unknown): value is BackgroundSettings {
  return (
    isRecord(value) &&
    isColor(value.color) &&
    typeof value.visible === "boolean"
  );
}

function isBrushConfig(value: unknown): value is BrushConfig {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "round-pen") return true;
  if (
    value.type !== "stamp" ||
    !isRecord(value.tip) ||
    !isRecord(value.dynamics)
  ) {
    return false;
  }

  const tip = value.tip;
  const tipValid =
    (tip.type === "circle" && isFiniteNumber(tip.hardness)) ||
    (tip.type === "image" && typeof tip.imageId === "string");
  if (!tipValid) return false;

  const dynamics = value.dynamics;
  if (
    !(
      isFiniteNumber(dynamics.spacing) &&
      isFiniteNumber(dynamics.flow) &&
      isFiniteNumber(dynamics.opacityJitter) &&
      isFiniteNumber(dynamics.sizeJitter) &&
      isFiniteNumber(dynamics.rotationJitter) &&
      isFiniteNumber(dynamics.scatter)
    )
  ) {
    return false;
  }

  if (value.mixing !== undefined) {
    if (!isRecord(value.mixing)) return false;
    if (
      typeof value.mixing.enabled !== "boolean" ||
      !isFiniteNumber(value.mixing.pickup) ||
      !isFiniteNumber(value.mixing.restore)
    ) {
      return false;
    }
  }

  return true;
}

function isExpandConfig(value: unknown): value is ExpandConfig {
  if (!isRecord(value) || !Array.isArray(value.levels)) return false;
  return value.levels.every((level) => {
    if (!isRecord(level) || !isRecord(level.offset)) return false;
    return (
      (level.mode === "none" ||
        level.mode === "axial" ||
        level.mode === "radial" ||
        level.mode === "kaleidoscope") &&
      isFiniteNumber(level.offset.x) &&
      isFiniteNumber(level.offset.y) &&
      isFiniteNumber(level.angle) &&
      isFiniteNumber(level.divisions)
    );
  });
}

function isLayerMeta(value: unknown): value is LayerMeta {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.visible === "boolean" &&
    isFiniteNumber(value.opacity) &&
    (value.compositeOperation === undefined ||
      typeof value.compositeOperation === "string")
  );
}
