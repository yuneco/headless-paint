import type { Layer } from "../../types";
import { brushPerfDebug, getCheckpointLagSteps } from "../perf-debug";
import {
  invalidateGpuLayerResidency,
  prepareGpuLayerResidency,
  validateGpuLayerResidency,
} from "./gpu-layer-residency";

const INSTANCE_CAPACITY = 4096;
const INSTANCE_FLOATS = 5;
const CHECKPOINT_WAIT_TIMEOUT_NS = 1_000_000_000;
const COMMIT_CANVAS_SIZE = 512;

interface DirtyRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CheckpointSlot {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly buffer: WebGLBuffer;
  textureWidth: number;
  textureHeight: number;
  bufferSize: number;
  snapshotId?: number;
}

interface PendingCheckpointSnapshot {
  readonly id: number;
  readonly previousId?: number;
  readonly slot: CheckpointSlot;
  readonly originX: number;
  readonly originY: number;
  readonly readOriginX: number;
  readonly readOriginY: number;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly readWidth: number;
  readonly readHeight: number;
  sync?: WebGLSync;
}

export interface CompletedGpuCheckpoint {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export interface GpuDab {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly rotation: number;
  readonly alpha: number;
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
  beginStroke(sourceCanvas?: OffscreenCanvas): void;
  setTip(tipCanvas: OffscreenCanvas): void;
  initializeMaterialField(
    columns: number,
    rows: number,
    baseColor: GpuMaterialFieldUpdate["baseColor"],
  ): void;
  updateMaterialField(update: GpuMaterialFieldUpdate): void;
  updateField(pixels: Uint8ClampedArray, columns: number, rows: number): void;
  readMaterialFieldForTest(): Uint8ClampedArray;
  pushDab(dab: GpuDab): void;
  flush(): void;
  readCheckpoint(
    originX: number,
    originY: number,
    size: number,
  ): Uint8ClampedArray;
  snapshotCheckpoint(
    originX: number,
    originY: number,
    size: number,
    previousId?: number,
  ): number;
  issuePendingReadbacks(): void;
  takeCheckpoint(
    id: number,
    options: { readonly wait: boolean; readonly lagSteps?: number },
  ): CompletedGpuCheckpoint | null;
  commitToLayer(layer: Layer): void;
  endStroke(): void;
}

interface GpuStrokeRuntime {
  beginStroke(
    owner: object,
    layer: Layer,
    sourceCanvas?: OffscreenCanvas,
  ): boolean;
  enter(owner: object): void;
  leave(owner: object): void;
  commitToLayer(owner: object, layer: Layer): void;
  issuePendingReadbacks(owner: object): void;
  endStroke(owner: object): void;
  invalidateLayerResidency(layer: Layer): void;
  isLayerResident(layer: Layer): boolean;
}

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aUnitPosition;
layout(location = 1) in vec2 aCenter;
layout(location = 2) in float aSize;
layout(location = 3) in float aRotation;
layout(location = 4) in float aAlpha;

uniform vec2 uSurfaceSize;

out vec2 vUv;
out float vAlpha;

void main() {
  vec2 local = (aUnitPosition - vec2(0.5)) * aSize;
  float cosine = cos(aRotation);
  float sine = sin(aRotation);
  vec2 rotated = vec2(
    local.x * cosine - local.y * sine,
    local.x * sine + local.y * cosine
  );
  vec2 position = aCenter + rotated;
  vec2 clip = vec2(
    position.x / uSurfaceSize.x * 2.0 - 1.0,
    1.0 - position.y / uSurfaceSize.y * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  vUv = aUnitPosition;
  vAlpha = aAlpha;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uTip;
uniform sampler2D uField;

in vec2 vUv;
in float vAlpha;
out vec4 outColor;

void main() {
  float mask = texture(uTip, vUv).a;
  vec4 material = texture(uField, vUv);
  float alpha = material.a * mask * vAlpha;
  outColor = vec4(material.rgb * alpha, alpha);
}
`;

const FIELD_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

void main() {
  vec2 position = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FIELD_MIX_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uAccum;
uniform sampler2D uPreviousField;
uniform vec2 uSurfaceSize;
uniform vec2 uFieldSize;
uniform vec2 uCenter;
uniform float uAngle;
uniform float uSampleSize;
uniform vec4 uBaseColor;
uniform float uPickup;
uniform float uRestore;

out vec4 outColor;

vec4 accumTexel(ivec2 documentPixel) {
  ivec2 surfaceSize = ivec2(uSurfaceSize);
  if (
    documentPixel.x < 0 || documentPixel.y < 0 ||
    documentPixel.x >= surfaceSize.x || documentPixel.y >= surfaceSize.y
  ) {
    return vec4(0.0);
  }
  return texelFetch(
    uAccum,
    ivec2(documentPixel.x, surfaceSize.y - 1 - documentPixel.y),
    0
  );
}

vec4 sampleAccumBilinear(vec2 documentPosition) {
  vec2 samplePosition = documentPosition - vec2(0.5);
  ivec2 p0 = ivec2(floor(samplePosition));
  vec2 fraction = samplePosition - vec2(p0);
  vec4 premultiplied = mix(
    mix(accumTexel(p0), accumTexel(p0 + ivec2(1, 0)), fraction.x),
    mix(
      accumTexel(p0 + ivec2(0, 1)),
      accumTexel(p0 + ivec2(1, 1)),
      fraction.x
    ),
    fraction.y
  );
  if (premultiplied.a <= 0.0) return vec4(0.0);
  return vec4(premultiplied.rgb / premultiplied.a, premultiplied.a);
}

void main() {
  ivec2 fieldCoord = ivec2(gl_FragCoord.xy);
  vec2 local = (
    (vec2(fieldCoord) + vec2(0.5)) / uFieldSize - vec2(0.5)
  ) * uSampleSize;
  float cosine = cos(uAngle);
  float sine = sin(uAngle);
  vec2 documentPosition = uCenter + vec2(
    local.x * cosine - local.y * sine,
    local.x * sine + local.y * cosine
  );
  vec4 sampled = sampleAccumBilinear(documentPosition);
  vec4 current = texelFetch(uPreviousField, fieldCoord, 0);
  float pickupAmount = uPickup * sampled.a;
  vec3 picked = mix(current.rgb, sampled.rgb, pickupAmount);
  outColor = vec4(
    mix(picked, uBaseColor.rgb, uRestore),
    mix(current.a, uBaseColor.a, uRestore)
  );
}
`;

const FIELD_DIFFUSION_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uPreviousField;
uniform ivec2 uFieldDimensions;
uniform float uStrength;

out vec4 outColor;

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4 current = texelFetch(uPreviousField, coord, 0);
  vec4 sum = current;
  float count = 1.0;
  if (coord.x > 0) {
    sum += texelFetch(uPreviousField, coord + ivec2(-1, 0), 0);
    count += 1.0;
  }
  if (coord.x + 1 < uFieldDimensions.x) {
    sum += texelFetch(uPreviousField, coord + ivec2(1, 0), 0);
    count += 1.0;
  }
  if (coord.y > 0) {
    sum += texelFetch(uPreviousField, coord + ivec2(0, -1), 0);
    count += 1.0;
  }
  if (coord.y + 1 < uFieldDimensions.y) {
    sum += texelFetch(uPreviousField, coord + ivec2(0, 1), 0);
    count += 1.0;
  }
  outColor = mix(current, sum / count, uStrength);
}
`;

class WebGl2StrokeSurface implements GpuStrokeSurface {
  readonly width: number;
  readonly height: number;
  readonly canvas: OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;

  private readonly program: WebGLProgram;
  private readonly fieldMixProgram: WebGLProgram;
  private readonly fieldDiffusionProgram: WebGLProgram;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly instanceBuffer: WebGLBuffer;
  private accumTexture: WebGLTexture;
  private sourceTexture: WebGLTexture;
  private readonly tipTexture: WebGLTexture;
  private readonly fieldTextures: readonly [WebGLTexture, WebGLTexture];
  private readonly fieldFramebuffers: readonly [
    WebGLFramebuffer,
    WebGLFramebuffer,
  ];
  private framebuffer: WebGLFramebuffer;
  private sourceFramebuffer: WebGLFramebuffer;
  private readonly surfaceSizeLocation: WebGLUniformLocation;
  private readonly instances = new Float32Array(
    INSTANCE_CAPACITY * INSTANCE_FLOATS,
  );

  private instanceCount = 0;
  private dirtyRect: DirtyRect | null = null;
  private tipSource: OffscreenCanvas | null = null;
  private tipWidth = 0;
  private tipHeight = 0;
  private fieldColumns = 0;
  private fieldRows = 0;
  private activeFieldIndex: 0 | 1 = 0;
  private readonly useFloatField: boolean;
  private strokeBegun = false;
  private contextLost = false;
  private checkpointSlots: CheckpointSlot[] = [];
  private readonly pendingCheckpointSnapshots = new Map<
    number,
    PendingCheckpointSnapshot
  >();
  private nextCheckpointId = 1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = new OffscreenCanvas(COMMIT_CANVAS_SIZE, COMMIT_CANVAS_SIZE);
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      stencil: false,
    });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    this.canvas.addEventListener("webglcontextlost", () => {
      this.discardPendingCheckpointSnapshots();
      this.deleteCheckpointSlots();
      this.contextLost = true;
      gpuPermanentlyUnavailable = true;
    });

    this.program = createProgram(
      gl,
      VERTEX_SHADER_SOURCE,
      FRAGMENT_SHADER_SOURCE,
      "GPU stroke",
    );
    this.fieldMixProgram = createProgram(
      gl,
      FIELD_VERTEX_SHADER_SOURCE,
      FIELD_MIX_FRAGMENT_SHADER_SOURCE,
      "GPU material field mix",
    );
    this.fieldDiffusionProgram = createProgram(
      gl,
      FIELD_VERTEX_SHADER_SOURCE,
      FIELD_DIFFUSION_FRAGMENT_SHADER_SOURCE,
      "GPU material field diffusion",
    );
    this.vertexArray = requireResource(
      gl.createVertexArray(),
      "WebGL vertex array",
    );
    this.instanceBuffer = requireResource(
      gl.createBuffer(),
      "WebGL instance buffer",
    );
    this.accumTexture = requireResource(
      gl.createTexture(),
      "WebGL accumulation texture",
    );
    this.sourceTexture = requireResource(
      gl.createTexture(),
      "WebGL source texture",
    );
    this.tipTexture = requireResource(gl.createTexture(), "WebGL tip texture");
    this.fieldTextures = [
      requireResource(gl.createTexture(), "WebGL field texture"),
      requireResource(gl.createTexture(), "WebGL field texture"),
    ];
    this.fieldFramebuffers = [
      requireResource(gl.createFramebuffer(), "WebGL field framebuffer"),
      requireResource(gl.createFramebuffer(), "WebGL field framebuffer"),
    ];
    this.framebuffer = requireResource(
      gl.createFramebuffer(),
      "WebGL framebuffer",
    );
    this.sourceFramebuffer = requireResource(
      gl.createFramebuffer(),
      "WebGL source framebuffer",
    );
    this.surfaceSizeLocation = requireResource(
      gl.getUniformLocation(this.program, "uSurfaceSize"),
      "uSurfaceSize uniform",
    );

    this.configureGeometry();
    this.configureTexture(this.accumTexture, gl.NEAREST);
    this.configureTexture(this.sourceTexture, gl.NEAREST);
    this.configureTexture(this.tipTexture, gl.LINEAR);
    for (const texture of this.fieldTextures) {
      this.configureTexture(texture, gl.LINEAR);
    }
    this.useFloatField = Boolean(
      gl.getExtension("EXT_color_buffer_float") ??
        gl.getExtension("EXT_color_buffer_half_float"),
    );
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTip"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uField"), 1);
    gl.uniform2f(this.surfaceSizeLocation, width, height);
  }

  get lost(): boolean {
    return this.contextLost || this.gl.isContextLost();
  }

  beginStroke(sourceCanvas?: OffscreenCanvas): void {
    this.assertUsable();
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
      const uploadStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        sourceCanvas,
      );
      if (brushPerfDebug.enabled) {
        brushPerfDebug.recordStage("gpuUpload", uploadStartedAt);
      }
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    this.instanceCount = 0;
    this.dirtyRect = null;
    this.discardPendingCheckpointSnapshots();
    this.strokeBegun = true;
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
    if (this.instanceCount > 0) this.flush();
    if (pixels.length !== columns * rows * 4) {
      throw new Error(
        "GPU material field pixel size does not match dimensions",
      );
    }
    const gl = this.gl;
    this.ensureMaterialFieldSize(columns, rows);
    this.activeFieldIndex = 0;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTextures[0]);
    if (this.useFloatField) {
      const normalized = new Float32Array(pixels.length);
      for (let index = 0; index < pixels.length; index++) {
        normalized[index] = (pixels[index] ?? 0) / 255;
      }
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        columns,
        rows,
        gl.RGBA,
        gl.FLOAT,
        normalized,
      );
    } else {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        columns,
        rows,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
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
    for (const framebuffer of this.fieldFramebuffers) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, columns, rows);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.activeFieldIndex = 0;
  }

  updateMaterialField(update: GpuMaterialFieldUpdate): void {
    this.assertStrokeBegun();
    this.ensureMaterialFieldSize(update.columns, update.rows);
    if (brushPerfDebug.nullStages.nullFieldAdvance) return;
    const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
    const gl = this.gl;
    const previousIndex = this.activeFieldIndex;
    let nextIndex = oppositeFieldIndex(previousIndex);
    const distance = sanitizeNonNegative(update.distancePx);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fieldFramebuffers[nextIndex]);
    gl.viewport(0, 0, update.columns, update.rows);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.fieldMixProgram);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accumTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTextures[previousIndex]);
    gl.uniform1i(gl.getUniformLocation(this.fieldMixProgram, "uAccum"), 0);
    gl.uniform1i(
      gl.getUniformLocation(this.fieldMixProgram, "uPreviousField"),
      1,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.fieldMixProgram, "uSurfaceSize"),
      this.width,
      this.height,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.fieldMixProgram, "uFieldSize"),
      update.columns,
      update.rows,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.fieldMixProgram, "uCenter"),
      update.centerX,
      update.centerY,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.fieldMixProgram, "uAngle"),
      update.angle,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.fieldMixProgram, "uSampleSize"),
      Math.max(1, update.sampleSize),
    );
    gl.uniform4f(
      gl.getUniformLocation(this.fieldMixProgram, "uBaseColor"),
      clampUnit(update.baseColor.r / 255),
      clampUnit(update.baseColor.g / 255),
      clampUnit(update.baseColor.b / 255),
      clampUnit(update.baseColor.a / 255),
    );
    gl.uniform1f(
      gl.getUniformLocation(this.fieldMixProgram, "uPickup"),
      distanceCoefficient(update.pickupRatePerPx, distance),
    );
    gl.uniform1f(
      gl.getUniformLocation(this.fieldMixProgram, "uRestore"),
      distanceCoefficient(update.restoreRatePerPx, distance),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Sampling is submitted before the pending dab batch. Flush that batch
    // with the old field, then the old texture is safe as a diffusion target.
    this.flush();

    let passAmount = sanitizeRate(update.diffusionRatePerPx) * distance;
    while (passAmount > 1e-6) {
      const strength = Math.min(1, passAmount);
      const targetIndex = oppositeFieldIndex(nextIndex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fieldFramebuffers[targetIndex]);
      gl.viewport(0, 0, update.columns, update.rows);
      gl.disable(gl.BLEND);
      gl.useProgram(this.fieldDiffusionProgram);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTextures[nextIndex]);
      gl.uniform1i(
        gl.getUniformLocation(this.fieldDiffusionProgram, "uPreviousField"),
        1,
      );
      gl.uniform2i(
        gl.getUniformLocation(this.fieldDiffusionProgram, "uFieldDimensions"),
        update.columns,
        update.rows,
      );
      gl.uniform1f(
        gl.getUniformLocation(this.fieldDiffusionProgram, "uStrength"),
        strength,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      nextIndex = targetIndex;
      passAmount -= strength;
    }
    this.activeFieldIndex = nextIndex;
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("gpuFieldUpdate", startedAt);
    }
  }

  readMaterialFieldForTest(): Uint8ClampedArray {
    this.assertStrokeBegun();
    const gl = this.gl;
    const length = this.fieldColumns * this.fieldRows * 4;
    const output = new Uint8ClampedArray(length);
    gl.bindFramebuffer(
      gl.FRAMEBUFFER,
      this.fieldFramebuffers[this.activeFieldIndex],
    );
    if (this.useFloatField) {
      const floats = new Float32Array(length);
      gl.readPixels(
        0,
        0,
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
        0,
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
    if (this.instanceCount >= INSTANCE_CAPACITY) this.flush();
    const offset = this.instanceCount * INSTANCE_FLOATS;
    this.instances[offset] = dab.x;
    this.instances[offset + 1] = dab.y;
    this.instances[offset + 2] = dab.size;
    this.instances[offset + 3] = dab.rotation;
    this.instances[offset + 4] = dab.alpha;
    this.instanceCount++;

    const halfExtent =
      (dab.size / 2) *
      (Math.abs(Math.cos(dab.rotation)) + Math.abs(Math.sin(dab.rotation)));
    this.includeDirtyRect(
      dab.x - halfExtent,
      dab.y - halfExtent,
      dab.x + halfExtent,
      dab.y + halfExtent,
    );
  }

  flush(): void {
    if (this.instanceCount === 0 || this.lost) return;
    const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tipTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTextures[this.activeFieldIndex]);
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
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("gpuFlush", startedAt);
    }
  }

  readCheckpoint(
    originX: number,
    originY: number,
    size: number,
  ): Uint8ClampedArray {
    this.assertStrokeBegun();
    this.flush();
    const tileSize = Math.max(0, Math.floor(size));
    const output = new Uint8ClampedArray(tileSize * tileSize * 4);
    if (tileSize === 0 || this.lost) return output;

    // readPixels is integer-addressed. The spike preserves the existing tile
    // size and uses the containing document pixel for fractional tile origins.
    const readOriginX = Math.floor(originX);
    const readOriginY = Math.floor(originY);
    const left = Math.max(0, readOriginX);
    const top = Math.max(0, readOriginY);
    const right = Math.min(this.width, readOriginX + tileSize);
    const bottom = Math.min(this.height, readOriginY + tileSize);
    const readWidth = Math.max(0, right - left);
    const readHeight = Math.max(0, bottom - top);
    if (readWidth === 0 || readHeight === 0) return output;

    const premultiplied = new Uint8Array(readWidth * readHeight * 4);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.readPixels(
      left,
      this.height - bottom,
      readWidth,
      readHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      premultiplied,
    );

    copyUnpremultipliedCheckpoint(output, premultiplied, {
      outputWidth: tileSize,
      outputOriginX: readOriginX,
      outputOriginY: readOriginY,
      left,
      top,
      readWidth,
      readHeight,
    });
    return output;
  }

  snapshotCheckpoint(
    originX: number,
    originY: number,
    size: number,
    previousId?: number,
  ): number {
    this.assertStrokeBegun();
    this.flush();
    if (
      previousId !== undefined &&
      !this.pendingCheckpointSnapshots.has(previousId)
    ) {
      throw new Error("Previous GPU checkpoint snapshot is unavailable");
    }
    const tileSize = Math.max(0, Math.floor(size));
    const readOriginX = Math.floor(originX);
    const readOriginY = Math.floor(originY);
    const left = Math.max(0, readOriginX);
    const top = Math.max(0, readOriginY);
    const right = Math.min(this.width, readOriginX + tileSize);
    const bottom = Math.min(this.height, readOriginY + tileSize);
    const readWidth = Math.max(0, right - left);
    const readHeight = Math.max(0, bottom - top);
    const slot = this.acquireCheckpointSlot(readWidth, readHeight);
    const id = this.nextCheckpointId++;
    slot.snapshotId = id;
    const snapshot: PendingCheckpointSnapshot = {
      id,
      previousId,
      slot,
      originX,
      originY,
      readOriginX,
      readOriginY,
      width: tileSize,
      height: tileSize,
      left,
      top,
      readWidth,
      readHeight,
    };
    this.pendingCheckpointSnapshots.set(id, snapshot);

    if (readWidth > 0 && readHeight > 0 && !this.lost) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, slot.framebuffer);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(
        left,
        this.height - bottom,
        right,
        this.height - top,
        0,
        0,
        readWidth,
        readHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
    }
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordSample("checkpoints", 1);
    }
    return id;
  }

  issuePendingReadbacks(): void {
    this.assertStrokeBegun();
    let issued = false;
    for (const snapshot of this.pendingCheckpointSnapshots.values()) {
      if (
        snapshot.sync ||
        snapshot.readWidth === 0 ||
        snapshot.readHeight === 0
      )
        continue;
      this.issueCheckpointReadback(snapshot);
      issued = true;
    }
    if (issued) this.gl.flush();
  }

  takeCheckpoint(
    id: number,
    options: { readonly wait: boolean; readonly lagSteps?: number },
  ): CompletedGpuCheckpoint | null {
    const snapshot = this.resolveCheckpointSnapshot(id, options.lagSteps ?? 0);
    if (!snapshot || this.lost) return null;
    if (snapshot.readWidth === 0 || snapshot.readHeight === 0) {
      this.recordCheckpointWait(false, 0);
      return this.completeCheckpoint(snapshot, new Uint8Array());
    }
    if (!snapshot.sync) {
      this.issueCheckpointReadback(snapshot);
      this.gl.flush();
    }

    const sync = snapshot.sync;
    if (!sync) return null;
    const gl = this.gl;
    let status = gl.clientWaitSync(sync, 0, 0);
    let waited = false;
    let waitMs = 0;
    if (status === gl.TIMEOUT_EXPIRED && options.wait) {
      // A replay may reach the take point before any batch boundary. Start all
      // other unread snapshots now so the single blocking wait advances the
      // whole ring, not only the requested checkpoint.
      this.issuePendingReadbacks();
      waited = true;
      const waitStartedAt = performance.now();
      const maxTimeout = Number(
        gl.getParameter(gl.MAX_CLIENT_WAIT_TIMEOUT_WEBGL),
      );
      const waitTimeout = Math.min(
        CHECKPOINT_WAIT_TIMEOUT_NS,
        Number.isFinite(maxTimeout) ? Math.max(0, maxTimeout) : 0,
      );
      if (waitTimeout === 0) {
        // WebGL implementations may expose a zero maximum client-wait
        // timeout. finish is the only synchronous completion primitive in
        // that case; the following clientWaitSync still validates the fence.
        gl.finish();
        status = gl.clientWaitSync(
          sync,
          gl.SYNC_FLUSH_COMMANDS_BIT,
          waitTimeout,
        );
        if (status === gl.TIMEOUT_EXPIRED || status === gl.WAIT_FAILED) {
          status = gl.clientWaitSync(sync, 0, 0);
        }
        if (status === gl.TIMEOUT_EXPIRED && !this.lost) {
          status = gl.CONDITION_SATISFIED;
        }
      } else {
        do {
          status = gl.clientWaitSync(
            sync,
            gl.SYNC_FLUSH_COMMANDS_BIT,
            waitTimeout,
          );
        } while (status === gl.TIMEOUT_EXPIRED && !this.lost);
      }
      if (status === gl.WAIT_FAILED && !this.lost) {
        // WebGL2 requires flags=0 on implementations that do not expose the
        // desktop SYNC_FLUSH_COMMANDS_BIT behavior. Preserve the requested
        // wait path above, then fall back to the portable blocking primitive.
        gl.finish();
        status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED && !this.lost) {
          status = gl.CONDITION_SATISFIED;
        }
      }
      waitMs = performance.now() - waitStartedAt;
    }
    this.recordCheckpointWait(waited, waitMs);
    if (status === gl.TIMEOUT_EXPIRED) return null;
    if (status === gl.WAIT_FAILED) {
      const error = gl.getError();
      this.releaseCheckpoint(snapshot);
      if (options.wait) {
        throw new Error(`GPU checkpoint fence wait failed (${error})`);
      }
      return null;
    }
    if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) {
      return null;
    }

    const premultiplied = new Uint8Array(
      snapshot.readWidth * snapshot.readHeight * 4,
    );
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, snapshot.slot.buffer);
    const readbackStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, premultiplied);
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("checkpointReadback", readbackStartedAt);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return this.completeCheckpoint(snapshot, premultiplied);
  }

  commitToLayer(layer: Layer): void {
    this.assertStrokeBegun();
    this.flush();
    const dirty = this.dirtyRect;
    if (!dirty || this.lost) return;
    const left = Math.max(0, Math.floor(dirty.left));
    const top = Math.max(0, Math.floor(dirty.top));
    const right = Math.min(this.width, Math.ceil(dirty.right));
    const bottom = Math.min(this.height, Math.ceil(dirty.bottom));
    const width = right - left;
    const height = bottom - top;
    this.dirtyRect = null;
    if (width <= 0 || height <= 0) return;

    const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    for (let tileTop = top; tileTop < bottom; tileTop += COMMIT_CANVAS_SIZE) {
      const tileBottom = Math.min(bottom, tileTop + COMMIT_CANVAS_SIZE);
      const tileHeight = tileBottom - tileTop;
      for (
        let tileLeft = left;
        tileLeft < right;
        tileLeft += COMMIT_CANVAS_SIZE
      ) {
        const tileRight = Math.min(right, tileLeft + COMMIT_CANVAS_SIZE);
        const tileWidth = tileRight - tileLeft;
        gl.blitFramebuffer(
          tileLeft,
          this.height - tileBottom,
          tileRight,
          this.height - tileTop,
          0,
          COMMIT_CANVAS_SIZE - tileHeight,
          tileWidth,
          COMMIT_CANVAS_SIZE,
          gl.COLOR_BUFFER_BIT,
          gl.NEAREST,
        );
        layer.ctx.save();
        layer.ctx.globalAlpha = 1;
        layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
        layer.ctx.beginPath();
        layer.ctx.rect(tileLeft, tileTop, tileWidth, tileHeight);
        layer.ctx.clip();
        layer.ctx.globalCompositeOperation = "copy";
        layer.ctx.drawImage(
          this.canvas,
          0,
          0,
          tileWidth,
          tileHeight,
          tileLeft,
          tileTop,
          tileWidth,
          tileHeight,
        );
        layer.ctx.restore();
      }
    }
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("gpuCommit", startedAt);
    }
  }

  endStroke(): void {
    this.discardPendingCheckpointSnapshots();
    this.instanceCount = 0;
    this.dirtyRect = null;
    this.strokeBegun = false;
    this.tipSource = null;
  }

  private acquireCheckpointSlot(
    readWidth: number,
    readHeight: number,
  ): CheckpointSlot {
    this.ensureCheckpointSlots();
    const slot = this.checkpointSlots.find(
      (candidate) => candidate.snapshotId === undefined,
    );
    if (!slot) {
      throw new Error("GPU checkpoint snapshot ring is full");
    }
    this.ensureCheckpointSlotCapacity(slot, readWidth, readHeight);
    return slot;
  }

  private ensureCheckpointSlots(): void {
    const ringSize = getCheckpointLagSteps() + 2;
    if (this.checkpointSlots.length >= ringSize) return;
    const gl = this.gl;
    for (let index = this.checkpointSlots.length; index < ringSize; index++) {
      const texture = requireResource(
        gl.createTexture(),
        "WebGL checkpoint texture",
      );
      this.configureTexture(texture, gl.NEAREST);
      const framebuffer = requireResource(
        gl.createFramebuffer(),
        "WebGL checkpoint framebuffer",
      );
      const buffer = requireResource(
        gl.createBuffer(),
        "WebGL checkpoint pixel pack buffer",
      );
      this.checkpointSlots.push({
        texture,
        framebuffer,
        buffer,
        textureWidth: 0,
        textureHeight: 0,
        bufferSize: 0,
      });
    }
  }

  private ensureCheckpointSlotCapacity(
    slot: CheckpointSlot,
    readWidth: number,
    readHeight: number,
  ): void {
    const gl = this.gl;
    const requiredWidth = Math.max(1, readWidth);
    const requiredHeight = Math.max(1, readHeight);
    if (
      slot.textureWidth < requiredWidth ||
      slot.textureHeight < requiredHeight
    ) {
      slot.textureWidth = Math.max(slot.textureWidth, requiredWidth);
      slot.textureHeight = Math.max(slot.textureHeight, requiredHeight);
      gl.bindTexture(gl.TEXTURE_2D, slot.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        slot.textureWidth,
        slot.textureHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, slot.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        slot.texture,
        0,
      );
      if (
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        throw new Error("GPU checkpoint framebuffer is incomplete");
      }
    }
    const byteLength = readWidth * readHeight * 4;
    if (slot.bufferSize < byteLength) {
      slot.bufferSize = byteLength;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLength, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
  }

  private issueCheckpointReadback(snapshot: PendingCheckpointSnapshot): void {
    const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, snapshot.slot.framebuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, snapshot.slot.buffer);
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordSample(
        "readbackPixels",
        snapshot.readWidth * snapshot.readHeight,
      );
    }
    gl.readPixels(
      0,
      0,
      snapshot.readWidth,
      snapshot.readHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      0,
    );
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    snapshot.sync = requireResource(
      gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0),
      "WebGL checkpoint fence",
    );
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("gpuReadRequest", startedAt);
    }
  }

  private resolveCheckpointSnapshot(
    id: number,
    lagSteps: number,
  ): PendingCheckpointSnapshot | undefined {
    if (!Number.isSafeInteger(lagSteps) || lagSteps < 0) return undefined;
    let snapshot = this.pendingCheckpointSnapshots.get(id);
    for (let step = 0; step < lagSteps && snapshot; step++) {
      if (snapshot.previousId === undefined) return undefined;
      snapshot = this.pendingCheckpointSnapshots.get(snapshot.previousId);
    }
    return snapshot;
  }

  private completeCheckpoint(
    snapshot: PendingCheckpointSnapshot,
    premultiplied: Uint8Array,
  ): CompletedGpuCheckpoint {
    const pixels = new Uint8ClampedArray(snapshot.width * snapshot.height * 4);
    copyUnpremultipliedCheckpoint(pixels, premultiplied, {
      outputWidth: snapshot.width,
      outputOriginX: snapshot.readOriginX,
      outputOriginY: snapshot.readOriginY,
      left: snapshot.left,
      top: snapshot.top,
      readWidth: snapshot.readWidth,
      readHeight: snapshot.readHeight,
    });
    this.releaseCheckpoint(snapshot);
    return {
      originX: snapshot.originX,
      originY: snapshot.originY,
      width: snapshot.width,
      height: snapshot.height,
      pixels,
    };
  }

  private releaseCheckpoint(snapshot: PendingCheckpointSnapshot): void {
    if (snapshot.sync) this.gl.deleteSync(snapshot.sync);
    this.pendingCheckpointSnapshots.delete(snapshot.id);
    snapshot.slot.snapshotId = undefined;
  }

  private discardPendingCheckpointSnapshots(): void {
    for (const snapshot of this.pendingCheckpointSnapshots.values()) {
      if (snapshot.sync) this.gl.deleteSync(snapshot.sync);
      snapshot.slot.snapshotId = undefined;
    }
    this.pendingCheckpointSnapshots.clear();
  }

  private deleteCheckpointSlots(): void {
    const gl = this.gl;
    for (const slot of this.checkpointSlots) {
      gl.deleteTexture(slot.texture);
      gl.deleteFramebuffer(slot.framebuffer);
      gl.deleteBuffer(slot.buffer);
    }
    this.checkpointSlots = [];
  }

  private recordCheckpointWait(waited: boolean, waitMs: number): void {
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordSample("checkpointLag", waited ? 1 : 0);
      brushPerfDebug.recordSample("checkpointWaitMs", waitMs);
    }
  }

  private configureGeometry(): void {
    const gl = this.gl;
    const unitQuad = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
    const quadBuffer = requireResource(gl.createBuffer(), "WebGL quad buffer");
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances.byteLength, gl.DYNAMIC_DRAW);
    const stride = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 2 * 4);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 4 * 4);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
  }

  private configureTexture(texture: WebGLTexture, filter: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private ensureMaterialFieldSize(columns: number, rows: number): void {
    if (columns <= 0 || rows <= 0) {
      throw new Error("GPU material field dimensions must be positive");
    }
    if (this.fieldColumns === columns && this.fieldRows === rows) return;
    const gl = this.gl;
    const internalFormat = this.useFloatField ? gl.RGBA16F : gl.RGBA8;
    const type = this.useFloatField ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    for (let index = 0; index < this.fieldTextures.length; index++) {
      const texture = this.fieldTextures[index];
      const framebuffer = this.fieldFramebuffers[index];
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internalFormat,
        columns,
        rows,
        0,
        gl.RGBA,
        type,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
      if (
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        throw new Error("GPU material field framebuffer is incomplete");
      }
    }
    this.fieldColumns = columns;
    this.fieldRows = rows;
    this.activeFieldIndex = 0;
  }

  private includeDirtyRect(
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void {
    if (!this.dirtyRect) {
      this.dirtyRect = { left, top, right, bottom };
      return;
    }
    this.dirtyRect.left = Math.min(this.dirtyRect.left, left);
    this.dirtyRect.top = Math.min(this.dirtyRect.top, top);
    this.dirtyRect.right = Math.max(this.dirtyRect.right, right);
    this.dirtyRect.bottom = Math.max(this.dirtyRect.bottom, bottom);
  }

  private assertUsable(): void {
    if (this.lost) throw new Error("GPU stroke context is lost");
  }

  private assertStrokeBegun(): void {
    this.assertUsable();
    if (!this.strokeBegun) throw new Error("GPU stroke has not begun");
  }
}

let cachedSurface: WebGl2StrokeSurface | null = null;
let gpuPermanentlyUnavailable = false;
let surfaceCreationCount = 0;
let activeOwner: object | null = null;
let currentOwner: object | null = null;
let activeSurface: GpuStrokeSurface | null = null;

export function acquireGpuStrokeSurface(
  width: number,
  height: number,
): GpuStrokeSurface | null {
  if (gpuPermanentlyUnavailable) return null;
  if (cachedSurface?.lost) {
    gpuPermanentlyUnavailable = true;
    return null;
  }
  if (
    cachedSurface &&
    cachedSurface.width === width &&
    cachedSurface.height === height
  ) {
    return cachedSurface;
  }
  try {
    cachedSurface = new WebGl2StrokeSurface(width, height);
    surfaceCreationCount++;
    return cachedSurface;
  } catch {
    gpuPermanentlyUnavailable = true;
    cachedSurface = null;
    return null;
  }
}

export function getActiveGpuStrokeSurface(): GpuStrokeSurface | null {
  return currentOwner === activeOwner ? activeSurface : null;
}

export function getGpuStrokeSurfaceCreationCountForTest(): number {
  return surfaceCreationCount;
}

const gpuStrokeRuntime: GpuStrokeRuntime = {
  beginStroke(owner, layer, sourceCanvas) {
    if (brushPerfDebug.experiments.gpuDab !== "webgl2") return false;
    if (activeOwner) return false;
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    if (!surface) return false;
    const residencyAvailable = prepareGpuLayerResidency(layer, surface);
    const residencyHit =
      brushPerfDebug.experiments.gpuResident && residencyAvailable;
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordSample("gpuResidencyHit", residencyHit ? 1 : 0);
    }
    if (!residencyHit && !sourceCanvas) return false;
    try {
      surface.beginStroke(residencyHit ? undefined : sourceCanvas);
    } catch {
      invalidateGpuLayerResidency(layer);
      return false;
    }
    validateGpuLayerResidency(layer, surface);
    activeOwner = owner;
    activeSurface = surface;
    return true;
  },
  enter(owner) {
    if (activeOwner === owner) currentOwner = owner;
  },
  leave(owner) {
    if (currentOwner === owner) currentOwner = null;
  },
  commitToLayer(owner, layer) {
    if (activeOwner !== owner) return;
    activeSurface?.commitToLayer(layer);
    if (activeSurface && !activeSurface.lost) {
      validateGpuLayerResidency(layer, activeSurface);
    } else {
      invalidateGpuLayerResidency(layer);
    }
  },
  issuePendingReadbacks(owner) {
    if (activeOwner !== owner) return;
    activeSurface?.issuePendingReadbacks();
  },
  endStroke(owner) {
    if (activeOwner !== owner) return;
    activeSurface?.endStroke();
    activeOwner = null;
    currentOwner = null;
    activeSurface = null;
  },
  invalidateLayerResidency(layer) {
    invalidateGpuLayerResidency(layer);
  },
  isLayerResident(layer) {
    if (!brushPerfDebug.experiments.gpuResident) return false;
    const surface = acquireGpuStrokeSurface(layer.width, layer.height);
    return surface ? prepareGpuLayerResidency(layer, surface) : false;
  },
};

declare global {
  // Experiment-only bridge used by @headless-paint/stroke without exporting
  // the GPU module from the engine public index.
  var __hpGpuStrokeRuntime: GpuStrokeRuntime | undefined;
}

globalThis.__hpGpuStrokeRuntime = gpuStrokeRuntime;

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label: string,
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = requireResource(gl.createProgram(), "WebGL program");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Failed to link ${label} program: ${info}`);
  }
  return program;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = requireResource(gl.createShader(type), "WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "unknown compile error";
    gl.deleteShader(shader);
    throw new Error(`Failed to compile GPU stroke shader: ${info}`);
  }
  return shader;
}

function requireResource<T>(value: T | null, label: string): T {
  if (!value) throw new Error(`Failed to create ${label}`);
  return value;
}

function oppositeFieldIndex(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}

function sanitizeNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sanitizeRate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function distanceCoefficient(ratePerPx: number, distancePx: number): number {
  return 1 - Math.exp(-sanitizeRate(ratePerPx) * distancePx);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unpremultiply(value: number, alpha: number): number {
  return Math.min(255, Math.round((value * 255) / alpha));
}

function copyUnpremultipliedCheckpoint(
  output: Uint8ClampedArray,
  premultiplied: Uint8Array,
  request: {
    readonly outputWidth: number;
    readonly outputOriginX: number;
    readonly outputOriginY: number;
    readonly left: number;
    readonly top: number;
    readonly readWidth: number;
    readonly readHeight: number;
  },
): void {
  const outputX = request.left - request.outputOriginX;
  const outputY = request.top - request.outputOriginY;
  for (let sourceRow = 0; sourceRow < request.readHeight; sourceRow++) {
    const targetRow = outputY + request.readHeight - 1 - sourceRow;
    for (let column = 0; column < request.readWidth; column++) {
      const sourceOffset = (sourceRow * request.readWidth + column) * 4;
      const targetOffset =
        (targetRow * request.outputWidth + outputX + column) * 4;
      const alpha = premultiplied[sourceOffset + 3] ?? 0;
      output[targetOffset + 3] = alpha;
      if (alpha === 0) continue;
      output[targetOffset] = unpremultiply(
        premultiplied[sourceOffset] ?? 0,
        alpha,
      );
      output[targetOffset + 1] = unpremultiply(
        premultiplied[sourceOffset + 1] ?? 0,
        alpha,
      );
      output[targetOffset + 2] = unpremultiply(
        premultiplied[sourceOffset + 2] ?? 0,
        alpha,
      );
    }
  }
}
