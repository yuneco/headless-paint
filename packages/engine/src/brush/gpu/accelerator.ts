import type { Layer } from "../../types";
import { brushPerfDebug, perfMark, perfSample } from "../perf-debug";
import {
  registerGpuLayerResidency,
  unregisterGpuLayerResidency,
} from "./gpu-layer-residency";
import {
  type BristleFieldCadence,
  type GpuStrokeSurface,
  createGpuStrokeSurface,
} from "./gpu-stroke-surface";

const DEFAULT_MAX_BRANCHES = 64;

export type BrushAcceleratorBackend = "auto" | "webgl2" | "cpu";

export type GpuResidencyInvalidationReason =
  | "acceleratorReplaced"
  | "checkpointRestore"
  | "clearLayer"
  | "contextLost"
  | "copyLayerPixels"
  | "cpuBrush"
  | "dispose"
  | "drawPath"
  | "executorRedo"
  | "executorUndo"
  | "external"
  | "mergeLayerDown"
  | "replayFailure"
  | "residentLayerSwitch"
  | "runtimeRestore"
  | "setPixel"
  | "staleOwnerRecovery"
  | "surfaceResize"
  | "transformLayer"
  | "warmUpFailure"
  | "wrapShift";

export type GpuStrokeOwnerLabel = "live" | "replay" | "rebuild";

export interface BrushAcceleratorOptions {
  readonly backend?: BrushAcceleratorBackend;
  readonly maxBranches?: number;
  readonly resident?: boolean;
  readonly commitMode?: "bitmap" | "direct";
}

export interface BrushAcceleratorResolution {
  readonly backend: "webgl2" | "cpu";
  readonly reason: string;
}

export interface BrushAccelerator {
  readonly backend: "webgl2";
  warmUp(layer: Layer): void;
  invalidate(layer: Layer, reason?: GpuResidencyInvalidationReason): void;
  dispose(): void;
}

interface LayerResidency {
  readonly surface: GpuStrokeSurface;
  readonly width: number;
  readonly height: number;
  valid: boolean;
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
  cancelStroke(owner: object): boolean;
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

export function resolveBrushAcceleratorBackend(
  options: BrushAcceleratorOptions = {},
  env: {
    readonly userAgent?: string;
    readonly webgl2Available?: () => boolean;
  } = {},
): BrushAcceleratorResolution {
  const backend = options.backend ?? "auto";
  if (backend === "cpu") {
    return { backend: "cpu", reason: "cpu: setting" };
  }

  const userAgent =
    env.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (backend === "auto" && !isWebKitUserAgent(userAgent)) {
    return { backend: "cpu", reason: "auto: not webkit" };
  }

  const webgl2Available = env.webgl2Available ?? probeWebGl2Availability;
  if (!webgl2Available()) {
    return { backend: "cpu", reason: "webgl2: unavailable" };
  }

  return {
    backend: "webgl2",
    reason: backend === "auto" ? "auto: webkit" : "webgl2: setting",
  };
}

export function createBrushAccelerator(
  options: BrushAcceleratorOptions = {},
): BrushAccelerator | null {
  let surface: GpuStrokeSurface | null = null;
  const commitMode = options.commitMode ?? "bitmap";
  const bristleFieldCadence = readBristleFieldCadenceDebugFlag();
  const resolution = resolveBrushAcceleratorBackend(options, {
    webgl2Available: () => {
      surface = createSurface(1, 1, commitMode, bristleFieldCadence);
      return surface !== null;
    },
  });
  if (resolution.backend === "cpu" || !surface) return null;
  return new WebGl2BrushAccelerator(surface, options, bristleFieldCadence);
}

function readBristleFieldCadenceDebugFlag(): BristleFieldCadence {
  const value = (
    globalThis as typeof globalThis & {
      __headlessPaintGpuBristleField?: unknown;
    }
  ).__headlessPaintGpuBristleField;
  return value === "perRun" ? "perRun" : "perFlush";
}

function createSurface(
  width: number,
  height: number,
  commitMode: "bitmap" | "direct",
  bristleFieldCadence: BristleFieldCadence,
): GpuStrokeSurface | null {
  return createGpuStrokeSurface(width, height, commitMode, bristleFieldCadence);
}

function probeWebGl2Availability(): boolean {
  const surface = createGpuStrokeSurface(1, 1);
  if (!surface) return false;
  surface.dispose();
  return true;
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
  private readonly commitMode: "bitmap" | "direct";
  private readonly bristleFieldCadence: BristleFieldCadence;
  private readonly residencies = new WeakMap<Layer, LayerResidency>();
  private residentLayer: Layer | null = null;
  private activeOwner: object | null = null;
  private currentOwner: object | null = null;
  private activeSurface: GpuStrokeSurface | null = null;
  private activeLayer: Layer | null = null;
  private disposed = false;
  private permanentlyUnavailable = false;

  constructor(
    surface: GpuStrokeSurface,
    options: BrushAcceleratorOptions,
    bristleFieldCadence: BristleFieldCadence,
  ) {
    this.surface = surface;
    this.maxBranches = sanitizeMaxBranches(options.maxBranches);
    this.resident = options.resident ?? true;
    this.commitMode = options.commitMode ?? "bitmap";
    this.bristleFieldCadence = bristleFieldCadence;
  }

  warmUp(layer: Layer): void {
    const record = (outcome: string) => perfMark("warmUp", { reason: outcome });
    if (this.disposed) {
      record("skipped:disposed");
      return;
    }
    if (this.activeOwner) {
      record("skipped:activeOwner");
      return;
    }
    if (this.isLayerResident(layer)) {
      record("hit");
      return;
    }
    const surface = this.acquireSurface(layer.width, layer.height);
    if (!surface) {
      record("noSurface");
      return;
    }
    try {
      surface.beginStroke(layer.canvas, 1);
      surface.endStroke();
      this.validateResidency(layer, surface);
      record("uploaded");
    } catch {
      this.invalidate(layer, "warmUpFailure");
      record("failed");
    }
  }

  invalidate(
    layer: Layer,
    reason: GpuResidencyInvalidationReason = "external",
  ): void {
    perfMark("residencyInvalidated", { reason });
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
    }
    if (this.activeLayer) this.invalidate(this.activeLayer, "dispose");
    this.activeOwner = null;
    this.currentOwner = null;
    this.activeSurface = null;
    this.activeLayer = null;
    if (this.residentLayer) this.invalidate(this.residentLayer, "dispose");
    this.surface?.dispose();
    this.surface = null;
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
        const staleOwner = getGpuOwnerDebugMetadata(this.activeOwner);
        const recoveryOwner = getGpuOwnerDebugMetadata(owner);
        perfMark("gpuStaleOwnerRecovered", {
          ownerLabel: staleOwner.label,
          ownerStartedAtMs: staleOwner.startedAtMs,
          ownerAgeMs: Math.max(0, performance.now() - staleOwner.startedAtMs),
          recoveryOwnerLabel: recoveryOwner.label,
          forceRecord: true,
        });
      }
      this.activeSurface?.endStroke();
      if (this.activeLayer) {
        this.invalidate(this.activeLayer, "staleOwnerRecovery");
      }
      this.activeOwner = null;
      this.currentOwner = null;
      this.activeSurface = null;
      this.activeLayer = null;
    }
    if (this.activeOwner) return false;

    const surface = this.acquireSurface(layer.width, layer.height);
    if (!surface || surface.lost) return false;
    const residencyHit = this.resident && this.prepareResidency(layer, surface);
    perfSample("gpuResidencyHit", residencyHit ? 1 : 0);
    perfSample("gpuBranches", branchCount);
    perfMark("residency", { hit: residencyHit });
    if (!residencyHit && !sourceCanvas) return false;
    try {
      surface.beginStroke(residencyHit ? undefined : sourceCanvas, branchCount);
    } catch {
      this.invalidate(layer, "contextLost");
      if (surface.lost) this.permanentlyUnavailable = true;
      return false;
    }
    this.validateResidency(layer, surface);
    this.activeOwner = owner;
    this.activeSurface = surface;
    this.activeLayer = layer;
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
      this.activeSurface?.commitToLayer(layer);
    } catch {
      this.invalidate(layer, "contextLost");
      return;
    }
    if (this.activeSurface && !this.activeSurface.lost) {
      this.validateResidency(layer, this.activeSurface);
    } else {
      this.invalidate(layer, "contextLost");
      this.permanentlyUnavailable = true;
    }
  }

  cancelStroke(owner: object): boolean {
    if (this.activeOwner !== owner) return false;
    const surface = this.activeSurface;
    const layer = this.activeLayer;
    if (!surface || !layer || surface.lost) {
      if (layer) this.invalidate(layer, "contextLost");
      if (surface?.lost) this.permanentlyUnavailable = true;
      return false;
    }
    try {
      surface.cancelStroke();
    } catch {
      this.invalidate(layer, "contextLost");
      if (surface.lost) this.permanentlyUnavailable = true;
      return false;
    }
    if (surface.lost) {
      this.invalidate(layer, "contextLost");
      this.permanentlyUnavailable = true;
      return false;
    }
    this.validateResidency(layer, surface);
    return true;
  }

  endStroke(owner: object): void {
    if (this.activeOwner !== owner) return;
    const lost = this.activeSurface?.lost ?? false;
    this.activeSurface?.endStroke();
    if (lost && this.activeLayer) {
      this.invalidate(this.activeLayer, "contextLost");
    }
    this.activeOwner = null;
    this.currentOwner = null;
    this.activeSurface = null;
    this.activeLayer = null;
  }

  isStrokeLost(owner: object): boolean {
    if (this.activeOwner !== owner) return true;
    const lost = this.activeSurface?.lost ?? true;
    if (lost) {
      this.permanentlyUnavailable = true;
      if (this.activeLayer) {
        this.invalidate(this.activeLayer, "contextLost");
      }
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
    this.surface = createSurface(
      width,
      height,
      this.commitMode,
      this.bristleFieldCadence,
    );
    if (!this.surface) {
      this.permanentlyUnavailable = true;
      return null;
    }
    if (this.residentLayer) {
      this.invalidate(this.residentLayer, "surfaceResize");
    }
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
      this.invalidate(this.residentLayer, "residentLayerSwitch");
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

function getGpuOwnerDebugMetadata(owner: object): {
  readonly label: GpuStrokeOwnerLabel;
  readonly startedAtMs: number;
} {
  const metadata = owner as {
    readonly label?: unknown;
    readonly startedAtMs?: unknown;
  };
  const label =
    metadata.label === "replay" || metadata.label === "rebuild"
      ? metadata.label
      : "live";
  return {
    label,
    startedAtMs:
      typeof metadata.startedAtMs === "number"
        ? metadata.startedAtMs
        : performance.now(),
  };
}

function sanitizeMaxBranches(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_BRANCHES;
  }
  return Math.max(1, Math.min(DEFAULT_MAX_BRANCHES, Math.floor(value)));
}
