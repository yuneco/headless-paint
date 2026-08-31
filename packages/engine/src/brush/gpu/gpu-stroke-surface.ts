import type { Color, Layer } from "../../types";
import { brushPerfDebug, perfMark, perfSample, perfStage } from "../perf-debug";
import {
  type GpuBristleDraw,
  type GpuBristlePassResources,
  createGpuBristlePassResources,
} from "./bristle-pass";
import {
  type DirtyRect,
  commitRectsToLayer,
  unionDirtyRects,
} from "./commit-packing";
import {
  type FieldBatchCheckpoint,
  type FieldBatchMixRun,
  type FieldPassResources,
  allocateFieldStrip,
  clampUnit,
  executeMaterialFieldBatchMixPass,
  executeMaterialFieldDiffusionPass,
  executeMaterialFieldMixPass,
  oppositeFieldIndex,
  roundUpGpuAllocation,
} from "./field-strip";
import {
  type GpuStrokeGlResources,
  createGpuStrokeGlResources,
  disposeGpuStrokeGlResources,
} from "./gl-resources";
import {
  type MaterialCheckpoint,
  type PendingBranchSegment,
  type PendingMaterialCheckpointCapture,
  captureMaterialCheckpoints,
  ensureMaterialCheckpoints,
  queueMaterialCheckpoint,
} from "./snapshot-manager";

const INSTANCE_CAPACITY = 4096;
const INSTANCE_FLOATS = 6;

interface PendingPerFlushCheckpoint {
  readonly branchIndex: number;
  readonly capture?: PendingMaterialCheckpointCapture;
  readonly current?: MaterialCheckpoint;
}

interface PendingPerFlushFieldRun {
  readonly branchIndex: number;
  readonly update: GpuMaterialFieldUpdate;
  readonly checkpoint: PendingPerFlushCheckpoint;
}

export type BristleFieldCadence = "perRun" | "perFlush";

export interface GpuDab {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly rotation: number;
  readonly alpha: number;
  readonly branchIndex?: number;
}

export interface GpuSweepSegment {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly fromFrameX: number;
  readonly fromFrameY: number;
  readonly toFrameX: number;
  readonly toFrameY: number;
  readonly fromPressure: number;
  readonly toPressure: number;
  readonly fromFieldColumn: number;
  readonly toFieldColumn: number;
  readonly overlap: number;
  readonly trialId: number;
}

export interface GpuGrainParams {
  readonly amount: number;
  readonly softness: number;
  readonly grainSeed: number;
  readonly strokeSeed: number;
  readonly toothHeights: Float32Array<ArrayBuffer>;
}

export interface GpuBristleChunk {
  readonly segments: readonly GpuSweepSegment[];
  readonly maskField: Float32Array<ArrayBuffer>;
  readonly maskFieldColumns: number;
  readonly maskFieldRows: number;
  readonly profileAtlas: OffscreenCanvas;
  readonly grain: GpuGrainParams;
  readonly bboxRect: DirtyRect;
  readonly brushSize: number;
  readonly depositHardness: number;
  readonly color: Color;
  readonly useMaterialField: boolean;
}

export interface GpuMaterialFieldUpdate {
  readonly baseColor: {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
  };
  readonly centerX: number;
  readonly centerY: number;
  readonly angle: number;
  readonly sampleSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly pickupRatePerPx: number;
  readonly restoreRatePerPx: number;
  readonly diffusionRatePerPx: number;
  readonly distancePx: number;
}

export interface GpuStrokeSurface {
  readonly width: number;
  readonly height: number;
  readonly lost: boolean;
  readonly branchIndex: number;
  readonly maxBranchCount: number;
  beginStroke(sourceCanvas?: OffscreenCanvas, branchCount?: number): void;
  beginBranchBatch(): void;
  endBranchBatch(): void;
  selectBranch(branchIndex: number): void;
  setTip(tipCanvas: OffscreenCanvas): void;
  initializeMaterialField(
    columns: number,
    rows: number,
    baseColor: GpuMaterialFieldUpdate["baseColor"],
  ): void;
  updateMaterialField(update: GpuMaterialFieldUpdate): void;
  initializeMaterialCheckpoint(
    originX: number,
    originY: number,
    size: number,
  ): void;
  snapshotMaterialCheckpoint(
    originX: number,
    originY: number,
    size: number,
  ): void;
  updateField(pixels: Uint8ClampedArray, columns: number, rows: number): void;
  readMaterialFieldForTest(branchIndex?: number): Uint8ClampedArray;
  pushDab(dab: GpuDab): void;
  pushBristleChunk(chunk: GpuBristleChunk): void;
  flush(): void;
  commitToLayer(layer: Layer): void;
  cancelStroke(): void;
  endStroke(): void;
  dispose(): void;
}

class WebGl2StrokeSurface implements GpuStrokeSurface {
  readonly width: number;
  readonly height: number;
  readonly canvas: OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  private readonly glResources: GpuStrokeGlResources;
  private readonly bristleResources: GpuBristlePassResources;
  private readonly cachedFieldPassResources: FieldPassResources;

  private readonly program: WebGLProgram;
  private readonly fieldMixProgram: WebGLProgram;
  private readonly fieldBatchMixProgram: WebGLProgram;
  private readonly fieldDiffusionProgram: WebGLProgram;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly instanceBuffer: WebGLBuffer;
  private readonly branchDataBuffer: WebGLBuffer;
  private accumTexture: WebGLTexture;
  private sourceTexture: WebGLTexture;
  private readonly baseTexture: WebGLTexture;
  private readonly tipTexture: WebGLTexture;
  private readonly fieldTextures: readonly [WebGLTexture, WebGLTexture];
  private readonly fieldFramebuffers: readonly [
    WebGLFramebuffer,
    WebGLFramebuffer,
  ];
  private readonly fieldFramebuffersAttached: [boolean, boolean] = [
    false,
    false,
  ];
  private readonly materialCheckpointTexture: WebGLTexture;
  private readonly materialCheckpointFramebuffer: WebGLFramebuffer;
  private readonly materialCheckpoints: MaterialCheckpoint[] = [];
  private materialCheckpointTextureSize = 0;
  private materialCheckpointLayerCount = 0;
  private fieldBatchCheckpointTextureWidth = 0;
  private fieldBatchCheckpointTextureHeight = 0;
  private framebuffer: WebGLFramebuffer;
  private sourceFramebuffer: WebGLFramebuffer;
  private readonly baseFramebuffer: WebGLFramebuffer;
  private readonly surfaceSizeLocation: WebGLUniformLocation;
  private readonly instances = new Float32Array(
    INSTANCE_CAPACITY * INSTANCE_FLOATS,
  );
  private readonly singleFieldUpdateBatch: (
    | GpuMaterialFieldUpdate
    | undefined
  )[];

  private instanceCount = 0;
  private dirtyRects: (DirtyRect | null)[] = [null];
  private committedDirtyRect: DirtyRect | null = null;
  private committedLayer: Layer | null = null;
  private tipSource: OffscreenCanvas | null = null;
  private tipWidth = 0;
  private tipHeight = 0;
  private fieldColumns = 0;
  private fieldRows = 0;
  private fieldTextureWidth = 0;
  private fieldTextureHeight = 0;
  private strokeUniformFieldColumns = -1;
  private strokeUniformFieldRows = -1;
  private strokeUniformTextureWidth = -1;
  private strokeUniformTextureHeight = -1;
  private materialFieldInitializedThisStroke = false;
  private activeFieldIndex: 0 | 1 = 0;
  private branchCount = 1;
  private currentBranchIndex = 0;
  private pendingBranchSegments: PendingBranchSegment[][] | null = null;
  private branchBatchActive = false;
  private readonly useFloatField: boolean;
  private readonly commitMode: "bitmap" | "direct";
  private readonly bristleFieldCadence: BristleFieldCadence;
  readonly maxBranchCount: number;
  private strokeBegun = false;
  private disposed = false;

  constructor(
    width: number,
    height: number,
    commitMode: "bitmap" | "direct",
    bristleFieldCadence: BristleFieldCadence,
  ) {
    this.width = width;
    this.height = height;
    this.commitMode = commitMode;
    this.bristleFieldCadence = bristleFieldCadence;
    const resources = createGpuStrokeGlResources(
      width,
      height,
      this.instances.byteLength,
      INSTANCE_FLOATS,
    );
    this.glResources = resources;
    this.canvas = resources.canvas;
    this.gl = resources.gl;
    this.program = resources.program;
    this.fieldMixProgram = resources.fieldMixProgram;
    this.fieldBatchMixProgram = resources.fieldBatchMixProgram;
    this.fieldDiffusionProgram = resources.fieldDiffusionProgram;
    this.vertexArray = resources.vertexArray;
    this.instanceBuffer = resources.instanceBuffer;
    this.branchDataBuffer = resources.branchDataBuffer;
    this.accumTexture = resources.accumTexture;
    this.sourceTexture = resources.sourceTexture;
    this.baseTexture = resources.baseTexture;
    this.tipTexture = resources.tipTexture;
    this.fieldTextures = resources.fieldTextures;
    this.fieldFramebuffers = resources.fieldFramebuffers;
    this.materialCheckpointTexture = resources.materialCheckpointTexture;
    this.materialCheckpointFramebuffer =
      resources.materialCheckpointFramebuffer;
    this.framebuffer = resources.framebuffer;
    this.sourceFramebuffer = resources.sourceFramebuffer;
    this.baseFramebuffer = resources.baseFramebuffer;
    this.surfaceSizeLocation = resources.surfaceSizeLocation;
    this.maxBranchCount = resources.maxBranchCount;
    this.singleFieldUpdateBatch = Array<GpuMaterialFieldUpdate | undefined>(
      resources.maxBranchCount,
    ).fill(undefined);
    this.useFloatField = resources.useFloatField;
    this.bristleResources = createGpuBristlePassResources(
      this.gl,
      width,
      height,
    );
    this.cachedFieldPassResources = {
      gl: this.gl,
      branchCount: this.branchCount,
      fieldColumns: this.fieldColumns,
      fieldRows: this.fieldRows,
      activeFieldIndex: this.activeFieldIndex,
      checkpoints: this.materialCheckpoints,
      fieldTextures: this.fieldTextures,
      materialCheckpointTexture: this.materialCheckpointTexture,
      branchDataBuffer: this.branchDataBuffer,
      vertexArray: this.vertexArray,
      fieldMixProgram: this.fieldMixProgram,
      fieldBatchMixProgram: this.fieldBatchMixProgram,
      fieldDiffusionProgram: this.fieldDiffusionProgram,
      fieldMixUniforms: this.glResources.fieldMixUniforms,
      fieldBatchMixUniforms: this.glResources.fieldBatchMixUniforms,
      fieldBatchCheckpointTexture: this.glResources.fieldBatchCheckpointTexture,
      fieldBatchRunDataTexture: this.glResources.fieldBatchRunDataTexture,
      fieldBatchAccumTexture: this.accumTexture,
      surfaceWidth: this.width,
      surfaceHeight: this.height,
      fieldDiffusionUniforms: this.glResources.fieldDiffusionUniforms,
      fieldPassScratch: this.glResources.fieldPassScratch,
      bindFieldFramebuffer: (index) => this.bindFieldFramebuffer(index),
    };
  }

  get lost(): boolean {
    return this.glResources.contextState.lost || this.gl.isContextLost();
  }

  get branchIndex(): number {
    return this.currentBranchIndex;
  }

  beginStroke(sourceCanvas?: OffscreenCanvas, branchCount = 1): void {
    this.assertUsable();
    if (
      !Number.isSafeInteger(branchCount) ||
      branchCount < 1 ||
      branchCount > this.maxBranchCount
    ) {
      throw new Error(
        `GPU stroke branch count must be between 1 and ${this.maxBranchCount}`,
      );
    }
    this.branchCount = branchCount;
    this.currentBranchIndex = 0;
    this.materialFieldInitializedThisStroke = false;
    const gl = this.gl;
    if (sourceCanvas) {
      if (
        sourceCanvas.width !== this.width ||
        sourceCanvas.height !== this.height
      ) {
        throw new Error("GPU stroke source size does not match the surface");
      }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, this.accumTexture);
      perfMark("realloc:accum", {
        width: this.width,
        height: this.height,
        forceRecord: true,
      });
      perfStage("gpuUpload", () =>
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          sourceCanvas,
        ),
      );
      perfMark("gpuUpload", {
        bytes: sourceCanvas.width * sourceCanvas.height * 4,
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.accumTexture,
        0,
      );
      if (
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        throw new Error("GPU stroke framebuffer is incomplete");
      }
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        this.width,
        this.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sourceFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.sourceTexture,
        0,
      );
      if (
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        throw new Error("GPU stroke source framebuffer is incomplete");
      }

      // TexImageSource rows arrive top-down when UNPACK_FLIP_Y is false. Flip
      // once inside WebGL so the accumulation FBO and y-down projection agree.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sourceFramebuffer);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(
        0,
        0,
        this.width,
        this.height,
        0,
        this.height,
        this.width,
        0,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      [this.accumTexture, this.sourceTexture] = [
        this.sourceTexture,
        this.accumTexture,
      ];
      [this.framebuffer, this.sourceFramebuffer] = [
        this.sourceFramebuffer,
        this.framebuffer,
      ];
    }
    this.copyAccumToStrokeStartSource();
    perfStage("gpuBaseCopy", () => this.copyAccumToBase());
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    this.instanceCount = 0;
    this.pendingBranchSegments = null;
    this.branchBatchActive = false;
    this.dirtyRects = Array<DirtyRect | null>(branchCount).fill(null);
    this.committedDirtyRect = null;
    this.committedLayer = null;
    ensureMaterialCheckpoints(this.materialCheckpoints, branchCount);
    for (const checkpoint of this.materialCheckpoints) {
      checkpoint.initialized = false;
    }
    this.strokeBegun = true;
  }

  beginBranchBatch(): void {
    this.assertStrokeBegun();
    // A single branch already keeps dabs pending until its next field update.
    // Segment batching would flush the final segment at every append boundary.
    if (this.bristleFieldCadence === "perRun" && this.branchCount === 1) {
      return;
    }
    if (
      this.bristleFieldCadence === "perFlush" &&
      this.pendingBranchSegments &&
      !this.branchBatchActive
    ) {
      this.flushPendingBranchSegments();
    }
    if (this.pendingBranchSegments) {
      throw new Error("GPU branch batch is already active");
    }
    this.flush();
    this.pendingBranchSegments = Array.from(
      { length: this.branchCount },
      () => [{ dabs: [], bristleChunks: [] }],
    );
    this.branchBatchActive = true;
  }

  endBranchBatch(): void {
    this.assertStrokeBegun();
    const branches = this.pendingBranchSegments;
    if (!branches) return;
    this.pendingBranchSegments = null;
    this.branchBatchActive = false;

    if (this.bristleFieldCadence === "perFlush") {
      this.drawPerFlushBranchSegments(branches);
      return;
    }
    this.drawPerRunBranchSegments(branches);
  }

  private drawPerRunBranchSegments(
    branches: readonly (readonly PendingBranchSegment[])[],
  ): void {
    const segmentCount = branches.reduce(
      (maximum, segments) => Math.max(maximum, segments.length),
      0,
    );
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const segments = branches.map((segments) => segments[segmentIndex]);
      const updates = segments.map((segment) => segment?.update);
      let fieldUpdateStartedAt = 0;
      if (updates.some((update) => update !== undefined)) {
        fieldUpdateStartedAt = this.executeMaterialFieldUpdateBatch(updates);
      }
      const checkpoints = segments.map((segment) => segment?.checkpoint);
      const capturesAccumulation = checkpoints.some(
        (checkpoint) => checkpoint && !checkpoint.fromStrokeStart,
      );
      if (capturesAccumulation) {
        // A branch checkpoint observes the accumulation immediately after that
        // branch's dabs, matching the branch-ordered CPU path. The layer blits
        // remain GPU-only commands and introduce no readback or fence wait.
        for (
          let branchIndex = 0;
          branchIndex < this.branchCount;
          branchIndex++
        ) {
          this.drawDeposits(segments[branchIndex], branchIndex);
          const checkpoint = checkpoints[branchIndex];
          if (!checkpoint) continue;
          const captures = Array<PendingMaterialCheckpointCapture | undefined>(
            this.branchCount,
          ).fill(undefined);
          captures[branchIndex] = checkpoint;
          this.captureMaterialCheckpointBatch(captures);
        }
      } else {
        // flatMap preserves branch 0 -> 1 -> ... order inside the draw batch.
        for (
          let branchIndex = 0;
          branchIndex < segments.length;
          branchIndex++
        ) {
          this.drawDeposits(segments[branchIndex], branchIndex);
        }
      }
      if (updates.some((update) => update !== undefined)) {
        this.executeMaterialFieldDiffusionBatch(updates, fieldUpdateStartedAt);
      }
      if (
        !capturesAccumulation &&
        checkpoints.some((checkpoint) => checkpoint !== undefined)
      ) {
        this.captureMaterialCheckpointBatch(checkpoints);
      }
    }
  }

  selectBranch(branchIndex: number): void {
    this.assertStrokeBegun();
    if (
      !Number.isSafeInteger(branchIndex) ||
      branchIndex < 0 ||
      branchIndex >= this.branchCount
    ) {
      throw new Error("GPU stroke branch index is out of range");
    }
    if (branchIndex === this.currentBranchIndex) return;
    if (!this.pendingBranchSegments) this.flush();
    this.currentBranchIndex = branchIndex;
  }

  setTip(tipCanvas: OffscreenCanvas): void {
    this.assertStrokeBegun();
    if (this.tipSource === tipCanvas) return;
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, this.tipTexture);
    if (
      this.tipWidth !== tipCanvas.width ||
      this.tipHeight !== tipCanvas.height
    ) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        tipCanvas,
      );
      this.tipWidth = tipCanvas.width;
      this.tipHeight = tipCanvas.height;
    } else {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        tipCanvas,
      );
    }
    this.tipSource = tipCanvas;
  }

  updateField(pixels: Uint8ClampedArray, columns: number, rows: number): void {
    this.assertStrokeBegun();
    if (this.pendingBranchSegments) {
      throw new Error(
        "GPU material field upload is unavailable in a branch batch",
      );
    }
    if (this.instanceCount > 0) this.flush();
    if (pixels.length !== columns * rows * 4) {
      throw new Error(
        "GPU material field pixel size does not match dimensions",
      );
    }
    const gl = this.gl;
    this.ensureMaterialFieldSize(columns, rows);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const upload = this.useFloatField
      ? Float32Array.from(pixels, (value) => value / 255)
      : pixels;
    for (const texture of this.fieldTextures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        this.currentBranchIndex * rows,
        columns,
        rows,
        gl.RGBA,
        this.useFloatField ? gl.FLOAT : gl.UNSIGNED_BYTE,
        upload,
      );
    }
  }

  initializeMaterialField(
    columns: number,
    rows: number,
    baseColor: GpuMaterialFieldUpdate["baseColor"],
  ): void {
    this.assertStrokeBegun();
    this.ensureMaterialFieldSize(columns, rows);
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(
      clampUnit(baseColor.r / 255),
      clampUnit(baseColor.g / 255),
      clampUnit(baseColor.b / 255),
      clampUnit(baseColor.a / 255),
    );
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, this.currentBranchIndex * rows, columns, rows);
    for (let index = 0; index < this.fieldFramebuffers.length; index++) {
      this.bindFieldFramebuffer(index as 0 | 1);
      gl.viewport(0, 0, columns, rows * this.branchCount);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  updateMaterialField(update: GpuMaterialFieldUpdate): void {
    this.assertStrokeBegun();
    this.ensureMaterialFieldSize(update.columns, update.rows);
    if (brushPerfDebug.nullStages.nullFieldAdvance) return;
    if (this.bristleFieldCadence === "perFlush") {
      this.ensurePerFlushSegments();
    }
    const branchSegments =
      this.pendingBranchSegments?.[this.currentBranchIndex];
    if (branchSegments) {
      const segment = branchSegments[branchSegments.length - 1];
      if (!segment) throw new Error("GPU branch segment is unavailable");
      segment.update = update;
      branchSegments.push({ dabs: [], bristleChunks: [] });
      return;
    }
    const updates = this.singleFieldUpdateBatch;
    updates[this.currentBranchIndex] = update;
    try {
      const startedAt = this.executeMaterialFieldUpdateBatch(updates);
      // Sampling is submitted before the pending dab batch. Flush that batch
      // with the old field, then the old texture is safe as a diffusion target.
      this.flush();
      this.executeMaterialFieldDiffusionBatch(updates, startedAt);
    } finally {
      updates[this.currentBranchIndex] = undefined;
    }
  }

  initializeMaterialCheckpoint(
    originX: number,
    originY: number,
    size: number,
  ): void {
    this.assertStrokeBegun();
    const checkpoint = this.materialCheckpoints[this.currentBranchIndex];
    if (!checkpoint) throw new Error("GPU material checkpoint is unavailable");
    if (checkpoint.initialized) return;
    checkpoint.initialized = true;
    if (this.bristleFieldCadence === "perFlush") {
      this.ensurePerFlushSegments();
    }
    if (
      queueMaterialCheckpoint(
        this.pendingBranchSegments,
        this.currentBranchIndex,
        { originX, originY, size, fromStrokeStart: true },
      )
    ) {
      return;
    }
    const captures = Array<PendingMaterialCheckpointCapture | undefined>(
      this.branchCount,
    ).fill(undefined);
    captures[this.currentBranchIndex] = {
      originX,
      originY,
      size,
      fromStrokeStart: true,
    };
    this.captureMaterialCheckpointBatch(captures);
  }

  snapshotMaterialCheckpoint(
    originX: number,
    originY: number,
    size: number,
  ): void {
    this.assertStrokeBegun();
    const checkpoint = this.materialCheckpoints[this.currentBranchIndex];
    if (!checkpoint) throw new Error("GPU material checkpoint is unavailable");
    if (this.bristleFieldCadence === "perFlush") {
      this.ensurePerFlushSegments();
    }
    if (
      queueMaterialCheckpoint(
        this.pendingBranchSegments,
        this.currentBranchIndex,
        { originX, originY, size, fromStrokeStart: false },
      )
    ) {
      return;
    }
    const captures = Array<PendingMaterialCheckpointCapture | undefined>(
      this.branchCount,
    ).fill(undefined);
    captures[this.currentBranchIndex] = {
      originX,
      originY,
      size,
      fromStrokeStart: false,
    };
    this.captureMaterialCheckpointBatch(captures);
  }

  readMaterialFieldForTest(
    branchIndex = this.currentBranchIndex,
  ): Uint8ClampedArray {
    this.assertStrokeBegun();
    this.flush();
    this.selectBranch(branchIndex);
    const gl = this.gl;
    const length = this.fieldColumns * this.fieldRows * 4;
    const output = new Uint8ClampedArray(length);
    this.bindFieldFramebuffer(this.activeFieldIndex);
    const readY = branchIndex * this.fieldRows;
    if (this.useFloatField) {
      const floats = new Float32Array(length);
      gl.readPixels(
        0,
        readY,
        this.fieldColumns,
        this.fieldRows,
        gl.RGBA,
        gl.FLOAT,
        floats,
      );
      for (let index = 0; index < length; index++) {
        output[index] = Math.round(clampUnit(floats[index] ?? 0) * 255);
      }
    } else {
      gl.readPixels(
        0,
        readY,
        this.fieldColumns,
        this.fieldRows,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        output,
      );
    }
    return output;
  }

  pushDab(dab: GpuDab): void {
    this.assertStrokeBegun();
    this.selectBranch(dab.branchIndex ?? this.currentBranchIndex);
    const branchSegments =
      this.pendingBranchSegments?.[this.currentBranchIndex];
    if (branchSegments) {
      const segment = branchSegments[branchSegments.length - 1];
      if (!segment) throw new Error("GPU branch segment is unavailable");
      segment.dabs.push({ ...dab, branchIndex: this.currentBranchIndex });
      this.includeDabDirtyRect(dab, this.currentBranchIndex);
      return;
    }
    if (this.instanceCount >= INSTANCE_CAPACITY) this.flush();
    const offset = this.instanceCount * INSTANCE_FLOATS;
    this.instances[offset] = dab.x;
    this.instances[offset + 1] = dab.y;
    this.instances[offset + 2] = dab.size;
    this.instances[offset + 3] = dab.rotation;
    this.instances[offset + 4] = dab.alpha;
    this.instances[offset + 5] = this.currentBranchIndex;
    this.instanceCount++;

    this.includeDabDirtyRect(dab, this.currentBranchIndex);
  }

  pushBristleChunk(chunk: GpuBristleChunk): void {
    this.assertStrokeBegun();
    if (this.bristleFieldCadence === "perFlush") {
      this.ensurePerFlushSegments();
    }
    const branchSegments =
      this.pendingBranchSegments?.[this.currentBranchIndex];
    if (branchSegments) {
      const segment = branchSegments[branchSegments.length - 1];
      if (!segment) throw new Error("GPU branch segment is unavailable");
      segment.bristleChunks.push(chunk);
    } else {
      this.flush();
      this.drawBristleChunks([chunk], this.currentBranchIndex);
    }
    this.includeDirtyRect(
      this.currentBranchIndex,
      chunk.bboxRect.left,
      chunk.bboxRect.top,
      chunk.bboxRect.right,
      chunk.bboxRect.bottom,
    );
  }

  flush(): void {
    if (
      this.bristleFieldCadence === "perFlush" &&
      this.pendingBranchSegments &&
      !this.branchBatchActive
    ) {
      this.flushPendingBranchSegments();
    }
    if (this.instanceCount === 0 || this.lost) return;
    perfStage("gpuFlush", () => {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vertexArray);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tipTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTextures[this.activeFieldIndex]);
      if (
        this.strokeUniformFieldColumns !== this.fieldColumns ||
        this.strokeUniformFieldRows !== this.fieldRows
      ) {
        gl.uniform2f(
          this.glResources.strokeFieldUniforms.size,
          this.fieldColumns,
          this.fieldRows,
        );
        gl.uniform1f(
          this.glResources.strokeFieldUniforms.rowStride,
          this.fieldRows,
        );
        this.strokeUniformFieldColumns = this.fieldColumns;
        this.strokeUniformFieldRows = this.fieldRows;
      }
      if (
        this.strokeUniformTextureWidth !== this.fieldTextureWidth ||
        this.strokeUniformTextureHeight !== this.fieldTextureHeight
      ) {
        gl.uniform2f(
          this.glResources.strokeFieldUniforms.textureSize,
          this.fieldTextureWidth,
          this.fieldTextureHeight,
        );
        this.strokeUniformTextureWidth = this.fieldTextureWidth;
        this.strokeUniformTextureHeight = this.fieldTextureHeight;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.instances.subarray(0, this.instanceCount * INSTANCE_FLOATS),
      );
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
      this.instanceCount = 0;
    });
  }

  private drawDabs(dabs: readonly GpuDab[]): void {
    for (let start = 0; start < dabs.length; start += INSTANCE_CAPACITY) {
      const end = Math.min(dabs.length, start + INSTANCE_CAPACITY);
      for (let index = start; index < end; index++) {
        const dab = dabs[index];
        if (!dab) continue;
        const offset = (index - start) * INSTANCE_FLOATS;
        this.instances[offset] = dab.x;
        this.instances[offset + 1] = dab.y;
        this.instances[offset + 2] = dab.size;
        this.instances[offset + 3] = dab.rotation;
        this.instances[offset + 4] = dab.alpha;
        this.instances[offset + 5] = dab.branchIndex ?? 0;
      }
      this.instanceCount = end - start;
      this.flush();
    }
  }

  private drawDeposits(
    segment: PendingBranchSegment | undefined,
    branchIndex: number,
  ): void {
    if (!segment) return;
    this.drawDabs(segment.dabs);
    this.drawBristleChunks(segment.bristleChunks, branchIndex);
  }

  private ensurePerFlushSegments(): void {
    if (this.pendingBranchSegments) return;
    this.pendingBranchSegments = Array.from(
      { length: this.branchCount },
      () => [{ dabs: [], bristleChunks: [] }],
    );
  }

  private flushPendingBranchSegments(): void {
    const branches = this.pendingBranchSegments;
    if (!branches) return;
    this.pendingBranchSegments = null;
    this.drawPerFlushBranchSegments(branches);
  }

  private drawPerFlushBranchSegments(
    branches: readonly (readonly PendingBranchSegment[])[],
  ): void {
    const hasBristleChunks = branches.some((segments) =>
      segments.some((segment) => segment.bristleChunks.length > 0),
    );
    if (!hasBristleChunks) {
      this.drawPerRunBranchSegments(branches);
      return;
    }
    const segmentCount = branches.reduce(
      (maximum, segments) => Math.max(maximum, segments.length),
      0,
    );
    const checkpointRefs: PendingPerFlushCheckpoint[] = [];
    const currentCheckpoints = this.materialCheckpoints.map(
      (checkpoint, branchIndex): PendingPerFlushCheckpoint | undefined => {
        if (!checkpoint.initialized) return undefined;
        const reference = { branchIndex, current: checkpoint };
        checkpointRefs.push(reference);
        return reference;
      },
    );
    const checkpointBySegment = new Map<
      PendingBranchSegment,
      PendingPerFlushCheckpoint
    >();
    const pendingRuns: PendingPerFlushFieldRun[] = [];
    const latestUpdates = Array<GpuMaterialFieldUpdate | undefined>(
      this.branchCount,
    ).fill(undefined);
    const updateDistances = new Float64Array(this.branchCount);

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      for (let branchIndex = 0; branchIndex < this.branchCount; branchIndex++) {
        const segment = branches[branchIndex]?.[segmentIndex];
        if (!segment) continue;
        if (segment.update) {
          const checkpoint = currentCheckpoints[branchIndex];
          if (!checkpoint) {
            throw new Error("GPU material checkpoint has not been initialized");
          }
          pendingRuns.push({
            branchIndex,
            update: segment.update,
            checkpoint,
          });
          latestUpdates[branchIndex] = segment.update;
          updateDistances[branchIndex] += Math.max(
            0,
            segment.update.distancePx,
          );
        }
        if (segment.checkpoint) {
          const checkpoint = {
            branchIndex,
            capture: segment.checkpoint,
          };
          checkpointRefs.push(checkpoint);
          checkpointBySegment.set(segment, checkpoint);
          currentCheckpoints[branchIndex] = checkpoint;
        }
      }
    }

    const checkpointLayouts =
      this.preparePerFlushCheckpointAtlas(checkpointRefs);
    const capturedCheckpoints = new Set<PendingPerFlushCheckpoint>();
    for (const checkpoint of checkpointRefs) {
      if (checkpoint.current) {
        this.copyCurrentCheckpointToPerFlushAtlas(
          checkpoint,
          checkpointLayouts,
        );
        capturedCheckpoints.add(checkpoint);
      } else if (checkpoint.capture?.fromStrokeStart) {
        this.copySurfaceCheckpointToPerFlushAtlas(
          checkpoint,
          checkpointLayouts,
          this.sourceFramebuffer,
        );
        capturedCheckpoints.add(checkpoint);
      }
    }

    const aggregatedUpdates = latestUpdates.map((update, branchIndex) => {
      if (!update) return undefined;
      const distancePx = updateDistances[branchIndex] ?? 0;
      return {
        ...update,
        distancePx,
        // perFlush is deliberately capped at one coarse diffusion pass. The
        // experiment measures pass fixed cost, so replaying N diffusion passes
        // here would reintroduce the cost this cadence is meant to remove.
        diffusionRatePerPx:
          distancePx > 0
            ? Math.min(update.diffusionRatePerPx, 1 / distancePx)
            : update.diffusionRatePerPx,
      };
    });
    let fieldUpdateStartedAt = 0;
    const fieldStartIndex = this.activeFieldIndex;
    let fieldEndIndex = fieldStartIndex;
    const hasFieldUpdates = aggregatedUpdates.some(
      (update) => update !== undefined,
    );
    if (hasFieldUpdates) {
      // A checkpoint scheduled inside this flush is persisted only after its
      // run composites. Until then the batch shader samples the same rectangle
      // from F0, avoiding an extra checkpoint copy before the field pass.
      const runs: FieldBatchMixRun[] = pendingRuns.map((run) => {
        const checkpoint = checkpointLayouts.get(run.checkpoint);
        if (!checkpoint) {
          throw new Error("GPU material field batch checkpoint is unavailable");
        }
        return {
          branchIndex: run.branchIndex,
          update: run.update,
          checkpoint,
        };
      });
      fieldUpdateStartedAt = executeMaterialFieldBatchMixPass(
        this.fieldPassResources(),
        runs,
      );
      fieldEndIndex = oppositeFieldIndex(fieldStartIndex);
    }

    const bristleDraws: GpuBristleDraw[] = [];
    const compositedDistances = new Float64Array(this.branchCount);

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      for (let branchIndex = 0; branchIndex < this.branchCount; branchIndex++) {
        const segment = branches[branchIndex]?.[segmentIndex];
        if (!segment) continue;
        this.drawDabs(segment.dabs);
        const checkpoint = checkpointBySegment.get(segment);
        const runDistance = Math.max(0, segment.update?.distancePx ?? 0);
        const runEndDistance =
          (compositedDistances[branchIndex] ?? 0) + runDistance;
        const totalDistance = updateDistances[branchIndex] ?? 0;
        const fieldMixWeight =
          totalDistance > 0 ? clampUnit(runEndDistance / totalDistance) : 1;
        for (
          let chunkIndex = 0;
          chunkIndex < segment.bristleChunks.length;
          chunkIndex++
        ) {
          const chunk = segment.bristleChunks[chunkIndex];
          if (!chunk) continue;
          bristleDraws.push({
            chunk,
            target: this.bristleTarget(branchIndex, {
              previousFieldIndex: fieldStartIndex,
              fieldIndex: fieldEndIndex,
              fieldMixWeight,
            }),
            afterComposite:
              checkpoint &&
              !checkpoint.capture?.fromStrokeStart &&
              chunkIndex === segment.bristleChunks.length - 1
                ? () => {
                    this.copySurfaceCheckpointToPerFlushAtlas(
                      checkpoint,
                      checkpointLayouts,
                      this.framebuffer,
                    );
                    capturedCheckpoints.add(checkpoint);
                  }
                : undefined,
          });
        }
        compositedDistances[branchIndex] = runEndDistance;
        if (
          checkpoint &&
          !checkpoint.capture?.fromStrokeStart &&
          segment.bristleChunks.length === 0
        ) {
          this.copySurfaceCheckpointToPerFlushAtlas(
            checkpoint,
            checkpointLayouts,
            this.framebuffer,
          );
          capturedCheckpoints.add(checkpoint);
        }
      }
    }

    let passCount = this.bristleResources.drawBatch(bristleDraws);
    for (const checkpoint of checkpointRefs) {
      if (capturedCheckpoints.has(checkpoint)) continue;
      this.copySurfaceCheckpointToPerFlushAtlas(
        checkpoint,
        checkpointLayouts,
        this.framebuffer,
      );
    }
    this.persistPerFlushCheckpoints(currentCheckpoints, checkpointLayouts);

    if (hasFieldUpdates) {
      this.executeMaterialFieldDiffusionBatch(
        aggregatedUpdates,
        fieldUpdateStartedAt,
      );
      passCount += 1 + diffusionPassCount(aggregatedUpdates);
    }
    if (passCount > 0) perfSample("gpuBristlePasses", passCount);
  }

  private preparePerFlushCheckpointAtlas(
    checkpoints: readonly PendingPerFlushCheckpoint[],
  ): Map<PendingPerFlushCheckpoint, FieldBatchCheckpoint> {
    const layouts = new Map<PendingPerFlushCheckpoint, FieldBatchCheckpoint>();
    if (checkpoints.length === 0) return layouts;
    const checkpointSize = (checkpoint: PendingPerFlushCheckpoint) =>
      checkpoint.current?.textureSize ??
      Math.max(1, Math.floor(checkpoint.capture?.size ?? 1));
    const largestSize = checkpoints.reduce(
      (maximum, checkpoint) => Math.max(maximum, checkpointSize(checkpoint)),
      1,
    );
    const cellSize = roundUpGpuAllocation(largestSize);
    const gl = this.gl;
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const maxColumns = Math.floor(maxTextureSize / cellSize);
    if (maxColumns < 1) {
      throw new Error("GPU material checkpoint exceeds the texture limit");
    }
    let columns = Math.min(
      maxColumns,
      Math.max(1, Math.ceil(Math.sqrt(checkpoints.length))),
    );
    let rows = Math.ceil(checkpoints.length / columns);
    if (rows * cellSize > maxTextureSize) {
      columns = maxColumns;
      rows = Math.ceil(checkpoints.length / columns);
    }
    if (rows * cellSize > maxTextureSize) {
      throw new Error(
        "GPU material checkpoint batch exceeds the texture limit",
      );
    }
    const requiredWidth = columns * cellSize;
    const requiredHeight = rows * cellSize;
    if (
      requiredWidth > this.fieldBatchCheckpointTextureWidth ||
      requiredHeight > this.fieldBatchCheckpointTextureHeight
    ) {
      this.fieldBatchCheckpointTextureWidth = Math.max(
        this.fieldBatchCheckpointTextureWidth,
        requiredWidth,
      );
      this.fieldBatchCheckpointTextureHeight = Math.max(
        this.fieldBatchCheckpointTextureHeight,
        requiredHeight,
      );
      gl.bindTexture(
        gl.TEXTURE_2D,
        this.glResources.fieldBatchCheckpointTexture,
      );
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        this.fieldBatchCheckpointTextureWidth,
        this.fieldBatchCheckpointTextureHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      perfMark("realloc:fieldBatchCheckpoints", {
        width: this.fieldBatchCheckpointTextureWidth,
        height: this.fieldBatchCheckpointTextureHeight,
      });
    }
    gl.bindFramebuffer(
      gl.FRAMEBUFFER,
      this.glResources.fieldBatchCheckpointFramebuffer,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.glResources.fieldBatchCheckpointTexture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        "GPU material checkpoint batch framebuffer is incomplete",
      );
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // copyTexSubImage2D writes this texture later. Keep it detached from the
    // currently bound draw framebuffer while checkpoint pixels are copied.
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);

    for (let index = 0; index < checkpoints.length; index++) {
      const checkpoint = checkpoints[index];
      if (!checkpoint) continue;
      const source = checkpoint.capture ?? checkpoint.current;
      if (!source) continue;
      layouts.set(checkpoint, {
        originX: source.originX,
        originY: source.originY,
        textureSize: checkpointSize(checkpoint),
        atlasX: (index % columns) * cellSize,
        atlasY: Math.floor(index / columns) * cellSize,
        sampleFlushStartAccum:
          !checkpoint.current && !checkpoint.capture?.fromStrokeStart,
      });
    }
    return layouts;
  }

  private copyCurrentCheckpointToPerFlushAtlas(
    checkpoint: PendingPerFlushCheckpoint,
    layouts: ReadonlyMap<PendingPerFlushCheckpoint, FieldBatchCheckpoint>,
  ): void {
    const layout = layouts.get(checkpoint);
    if (!layout || !checkpoint.current) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.materialCheckpointFramebuffer);
    gl.framebufferTextureLayer(
      gl.READ_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      this.materialCheckpointTexture,
      0,
      checkpoint.branchIndex,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glResources.fieldBatchCheckpointTexture);
    gl.copyTexSubImage2D(
      gl.TEXTURE_2D,
      0,
      layout.atlasX,
      layout.atlasY,
      0,
      0,
      layout.textureSize,
      layout.textureSize,
    );
  }

  private copySurfaceCheckpointToPerFlushAtlas(
    checkpoint: PendingPerFlushCheckpoint,
    layouts: ReadonlyMap<PendingPerFlushCheckpoint, FieldBatchCheckpoint>,
    sourceFramebuffer: WebGLFramebuffer,
  ): void {
    const capture = checkpoint.capture;
    const layout = layouts.get(checkpoint);
    if (!capture || !layout) return;
    const readOriginX = Math.floor(capture.originX);
    const readOriginY = Math.floor(capture.originY);
    const left = Math.max(0, readOriginX);
    const top = Math.max(0, readOriginY);
    const right = Math.min(this.width, readOriginX + layout.textureSize);
    const bottom = Math.min(this.height, readOriginY + layout.textureSize);
    if (right <= left || bottom <= top) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFramebuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glResources.fieldBatchCheckpointTexture);
    gl.copyTexSubImage2D(
      gl.TEXTURE_2D,
      0,
      layout.atlasX + left - readOriginX,
      layout.atlasY + layout.textureSize - (bottom - readOriginY),
      left,
      this.height - bottom,
      right - left,
      bottom - top,
    );
  }

  private persistPerFlushCheckpoints(
    checkpoints: readonly (PendingPerFlushCheckpoint | undefined)[],
    layouts: ReadonlyMap<PendingPerFlushCheckpoint, FieldBatchCheckpoint>,
  ): void {
    const requiredSize = checkpoints.reduce((maximum, checkpoint) => {
      const layout = checkpoint ? layouts.get(checkpoint) : undefined;
      return Math.max(maximum, layout?.textureSize ?? 0);
    }, 0);
    if (requiredSize === 0) return;
    const gl = this.gl;
    if (
      requiredSize > this.materialCheckpointTextureSize ||
      this.branchCount > this.materialCheckpointLayerCount
    ) {
      this.materialCheckpointTextureSize = roundUpGpuAllocation(
        Math.max(requiredSize, this.materialCheckpointTextureSize),
      );
      this.materialCheckpointLayerCount = Math.max(
        this.branchCount,
        this.materialCheckpointLayerCount,
      );
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.materialCheckpointTexture);
      gl.texImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        gl.RGBA8,
        this.materialCheckpointTextureSize,
        this.materialCheckpointTextureSize,
        this.materialCheckpointLayerCount,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      perfMark("realloc:snapshotArray", {
        width: this.materialCheckpointTextureSize,
        height: this.materialCheckpointTextureSize,
        depth: this.materialCheckpointLayerCount,
      });
    }
    gl.bindFramebuffer(
      gl.READ_FRAMEBUFFER,
      this.glResources.fieldBatchCheckpointFramebuffer,
    );
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.materialCheckpointFramebuffer);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    for (let branchIndex = 0; branchIndex < this.branchCount; branchIndex++) {
      const checkpointRef = checkpoints[branchIndex];
      const layout = checkpointRef ? layouts.get(checkpointRef) : undefined;
      const checkpoint = this.materialCheckpoints[branchIndex];
      if (!checkpoint) continue;
      if (!layout) {
        checkpoint.initialized = false;
        continue;
      }
      gl.framebufferTextureLayer(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        this.materialCheckpointTexture,
        0,
        branchIndex,
      );
      if (
        gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !==
        gl.FRAMEBUFFER_COMPLETE
      ) {
        throw new Error("GPU material checkpoint framebuffer is incomplete");
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.blitFramebuffer(
        layout.atlasX,
        layout.atlasY,
        layout.atlasX + layout.textureSize,
        layout.atlasY + layout.textureSize,
        0,
        0,
        layout.textureSize,
        layout.textureSize,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      checkpoint.textureSize = layout.textureSize;
      checkpoint.originX = layout.originX;
      checkpoint.originY = layout.originY;
      checkpoint.initialized = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    perfSample(
      "checkpoints",
      checkpoints.filter((checkpoint) => checkpoint?.capture).length,
    );
  }

  private bristleTarget(
    branchIndex: number,
    fieldInterpolation?: {
      readonly previousFieldIndex: 0 | 1;
      readonly fieldIndex: 0 | 1;
      readonly fieldMixWeight: number;
    },
  ) {
    const previousFieldIndex =
      fieldInterpolation?.previousFieldIndex ?? this.activeFieldIndex;
    const fieldIndex = fieldInterpolation?.fieldIndex ?? this.activeFieldIndex;
    return {
      accumFramebuffer: this.framebuffer,
      fieldTexture: this.fieldTextures[fieldIndex],
      previousFieldTexture: this.fieldTextures[previousFieldIndex],
      fieldMixWeight: fieldInterpolation?.fieldMixWeight ?? 1,
      fieldColumns: this.fieldColumns,
      fieldRows: this.fieldRows,
      fieldTextureWidth: this.fieldTextureWidth,
      fieldTextureHeight: this.fieldTextureHeight,
      branchIndex,
    };
  }

  private drawBristleChunks(
    chunks: readonly GpuBristleChunk[],
    branchIndex: number,
  ): void {
    for (const chunk of chunks) {
      this.bristleResources.draw(chunk, this.bristleTarget(branchIndex));
    }
  }

  private fieldPassResources(): FieldPassResources {
    const resources = this.cachedFieldPassResources;
    resources.branchCount = this.branchCount;
    resources.fieldColumns = this.fieldColumns;
    resources.fieldRows = this.fieldRows;
    resources.activeFieldIndex = this.activeFieldIndex;
    return resources;
  }

  private executeMaterialFieldUpdateBatch(
    updates: readonly (GpuMaterialFieldUpdate | undefined)[],
  ): number {
    return executeMaterialFieldMixPass(this.fieldPassResources(), updates);
  }

  private executeMaterialFieldDiffusionBatch(
    updates: readonly (GpuMaterialFieldUpdate | undefined)[],
    startedAt: number,
  ): void {
    this.activeFieldIndex = executeMaterialFieldDiffusionPass(
      this.fieldPassResources(),
      updates,
      startedAt,
    );
  }

  commitToLayer(layer: Layer): void {
    this.assertStrokeBegun();
    this.flush();
    if (this.lost) return;
    const commitRects = this.normalizedDirtyRects();
    this.dirtyRects = Array<DirtyRect | null>(this.branchCount).fill(null);
    if (commitRects.length === 0) return;

    this.committedLayer = layer;
    this.committedDirtyRect = unionDirtyRects([
      this.committedDirtyRect,
      ...commitRects,
    ]);
    this.commitRectsToLayer(layer, commitRects);
  }

  cancelStroke(): void {
    this.assertStrokeBegun();
    perfStage("gpuCancelRestore", () => {
      const pendingDirtyRect = unionDirtyRects(this.normalizedDirtyRects());
      const restoreRect = unionDirtyRects([
        this.committedDirtyRect,
        pendingDirtyRect,
      ]);

      // Discard queued dabs before restoring accum. Some dabs may already have
      // reached accum through a field/checkpoint flush, so the dirty union still
      // has to be restored even when it was never committed to the Layer.
      this.instanceCount = 0;
      this.pendingBranchSegments = null;
      this.branchBatchActive = false;
      if (restoreRect) this.restoreBaseRectToAccum(restoreRect);
      if (this.committedDirtyRect && this.committedLayer) {
        this.commitRectsToLayer(this.committedLayer, [this.committedDirtyRect]);
      }
    });
  }

  private commitRectsToLayer(
    layer: Layer,
    commitRects: readonly DirtyRect[],
  ): void {
    commitRectsToLayer({
      layer,
      rects: commitRects,
      gl: this.gl,
      framebuffer: this.framebuffer,
      sourceHeight: this.height,
      canvas: this.canvas,
      mode: this.commitMode,
    });
  }

  endStroke(): void {
    this.instanceCount = 0;
    this.pendingBranchSegments = null;
    this.branchBatchActive = false;
    this.dirtyRects = [null];
    this.committedDirtyRect = null;
    this.committedLayer = null;
    this.strokeBegun = false;
    this.materialFieldInitializedThisStroke = false;
    this.branchCount = 1;
    this.currentBranchIndex = 0;
    this.tipSource = null;
    for (const checkpoint of this.materialCheckpoints) {
      checkpoint.initialized = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.endStroke();
    this.bristleResources.dispose();
    disposeGpuStrokeGlResources(this.glResources);
  }

  private copyAccumToStrokeStartSource(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sourceFramebuffer);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.blitFramebuffer(
      0,
      0,
      this.width,
      this.height,
      0,
      0,
      this.width,
      this.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
  }

  private copyAccumToBase(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.baseFramebuffer);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.blitFramebuffer(
      0,
      0,
      this.width,
      this.height,
      0,
      0,
      this.width,
      this.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
  }

  private restoreBaseRectToAccum(rect: DirtyRect): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.baseFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.blitFramebuffer(
      rect.left,
      this.height - rect.bottom,
      rect.right,
      this.height - rect.top,
      rect.left,
      this.height - rect.bottom,
      rect.right,
      this.height - rect.top,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
  }

  private normalizedDirtyRects(): DirtyRect[] {
    return this.dirtyRects.flatMap((dirty) => {
      if (!dirty) return [];
      const left = Math.max(0, Math.floor(dirty.left));
      const top = Math.max(0, Math.floor(dirty.top));
      const right = Math.min(this.width, Math.ceil(dirty.right));
      const bottom = Math.min(this.height, Math.ceil(dirty.bottom));
      return right > left && bottom > top ? [{ left, top, right, bottom }] : [];
    });
  }

  private captureMaterialCheckpointBatch(
    captures: readonly (PendingMaterialCheckpointCapture | undefined)[],
  ): void {
    captureMaterialCheckpoints({
      captures,
      gl: this.gl,
      width: this.width,
      height: this.height,
      branchCount: this.branchCount,
      checkpoints: this.materialCheckpoints,
      checkpointTexture: this.materialCheckpointTexture,
      checkpointFramebuffer: this.materialCheckpointFramebuffer,
      accumFramebuffer: this.framebuffer,
      strokeStartFramebuffer: this.sourceFramebuffer,
      allocatedTextureSize: this.materialCheckpointTextureSize,
      allocatedLayerCount: this.materialCheckpointLayerCount,
      flush: () => this.flush(),
      updateAllocation: (textureSize, layerCount) => {
        this.materialCheckpointTextureSize = textureSize;
        this.materialCheckpointLayerCount = layerCount;
      },
    });
  }

  private ensureMaterialFieldSize(columns: number, rows: number): void {
    if (columns <= 0 || rows <= 0) {
      throw new Error("GPU material field dimensions must be positive");
    }
    const forceRecord = !this.materialFieldInitializedThisStroke;
    this.materialFieldInitializedThisStroke = true;
    this.fieldColumns = columns;
    this.fieldRows = rows;
    const allocation = allocateFieldStrip({
      gl: this.gl,
      columns,
      rows,
      branchCount: this.branchCount,
      currentWidth: this.fieldTextureWidth,
      currentHeight: this.fieldTextureHeight,
      useFloatField: this.useFloatField,
      textures: this.fieldTextures,
      bindFramebuffer: (index) => this.bindFieldFramebuffer(index),
      forceRecord,
    });
    if (!allocation) return;
    this.fieldTextureWidth = allocation.width;
    this.fieldTextureHeight = allocation.height;
    this.activeFieldIndex = 0;
  }

  private bindFieldFramebuffer(index: 0 | 1): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fieldFramebuffers[index]);
    if (this.fieldFramebuffersAttached[index]) return;
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.fieldTextures[index],
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("GPU material field framebuffer is incomplete");
    }
    this.fieldFramebuffersAttached[index] = true;
  }

  private includeDirtyRect(
    branchIndex: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void {
    const dirtyRect = this.dirtyRects[branchIndex];
    if (!dirtyRect) {
      this.dirtyRects[branchIndex] = { left, top, right, bottom };
      return;
    }
    dirtyRect.left = Math.min(dirtyRect.left, left);
    dirtyRect.top = Math.min(dirtyRect.top, top);
    dirtyRect.right = Math.max(dirtyRect.right, right);
    dirtyRect.bottom = Math.max(dirtyRect.bottom, bottom);
  }

  private includeDabDirtyRect(dab: GpuDab, branchIndex: number): void {
    const halfExtent =
      (dab.size / 2) *
      (Math.abs(Math.cos(dab.rotation)) + Math.abs(Math.sin(dab.rotation)));
    this.includeDirtyRect(
      branchIndex,
      dab.x - halfExtent,
      dab.y - halfExtent,
      dab.x + halfExtent,
      dab.y + halfExtent,
    );
  }

  private assertUsable(): void {
    if (this.lost) throw new Error("GPU stroke context is lost");
  }

  private assertStrokeBegun(): void {
    this.assertUsable();
    if (!this.strokeBegun) throw new Error("GPU stroke has not begun");
  }
}

export function createGpuStrokeSurface(
  width: number,
  height: number,
  commitMode: "bitmap" | "direct" = "bitmap",
  bristleFieldCadence: BristleFieldCadence = "perRun",
): GpuStrokeSurface | null {
  try {
    return new WebGl2StrokeSurface(
      width,
      height,
      commitMode,
      bristleFieldCadence,
    );
  } catch {
    return null;
  }
}

function diffusionPassCount(
  updates: readonly (GpuMaterialFieldUpdate | undefined)[],
): number {
  return updates.reduce((maximum, update) => {
    if (!update) return maximum;
    const rate = Number.isFinite(update.diffusionRatePerPx)
      ? Math.max(0, update.diffusionRatePerPx)
      : 0;
    const distance = Number.isFinite(update.distancePx)
      ? Math.max(0, update.distancePx)
      : 0;
    const amount = rate * distance;
    return Math.max(maximum, amount > 1e-6 ? Math.ceil(amount) : 0);
  }, 0);
}
