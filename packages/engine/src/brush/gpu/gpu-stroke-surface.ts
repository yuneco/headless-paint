import type { Layer } from "../../types";
import { brushPerfDebug } from "../perf-debug";

const INSTANCE_CAPACITY = 4096;
const INSTANCE_FLOATS = 5;
const CHECKPOINT_PBO_RING_SIZE = 3;
const COMMIT_CANVAS_SIZE = 512;

interface DirtyRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface PendingCheckpointReadback {
  readonly buffer: WebGLBuffer;
  readonly sync: WebGLSync;
  readonly sequence: number;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly readWidth: number;
  readonly readHeight: number;
}

interface CompletedGpuCheckpoint {
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

export interface GpuStrokeSurface {
  readonly width: number;
  readonly height: number;
  readonly lost: boolean;
  beginStroke(sourceCanvas: OffscreenCanvas): void;
  setTip(tipCanvas: OffscreenCanvas): void;
  updateField(pixels: Uint8ClampedArray, columns: number, rows: number): void;
  pushDab(dab: GpuDab): void;
  flush(): void;
  readCheckpoint(
    originX: number,
    originY: number,
    size: number,
  ): Uint8ClampedArray;
  requestCheckpoint(): void;
  takeCompletedCheckpoint(): CompletedGpuCheckpoint | null;
  commitToLayer(layer: Layer): void;
  endStroke(): void;
}

interface GpuStrokeRuntime {
  beginStroke(owner: object, sourceCanvas: OffscreenCanvas): boolean;
  enter(owner: object): void;
  leave(owner: object): void;
  commitToLayer(owner: object, layer: Layer): void;
  requestCheckpoint(owner: object): void;
  endStroke(owner: object): void;
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

class WebGl2StrokeSurface implements GpuStrokeSurface {
  readonly width: number;
  readonly height: number;
  readonly canvas: OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;

  private readonly program: WebGLProgram;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly instanceBuffer: WebGLBuffer;
  private accumTexture: WebGLTexture;
  private sourceTexture: WebGLTexture;
  private readonly tipTexture: WebGLTexture;
  private readonly fieldTexture: WebGLTexture;
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
  private strokeBegun = false;
  private contextLost = false;
  private checkpointBuffers: WebGLBuffer[] = [];
  private pendingCheckpointReadbacks: PendingCheckpointReadback[] = [];
  private checkpointBufferSize = 0;
  private checkpointRequestSequence = 0;
  private checkpointUsedSequence = 0;
  private lastCommittedRect: DirtyRect | null = null;
  private latestDabPosition: { readonly x: number; readonly y: number } | null =
    null;

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
      this.discardPendingCheckpointReadbacks();
      for (const buffer of this.checkpointBuffers) gl.deleteBuffer(buffer);
      this.checkpointBuffers = [];
      this.checkpointBufferSize = 0;
      this.contextLost = true;
      gpuPermanentlyUnavailable = true;
    });

    this.program = createProgram(gl);
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
    this.fieldTexture = requireResource(
      gl.createTexture(),
      "WebGL field texture",
    );
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
    this.configureTexture(this.fieldTexture, gl.LINEAR);
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTip"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uField"), 1);
    gl.uniform2f(this.surfaceSizeLocation, width, height);
  }

  get lost(): boolean {
    return this.contextLost || this.gl.isContextLost();
  }

  beginStroke(sourceCanvas: OffscreenCanvas): void {
    this.assertUsable();
    if (
      sourceCanvas.width !== this.width ||
      sourceCanvas.height !== this.height
    ) {
      throw new Error("GPU stroke source size does not match the surface");
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, this.accumTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      sourceCanvas,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.accumTexture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
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
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    this.instanceCount = 0;
    this.dirtyRect = null;
    this.discardPendingCheckpointReadbacks();
    this.checkpointRequestSequence = 0;
    this.checkpointUsedSequence = 0;
    this.lastCommittedRect = null;
    this.latestDabPosition = null;
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
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    if (this.fieldColumns !== columns || this.fieldRows !== rows) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        columns,
        rows,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      this.fieldColumns = columns;
      this.fieldRows = rows;
    }
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
    this.latestDabPosition = { x: dab.x, y: dab.y };

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
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
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

  requestCheckpoint(): void {
    this.assertStrokeBegun();
    const committed = this.lastCommittedRect;
    const latestDab = this.latestDabPosition;
    this.lastCommittedRect = null;
    if (
      !committed ||
      !latestDab ||
      brushPerfDebug.experiments.gpuReadback !== "async"
    ) {
      return;
    }
    const committedWidth = committed.right - committed.left;
    const committedHeight = committed.bottom - committed.top;
    const exceedsLimit =
      committedWidth > COMMIT_CANVAS_SIZE ||
      committedHeight > COMMIT_CANVAS_SIZE;
    const width = exceedsLimit
      ? Math.min(COMMIT_CANVAS_SIZE, this.width)
      : committedWidth;
    const height = exceedsLimit
      ? Math.min(COMMIT_CANVAS_SIZE, this.height)
      : committedHeight;
    const left = exceedsLimit
      ? Math.max(
          0,
          Math.min(Math.floor(latestDab.x - width / 2), this.width - width),
        )
      : committed.left;
    const top = exceedsLimit
      ? Math.max(
          0,
          Math.min(Math.floor(latestDab.y - height / 2), this.height - height),
        )
      : committed.top;
    this.requestCheckpointAsync({
      left,
      top,
      right: left + width,
      bottom: top + height,
    });
  }

  private requestCheckpointAsync(rect: DirtyRect): void {
    const startedAt = brushPerfDebug.enabled ? performance.now() : 0;
    this.flush();
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    if (width <= 0 || height <= 0 || this.lost) return;

    this.checkpointRequestSequence++;
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordSample("checkpoints", 1);
    }
    this.ensureCheckpointBuffers();
    const buffer = this.checkpointBuffers.find(
      (candidate) =>
        !this.pendingCheckpointReadbacks.some(
          (request) => request.buffer === candidate,
        ),
    );
    if (!buffer) {
      if (brushPerfDebug.enabled) {
        brushPerfDebug.recordStage("gpuReadRequest", startedAt);
      }
      return;
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.readPixels(
      rect.left,
      this.height - rect.bottom,
      width,
      height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      0,
    );
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const sync = requireResource(
      gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0),
      "WebGL checkpoint fence",
    );
    gl.flush();
    this.pendingCheckpointReadbacks.push({
      buffer,
      sync,
      sequence: this.checkpointRequestSequence,
      originX: rect.left,
      originY: rect.top,
      width,
      height,
      left: rect.left,
      top: rect.top,
      readWidth: width,
      readHeight: height,
    });
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordStage("gpuReadRequest", startedAt);
    }
  }

  takeCompletedCheckpoint(): CompletedGpuCheckpoint | null {
    const request = this.pendingCheckpointReadbacks[0];
    if (!request || this.lost) {
      this.recordCheckpointLag();
      return null;
    }
    const gl = this.gl;
    const status = gl.clientWaitSync(request.sync, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) {
      this.recordCheckpointLag();
      return null;
    }
    if (status === gl.WAIT_FAILED) {
      gl.deleteSync(request.sync);
      this.pendingCheckpointReadbacks.shift();
      this.recordCheckpointLag();
      return null;
    }
    if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) {
      this.recordCheckpointLag();
      return null;
    }

    const premultiplied = new Uint8Array(
      request.readWidth * request.readHeight * 4,
    );
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, request.buffer);
    if (premultiplied.length > 0) {
      const readbackStartedAt = brushPerfDebug.enabled ? performance.now() : 0;
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, premultiplied);
      if (brushPerfDebug.enabled) {
        brushPerfDebug.recordStage("checkpointReadback", readbackStartedAt);
      }
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteSync(request.sync);
    this.pendingCheckpointReadbacks.shift();

    const pixels = new Uint8ClampedArray(request.width * request.height * 4);
    copyUnpremultipliedCheckpoint(pixels, premultiplied, {
      outputWidth: request.width,
      outputOriginX: request.originX,
      outputOriginY: request.originY,
      ...request,
    });
    this.checkpointUsedSequence = request.sequence;
    this.recordCheckpointLag();
    return {
      originX: request.originX,
      originY: request.originY,
      width: request.width,
      height: request.height,
      pixels,
    };
  }

  commitToLayer(layer: Layer): void {
    this.assertStrokeBegun();
    this.flush();
    const dirty = this.dirtyRect;
    this.lastCommittedRect = null;
    if (!dirty || this.lost) return;
    const left = Math.max(0, Math.floor(dirty.left));
    const top = Math.max(0, Math.floor(dirty.top));
    const right = Math.min(this.width, Math.ceil(dirty.right));
    const bottom = Math.min(this.height, Math.ceil(dirty.bottom));
    const width = right - left;
    const height = bottom - top;
    this.dirtyRect = null;
    if (width <= 0 || height <= 0) return;
    this.lastCommittedRect = { left, top, right, bottom };

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
    this.discardPendingCheckpointReadbacks();
    this.instanceCount = 0;
    this.dirtyRect = null;
    this.lastCommittedRect = null;
    this.latestDabPosition = null;
    this.strokeBegun = false;
    this.tipSource = null;
  }

  private ensureCheckpointBuffers(): void {
    const byteLength = COMMIT_CANVAS_SIZE * COMMIT_CANVAS_SIZE * 4;
    if (
      this.checkpointBufferSize === byteLength &&
      this.checkpointBuffers.length === CHECKPOINT_PBO_RING_SIZE
    ) {
      return;
    }
    this.discardPendingCheckpointReadbacks();
    const gl = this.gl;
    for (const buffer of this.checkpointBuffers) gl.deleteBuffer(buffer);
    this.checkpointBuffers = [];
    this.checkpointBufferSize = byteLength;
    for (let index = 0; index < CHECKPOINT_PBO_RING_SIZE; index++) {
      const buffer = requireResource(
        gl.createBuffer(),
        "WebGL checkpoint pixel pack buffer",
      );
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLength, gl.STREAM_READ);
      this.checkpointBuffers.push(buffer);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  private discardPendingCheckpointReadbacks(): void {
    for (const request of this.pendingCheckpointReadbacks) {
      this.gl.deleteSync(request.sync);
    }
    this.pendingCheckpointReadbacks = [];
  }

  private recordCheckpointLag(): void {
    if (brushPerfDebug.enabled) {
      brushPerfDebug.recordSample(
        "checkpointLag",
        this.checkpointRequestSequence - this.checkpointUsedSequence,
      );
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
  beginStroke(owner, sourceCanvas) {
    if (brushPerfDebug.experiments.gpuDab !== "webgl2") return false;
    if (activeOwner) return false;
    const surface = acquireGpuStrokeSurface(
      sourceCanvas.width,
      sourceCanvas.height,
    );
    if (!surface) return false;
    try {
      surface.beginStroke(sourceCanvas);
    } catch {
      return false;
    }
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
  },
  requestCheckpoint(owner) {
    if (activeOwner !== owner) return;
    activeSurface?.requestCheckpoint();
  },
  endStroke(owner) {
    if (activeOwner !== owner) return;
    activeSurface?.endStroke();
    activeOwner = null;
    currentOwner = null;
    activeSurface = null;
  },
};

declare global {
  // Experiment-only bridge used by @headless-paint/stroke without exporting
  // the GPU module from the engine public index.
  var __hpGpuStrokeRuntime: GpuStrokeRuntime | undefined;
}

globalThis.__hpGpuStrokeRuntime = gpuStrokeRuntime;

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    VERTEX_SHADER_SOURCE,
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER_SOURCE,
  );
  const program = requireResource(gl.createProgram(), "WebGL program");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Failed to link GPU stroke program: ${info}`);
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
