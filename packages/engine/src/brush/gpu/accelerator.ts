import type { Layer } from "../../types";
import { brushPerfDebug } from "../perf-debug";
import {
  registerGpuLayerResidency,
  unregisterGpuLayerResidency,
} from "./gpu-layer-residency";
import {
  type GpuStrokeSurface,
  createGpuStrokeSurface,
} from "./gpu-stroke-surface";

const DEFAULT_MAX_BRANCHES = 64;

export type BrushAcceleratorBackend = "auto" | "webgl2" | "cpu";

export interface BrushAcceleratorOptions {
  readonly backend?: BrushAcceleratorBackend;
  readonly maxBranches?: number;
  readonly resident?: boolean;
}

export interface BrushAccelerator {
  readonly backend: "webgl2";
  warmUp(layer: Layer): void;
  invalidate(layer: Layer): void;
  dispose(): void;
}

interface LayerResidency {
  readonly surface: GpuStrokeSurface;
  readonly width: number;
  readonly height: number;
  valid: boolean;
}

interface RollbackRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Internal runtime contract. It is intentionally absent from the public type. */
interface BrushAcceleratorRuntime extends BrushAccelerator {
  supportsBranchCount(branchCount: number): boolean;
  beginStroke(
    owner: object,
    layer: Layer,
    sourceCanvas?: OffscreenCanvas,
    branchCount?: number,
  ): boolean;
  enter(owner: object): void;
  leave(owner: object): void;
  commitToLayer(owner: object, layer: Layer): void;
  restoreStrokeLayer(owner: object, layer: Layer): boolean;
  endStroke(owner: object): void;
  isStrokeLost(owner: object): boolean;
  isLayerResident(layer: Layer): boolean;
  getActiveSurface(): GpuStrokeSurface | null;
  readMaterialFieldForTest(branchIndex: number): Uint8ClampedArray | null;
}

export function isWebKitUserAgent(userAgent: string): boolean {
  return (
    /AppleWebKit/i.test(userAgent) &&
    !/(?:Chrome|Chromium|CriOS|Edg|EdgiOS|EdgA|Firefox|FxiOS)/i.test(userAgent)
  );
}

export function createBrushAccelerator(
  options: BrushAcceleratorOptions = {},
): BrushAccelerator | null {
  const backend = options.backend ?? "auto";
  if (backend === "cpu") return null;
  if (
    backend === "auto" &&
    (typeof navigator === "undefined" ||
      !isWebKitUserAgent(navigator.userAgent))
  ) {
    return null;
  }

  const surface = createGpuStrokeSurface(1, 1);
  if (!surface) return null;
  return new WebGl2BrushAccelerator(surface, options);
}

export function getBrushAcceleratorRuntime(
  accelerator: BrushAccelerator | null | undefined,
): BrushAcceleratorRuntime | null {
  return accelerator instanceof WebGl2BrushAccelerator ? accelerator : null;
}

export function getActiveGpuStrokeSurface(
  accelerator: BrushAccelerator | null | undefined,
): GpuStrokeSurface | null {
  return getBrushAcceleratorRuntime(accelerator)?.getActiveSurface() ?? null;
}

class WebGl2BrushAccelerator implements BrushAcceleratorRuntime {
  readonly backend = "webgl2" as const;

  private surface: GpuStrokeSurface | null;
  private readonly maxBranches: number;
  private readonly resident: boolean;
  private readonly residencies = new WeakMap<Layer, LayerResidency>();
  private residentLayer: Layer | null = null;
  private activeOwner: object | null = null;
  private currentOwner: object | null = null;
  private activeSurface: GpuStrokeSurface | null = null;
  private activeLayer: Layer | null = null;
  private rollbackCanvas: OffscreenCanvas | null = null;
  private rollbackContext: OffscreenCanvasRenderingContext2D | null = null;
  private activeRollbackRects: RollbackRect[] | null = null;
  private recoverableOwner: object | null = null;
  private disposed = false;
  private permanentlyUnavailable = false;

  constructor(surface: GpuStrokeSurface, options: BrushAcceleratorOptions) {
    this.surface = surface;
    this.maxBranches = sanitizeMaxBranches(options.maxBranches);
    this.resident = options.resident ?? true;
  }

  warmUp(layer: Layer): void {
    if (this.disposed || this.activeOwner) return;
    const surface = this.acquireSurface(layer.width, layer.height);
    if (!surface) return;
    try {
      surface.beginStroke(layer.canvas, 1);
      surface.endStroke();
      this.validateResidency(layer, surface);
    } catch {
      this.invalidate(layer);
    }
  }

  invalidate(layer: Layer): void {
    const residency = this.residencies.get(layer);
    if (residency) residency.valid = false;
    if (this.residentLayer === layer) this.residentLayer = null;
    unregisterGpuLayerResidency(layer, this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.activeOwner) {
      this.activeSurface?.endStroke();
      if (this.activeLayer && this.activeRollbackRects) {
        this.restoreActiveRollback(this.activeLayer);
        this.recoverableOwner = this.activeOwner;
      }
    }
    if (this.activeLayer) this.invalidate(this.activeLayer);
    this.activeOwner = null;
    this.currentOwner = null;
    this.activeSurface = null;
    this.activeLayer = null;
    this.activeRollbackRects = null;
    if (this.residentLayer) this.invalidate(this.residentLayer);
    this.surface?.dispose();
    this.surface = null;
    this.rollbackCanvas = null;
    this.rollbackContext = null;
  }

  supportsBranchCount(branchCount: number): boolean {
    return (
      !this.disposed &&
      !this.permanentlyUnavailable &&
      Number.isSafeInteger(branchCount) &&
      branchCount >= 1 &&
      branchCount <= this.maxBranches &&
      branchCount <= (this.surface?.maxBranchCount ?? DEFAULT_MAX_BRANCHES)
    );
  }

  beginStroke(
    owner: object,
    layer: Layer,
    sourceCanvas?: OffscreenCanvas,
    branchCount = 1,
  ): boolean {
    if (!this.supportsBranchCount(branchCount)) return false;
    if (this.activeOwner && this.activeOwner !== owner) {
      if (brushPerfDebug.enabled) {
        brushPerfDebug.recordEvent("gpuStaleOwnerRecovered", {});
      }
      this.activeSurface?.endStroke();
      if (this.activeLayer) this.invalidate(this.activeLayer);
      this.activeOwner = null;
      this.currentOwner = null;
      this.activeSurface = null;
      this.activeLayer = null;
      this.activeRollbackRects = null;
      this.recoverableOwner = null;
    }
    if (this.activeOwner) return false;

    const surface = this.acquireSurface(layer.width, layer.height);
    if (!surface || surface.lost) return false;
    const residencyHit = this.resident && this.prepareResidency(layer, surface);
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordSample("gpuResidencyHit", residencyHit ? 1 : 0);
      brushPerfDebug.recordSample("gpuBranches", branchCount);
      brushPerfDebug.recordEvent("residency", { hit: residencyHit });
    }
    if (!residencyHit && !sourceCanvas) return false;
    try {
      surface.beginStroke(residencyHit ? undefined : sourceCanvas, branchCount);
    } catch {
      this.invalidate(layer);
      if (surface.lost) this.permanentlyUnavailable = true;
      return false;
    }
    this.validateResidency(layer, surface);
    this.activeOwner = owner;
    this.activeSurface = surface;
    this.activeLayer = layer;
    this.activeRollbackRects = residencyHit ? [] : null;
    this.recoverableOwner = null;
    return true;
  }

  enter(owner: object): void {
    if (this.activeOwner === owner) this.currentOwner = owner;
  }

  leave(owner: object): void {
    if (this.currentOwner === owner) this.currentOwner = null;
  }

  commitToLayer(owner: object, layer: Layer): void {
    if (this.activeOwner !== owner) return;
    try {
      this.activeSurface?.commitToLayer(
        layer,
        this.activeRollbackRects
          ? (left, top, width, height) => {
              this.captureRollbackTile(layer, {
                left,
                top,
                right: left + width,
                bottom: top + height,
              });
            }
          : undefined,
      );
    } catch {
      this.invalidate(layer);
      return;
    }
    if (this.activeSurface && !this.activeSurface.lost) {
      this.validateResidency(layer, this.activeSurface);
    } else {
      this.invalidate(layer);
      this.permanentlyUnavailable = true;
    }
  }

  restoreStrokeLayer(owner: object, layer: Layer): boolean {
    if (this.recoverableOwner === owner) return true;
    if (this.activeOwner !== owner || !this.activeRollbackRects) return false;
    this.restoreActiveRollback(layer);
    return true;
  }

  endStroke(owner: object): void {
    if (this.activeOwner !== owner) {
      if (this.recoverableOwner === owner) this.recoverableOwner = null;
      return;
    }
    const lost = this.activeSurface?.lost ?? false;
    this.activeSurface?.endStroke();
    if (lost && this.activeLayer) this.invalidate(this.activeLayer);
    this.activeOwner = null;
    this.currentOwner = null;
    this.activeSurface = null;
    this.activeLayer = null;
    this.activeRollbackRects = null;
    this.recoverableOwner = null;
  }

  isStrokeLost(owner: object): boolean {
    if (this.activeOwner !== owner) return true;
    const lost = this.activeSurface?.lost ?? true;
    if (lost) {
      this.permanentlyUnavailable = true;
      if (this.activeLayer) this.invalidate(this.activeLayer);
    }
    return lost;
  }

  isLayerResident(layer: Layer): boolean {
    if (!this.resident || this.disposed || this.permanentlyUnavailable) {
      return false;
    }
    const surface = this.acquireSurface(layer.width, layer.height);
    return surface ? this.prepareResidency(layer, surface) : false;
  }

  getActiveSurface(): GpuStrokeSurface | null {
    return this.currentOwner === this.activeOwner ? this.activeSurface : null;
  }

  readMaterialFieldForTest(branchIndex: number): Uint8ClampedArray | null {
    return this.activeSurface?.readMaterialFieldForTest(branchIndex) ?? null;
  }

  private captureRollbackTile(layer: Layer, tile: RollbackRect): void {
    const savedRects = this.activeRollbackRects;
    if (!savedRects) return;
    const uncoveredRects = savedRects.reduce<RollbackRect[]>(
      (rects, saved) => rects.flatMap((rect) => subtractRect(rect, saved)),
      [tile],
    );
    if (uncoveredRects.length === 0) return;
    const context = this.acquireRollbackContext(layer.width, layer.height);
    for (const rect of uncoveredRects) {
      copyCanvasRect(layer.canvas, context, rect);
      savedRects.push(rect);
    }
  }

  private restoreActiveRollback(layer: Layer): void {
    const rects = this.activeRollbackRects;
    const canvas = this.rollbackCanvas;
    if (!rects || rects.length === 0 || !canvas) return;
    for (const rect of rects) copyCanvasRect(canvas, layer.ctx, rect);
    this.invalidate(layer);
    rects.length = 0;
  }

  private acquireRollbackContext(
    width: number,
    height: number,
  ): OffscreenCanvasRenderingContext2D {
    if (
      this.rollbackCanvas?.width === width &&
      this.rollbackCanvas.height === height &&
      this.rollbackContext
    ) {
      return this.rollbackContext;
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Failed to create GPU rollback context");
    this.rollbackCanvas = canvas;
    this.rollbackContext = context;
    return context;
  }

  private acquireSurface(
    width: number,
    height: number,
  ): GpuStrokeSurface | null {
    if (this.disposed || this.permanentlyUnavailable) return null;
    if (this.surface?.lost) {
      this.permanentlyUnavailable = true;
      return null;
    }
    if (this.surface?.width === width && this.surface.height === height) {
      return this.surface;
    }
    this.surface?.dispose();
    this.surface = createGpuStrokeSurface(width, height);
    if (!this.surface) {
      this.permanentlyUnavailable = true;
      return null;
    }
    if (this.residentLayer) this.invalidate(this.residentLayer);
    return this.surface;
  }

  private prepareResidency(layer: Layer, surface: GpuStrokeSurface): boolean {
    const residency = this.residencies.get(layer);
    return (
      this.residentLayer === layer &&
      residency?.valid === true &&
      residency.surface === surface &&
      residency.width === layer.width &&
      residency.height === layer.height &&
      surface.width === layer.width &&
      surface.height === layer.height
    );
  }

  private validateResidency(layer: Layer, surface: GpuStrokeSurface): void {
    if (this.residentLayer && this.residentLayer !== layer) {
      this.invalidate(this.residentLayer);
    }
    this.residentLayer = layer;
    this.residencies.set(layer, {
      surface,
      valid: true,
      width: layer.width,
      height: layer.height,
    });
    registerGpuLayerResidency(layer, this);
  }
}

function sanitizeMaxBranches(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_BRANCHES;
  }
  return Math.max(1, Math.min(DEFAULT_MAX_BRANCHES, Math.floor(value)));
}

function subtractRect(
  rect: RollbackRect,
  covered: RollbackRect,
): RollbackRect[] {
  const left = Math.max(rect.left, covered.left);
  const top = Math.max(rect.top, covered.top);
  const right = Math.min(rect.right, covered.right);
  const bottom = Math.min(rect.bottom, covered.bottom);
  if (right <= left || bottom <= top) return [rect];

  const remainder: RollbackRect[] = [];
  if (rect.top < top) {
    remainder.push({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: top,
    });
  }
  if (bottom < rect.bottom) {
    remainder.push({
      left: rect.left,
      top: bottom,
      right: rect.right,
      bottom: rect.bottom,
    });
  }
  if (rect.left < left) {
    remainder.push({ left: rect.left, top, right: left, bottom });
  }
  if (right < rect.right) {
    remainder.push({ left: right, top, right: rect.right, bottom });
  }
  return remainder;
}

function copyCanvasRect(
  source: OffscreenCanvas,
  target: OffscreenCanvasRenderingContext2D,
  rect: RollbackRect,
): void {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  target.save();
  target.globalAlpha = 1;
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.beginPath();
  target.rect(rect.left, rect.top, width, height);
  target.clip();
  target.globalCompositeOperation = "copy";
  target.drawImage(
    source,
    rect.left,
    rect.top,
    width,
    height,
    rect.left,
    rect.top,
    width,
    height,
  );
  target.restore();
}
