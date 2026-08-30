import { perfStage } from "../perf-debug";
import { createProgram, requireResource } from "./gl-resources";
import type { GpuBristleChunk, GpuSweepSegment } from "./gpu-stroke-surface";
import {
  BRISTLE_COMPOSITE_FRAGMENT_SHADER_SOURCE,
  BRISTLE_COMPOSITE_VERTEX_SHADER_SOURCE,
  BRISTLE_INK_FRAGMENT_SHADER_SOURCE,
  BRISTLE_INK_VERTEX_SHADER_SOURCE,
  BRISTLE_MASK_FRAGMENT_SHADER_SOURCE,
  BRISTLE_MASK_VERTEX_SHADER_SOURCE,
} from "./shader-sources";

const MASK_VERTEX_FLOATS = 6;
const INK_VERTEX_FLOATS = 4;

interface MaskUniforms {
  readonly targetSize: WebGLUniformLocation;
  readonly fieldSize: WebGLUniformLocation;
  readonly fieldTextureSize: WebGLUniformLocation;
  readonly documentOrigin: WebGLUniformLocation;
  readonly depositHardness: WebGLUniformLocation;
  readonly grainAmount: WebGLUniformLocation;
  readonly grainSoftness: WebGLUniformLocation;
  readonly grainSeed: WebGLUniformLocation;
  readonly strokeSeed: WebGLUniformLocation;
}

interface InkUniforms {
  readonly targetSize: WebGLUniformLocation;
  readonly profileScale: WebGLUniformLocation;
}

interface CompositeUniforms {
  readonly surfaceSize: WebGLUniformLocation;
  readonly targetSize: WebGLUniformLocation;
  readonly chunkSize: WebGLUniformLocation;
  readonly documentOrigin: WebGLUniformLocation;
  readonly fieldSize: WebGLUniformLocation;
  readonly fieldTextureSize: WebGLUniformLocation;
  readonly fieldRowStride: WebGLUniformLocation;
  readonly branchIndex: WebGLUniformLocation;
  readonly useField: WebGLUniformLocation;
  readonly color: WebGLUniformLocation;
}

export interface BristlePassTarget {
  readonly accumFramebuffer: WebGLFramebuffer;
  readonly fieldTexture: WebGLTexture;
  readonly fieldColumns: number;
  readonly fieldRows: number;
  readonly fieldTextureWidth: number;
  readonly fieldTextureHeight: number;
  readonly branchIndex: number;
}

export interface GpuBristlePassResources {
  draw(chunk: GpuBristleChunk, target: BristlePassTarget): void;
  dispose(): void;
}

export function createGpuBristlePassResources(
  gl: WebGL2RenderingContext,
  surfaceWidth: number,
  surfaceHeight: number,
): GpuBristlePassResources {
  const maskProgram = createProgram(
    gl,
    BRISTLE_MASK_VERTEX_SHADER_SOURCE,
    BRISTLE_MASK_FRAGMENT_SHADER_SOURCE,
    "GPU bristle mask",
  );
  const inkProgram = createProgram(
    gl,
    BRISTLE_INK_VERTEX_SHADER_SOURCE,
    BRISTLE_INK_FRAGMENT_SHADER_SOURCE,
    "GPU bristle ink",
  );
  const compositeProgram = createProgram(
    gl,
    BRISTLE_COMPOSITE_VERTEX_SHADER_SOURCE,
    BRISTLE_COMPOSITE_FRAGMENT_SHADER_SOURCE,
    "GPU bristle composite",
  );
  const maskUniforms: MaskUniforms = {
    targetSize: uniformLocation(gl, maskProgram, "uTargetSize"),
    fieldSize: uniformLocation(gl, maskProgram, "uFieldSize"),
    fieldTextureSize: uniformLocation(gl, maskProgram, "uMaskFieldTextureSize"),
    documentOrigin: uniformLocation(gl, maskProgram, "uDocumentOrigin"),
    depositHardness: uniformLocation(gl, maskProgram, "uDepositHardness"),
    grainAmount: uniformLocation(gl, maskProgram, "uGrainAmount"),
    grainSoftness: uniformLocation(gl, maskProgram, "uGrainSoftness"),
    grainSeed: uniformLocation(gl, maskProgram, "uGrainSeed"),
    strokeSeed: uniformLocation(gl, maskProgram, "uStrokeSeed"),
  };
  const inkUniforms: InkUniforms = {
    targetSize: uniformLocation(gl, inkProgram, "uTargetSize"),
    profileScale: uniformLocation(gl, inkProgram, "uProfileScale"),
  };
  const compositeUniforms: CompositeUniforms = {
    surfaceSize: uniformLocation(gl, compositeProgram, "uSurfaceSize"),
    targetSize: uniformLocation(gl, compositeProgram, "uTargetSize"),
    chunkSize: uniformLocation(gl, compositeProgram, "uChunkSize"),
    documentOrigin: uniformLocation(gl, compositeProgram, "uDocumentOrigin"),
    fieldSize: uniformLocation(gl, compositeProgram, "uFieldSize"),
    fieldTextureSize: uniformLocation(
      gl,
      compositeProgram,
      "uFieldTextureSize",
    ),
    fieldRowStride: uniformLocation(gl, compositeProgram, "uFieldRowStride"),
    branchIndex: uniformLocation(gl, compositeProgram, "uBranchIndex"),
    useField: uniformLocation(gl, compositeProgram, "uUseField"),
    color: uniformLocation(gl, compositeProgram, "uColor"),
  };
  const maskVertexArray = requireResource(
    gl.createVertexArray(),
    "GPU bristle mask vertex array",
  );
  const inkVertexArray = requireResource(
    gl.createVertexArray(),
    "GPU bristle ink vertex array",
  );
  const vertexBuffer = requireResource(
    gl.createBuffer(),
    "GPU bristle vertex buffer",
  );
  const maskFieldTexture = requireResource(
    gl.createTexture(),
    "GPU bristle mask field texture",
  );
  const toothTexture = requireResource(
    gl.createTexture(),
    "GPU bristle tooth texture",
  );
  const profileTexture = requireResource(
    gl.createTexture(),
    "GPU bristle profile texture",
  );
  const fallbackMaterialTexture = requireResource(
    gl.createTexture(),
    "GPU bristle fallback material texture",
  );
  const maskTexture = requireResource(
    gl.createTexture(),
    "GPU bristle mask texture",
  );
  const inkTexture = requireResource(
    gl.createTexture(),
    "GPU bristle ink texture",
  );
  const maskFramebuffer = requireResource(
    gl.createFramebuffer(),
    "GPU bristle mask framebuffer",
  );
  const inkFramebuffer = requireResource(
    gl.createFramebuffer(),
    "GPU bristle ink framebuffer",
  );

  configureTexture(gl, maskFieldTexture, gl.NEAREST);
  configureTexture(gl, toothTexture, gl.NEAREST);
  configureTexture(gl, profileTexture, gl.LINEAR);
  configureTexture(gl, fallbackMaterialTexture, gl.NEAREST);
  configureTexture(gl, maskTexture, gl.NEAREST);
  configureTexture(gl, inkTexture, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, toothTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 128, 128, 0, gl.RED, gl.FLOAT, null);
  gl.bindTexture(gl.TEXTURE_2D, fallbackMaterialTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  configureGeometry(gl, maskVertexArray, inkVertexArray, vertexBuffer);
  gl.useProgram(maskProgram);
  gl.uniform1i(uniformLocation(gl, maskProgram, "uMaskField"), 0);
  gl.uniform1i(uniformLocation(gl, maskProgram, "uTooth"), 1);
  gl.useProgram(inkProgram);
  gl.uniform1i(uniformLocation(gl, inkProgram, "uProfile"), 0);
  gl.useProgram(compositeProgram);
  gl.uniform1i(uniformLocation(gl, compositeProgram, "uMask"), 0);
  gl.uniform1i(uniformLocation(gl, compositeProgram, "uInk"), 1);
  gl.uniform1i(uniformLocation(gl, compositeProgram, "uField"), 2);
  gl.uniform2i(compositeUniforms.surfaceSize, surfaceWidth, surfaceHeight);

  let targetWidth = 0;
  let targetHeight = 0;
  let maskFieldTextureWidth = 0;
  let maskFieldTextureHeight = 0;
  let profileTextureWidth = 0;
  let profileTextureHeight = 0;
  let vertexBufferCapacity = 0;
  let profileSource: OffscreenCanvas | null = null;
  let toothSource: Float32Array<ArrayBuffer> | null = null;

  function draw(chunk: GpuBristleChunk, target: BristlePassTarget): void {
    const chunkWidth = chunk.bboxRect.right - chunk.bboxRect.left;
    const chunkHeight = chunk.bboxRect.bottom - chunk.bboxRect.top;
    if (chunkWidth <= 0 || chunkHeight <= 0 || chunk.segments.length === 0) {
      return;
    }
    ensureTargetSize(chunkWidth, chunkHeight);
    uploadMaskField(chunk);
    uploadTooth(chunk);
    uploadProfile(chunk.profileAtlas);
    drawMask(chunk);
    drawInk(chunk);
    composite(chunk, target);
  }

  function ensureTargetSize(width: number, height: number): void {
    if (width <= targetWidth && height <= targetHeight) return;
    targetWidth = Math.max(targetWidth, width);
    targetHeight = Math.max(targetHeight, height);
    for (const texture of [maskTexture, inkTexture]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        targetWidth,
        targetHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    attachTarget(maskFramebuffer, maskTexture, "mask");
    attachTarget(inkFramebuffer, inkTexture, "ink");
  }

  function attachTarget(
    framebuffer: WebGLFramebuffer,
    texture: WebGLTexture,
    label: string,
  ): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`GPU bristle ${label} framebuffer is incomplete`);
    }
  }

  function uploadMaskField(chunk: GpuBristleChunk): void {
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, maskFieldTexture);
    if (
      chunk.maskFieldColumns > maskFieldTextureWidth ||
      chunk.maskFieldRows > maskFieldTextureHeight
    ) {
      maskFieldTextureWidth = Math.max(
        maskFieldTextureWidth,
        chunk.maskFieldColumns,
      );
      maskFieldTextureHeight = Math.max(
        maskFieldTextureHeight,
        chunk.maskFieldRows,
      );
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        maskFieldTextureWidth,
        maskFieldTextureHeight,
        0,
        gl.RED,
        gl.FLOAT,
        null,
      );
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      chunk.maskFieldColumns,
      chunk.maskFieldRows,
      gl.RED,
      gl.FLOAT,
      chunk.maskField,
    );
  }

  function uploadTooth(chunk: GpuBristleChunk): void {
    if (toothSource === chunk.grain.toothHeights) return;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, toothTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      128,
      128,
      gl.RED,
      gl.FLOAT,
      chunk.grain.toothHeights,
    );
    toothSource = chunk.grain.toothHeights;
  }

  function uploadProfile(profile: OffscreenCanvas): void {
    if (profileSource === profile) return;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, profileTexture);
    if (
      profile.width > profileTextureWidth ||
      profile.height > profileTextureHeight
    ) {
      profileTextureWidth = Math.max(profileTextureWidth, profile.width);
      profileTextureHeight = Math.max(profileTextureHeight, profile.height);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        profileTextureWidth,
        profileTextureHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      profile,
    );
    profileSource = profile;
  }

  function clearTarget(
    framebuffer: WebGLFramebuffer,
    width: number,
    height: number,
  ): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, targetWidth, targetHeight);
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, targetHeight - height, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  function drawMask(chunk: GpuBristleChunk): void {
    perfStage("gpuBristleMask", () => {
      const chunkWidth = chunk.bboxRect.right - chunk.bboxRect.left;
      const chunkHeight = chunk.bboxRect.bottom - chunk.bboxRect.top;
      clearTarget(maskFramebuffer, chunkWidth, chunkHeight);
      const vertices = createMaskVertices(chunk);
      uploadGeometry(vertices);
      gl.bindVertexArray(maskVertexArray);
      gl.useProgram(maskProgram);
      gl.uniform2f(maskUniforms.targetSize, targetWidth, targetHeight);
      gl.uniform2i(
        maskUniforms.fieldSize,
        chunk.maskFieldColumns,
        chunk.maskFieldRows,
      );
      gl.uniform2i(
        maskUniforms.fieldTextureSize,
        maskFieldTextureWidth,
        maskFieldTextureHeight,
      );
      gl.uniform2i(
        maskUniforms.documentOrigin,
        chunk.bboxRect.left,
        chunk.bboxRect.top,
      );
      gl.uniform1f(maskUniforms.depositHardness, chunk.depositHardness);
      gl.uniform1f(maskUniforms.grainAmount, chunk.grain.amount);
      gl.uniform1f(maskUniforms.grainSoftness, chunk.grain.softness);
      gl.uniform1ui(maskUniforms.grainSeed, chunk.grain.grainSeed >>> 0);
      gl.uniform1ui(maskUniforms.strokeSeed, chunk.grain.strokeSeed >>> 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, maskFieldTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, toothTexture);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / MASK_VERTEX_FLOATS);
    });
  }

  function drawInk(chunk: GpuBristleChunk): void {
    perfStage("gpuBristleInk", () => {
      const chunkWidth = chunk.bboxRect.right - chunk.bboxRect.left;
      const chunkHeight = chunk.bboxRect.bottom - chunk.bboxRect.top;
      clearTarget(inkFramebuffer, chunkWidth, chunkHeight);
      const vertices = createInkVertices(chunk);
      uploadGeometry(vertices);
      gl.bindVertexArray(inkVertexArray);
      gl.useProgram(inkProgram);
      gl.uniform2f(inkUniforms.targetSize, targetWidth, targetHeight);
      gl.uniform2f(
        inkUniforms.profileScale,
        chunk.profileAtlas.width / profileTextureWidth,
        chunk.profileAtlas.height / profileTextureHeight,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, profileTexture);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / INK_VERTEX_FLOATS);
    });
  }

  function composite(chunk: GpuBristleChunk, target: BristlePassTarget): void {
    perfStage("gpuBristleComposite", () => {
      const left = Math.max(0, chunk.bboxRect.left);
      const top = Math.max(0, chunk.bboxRect.top);
      const right = Math.min(surfaceWidth, chunk.bboxRect.right);
      const bottom = Math.min(surfaceHeight, chunk.bboxRect.bottom);
      if (right <= left || bottom <= top) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.accumFramebuffer);
      gl.viewport(0, 0, surfaceWidth, surfaceHeight);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(left, surfaceHeight - bottom, right - left, bottom - top);
      gl.useProgram(compositeProgram);
      gl.bindVertexArray(maskVertexArray);
      setCompositeUniforms(chunk, target);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
    });
  }

  function setCompositeUniforms(
    chunk: GpuBristleChunk,
    target: BristlePassTarget,
  ): void {
    const chunkWidth = chunk.bboxRect.right - chunk.bboxRect.left;
    const chunkHeight = chunk.bboxRect.bottom - chunk.bboxRect.top;
    gl.uniform2i(compositeUniforms.targetSize, targetWidth, targetHeight);
    gl.uniform2i(compositeUniforms.chunkSize, chunkWidth, chunkHeight);
    gl.uniform2i(
      compositeUniforms.documentOrigin,
      chunk.bboxRect.left,
      chunk.bboxRect.top,
    );
    gl.uniform2i(
      compositeUniforms.fieldSize,
      Math.max(1, target.fieldColumns),
      Math.max(1, target.fieldRows),
    );
    gl.uniform2i(
      compositeUniforms.fieldTextureSize,
      Math.max(1, target.fieldTextureWidth),
      Math.max(1, target.fieldTextureHeight),
    );
    gl.uniform1i(
      compositeUniforms.fieldRowStride,
      Math.max(1, target.fieldRows),
    );
    gl.uniform1i(compositeUniforms.branchIndex, target.branchIndex);
    gl.uniform1i(
      compositeUniforms.useField,
      chunk.useMaterialField && target.fieldColumns > 0 ? 1 : 0,
    );
    gl.uniform4f(
      compositeUniforms.color,
      chunk.color.r / 255,
      chunk.color.g / 255,
      chunk.color.b / 255,
      chunk.color.a / 255,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inkTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(
      gl.TEXTURE_2D,
      chunk.useMaterialField && target.fieldColumns > 0
        ? target.fieldTexture
        : fallbackMaterialTexture,
    );
  }

  function uploadGeometry(vertices: Float32Array): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    if (vertices.byteLength > vertexBufferCapacity) {
      vertexBufferCapacity = vertices.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, vertexBufferCapacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
  }

  function dispose(): void {
    gl.deleteProgram(maskProgram);
    gl.deleteProgram(inkProgram);
    gl.deleteProgram(compositeProgram);
    gl.deleteVertexArray(maskVertexArray);
    gl.deleteVertexArray(inkVertexArray);
    gl.deleteBuffer(vertexBuffer);
    gl.deleteTexture(maskFieldTexture);
    gl.deleteTexture(toothTexture);
    gl.deleteTexture(profileTexture);
    gl.deleteTexture(fallbackMaterialTexture);
    gl.deleteTexture(maskTexture);
    gl.deleteTexture(inkTexture);
    gl.deleteFramebuffer(maskFramebuffer);
    gl.deleteFramebuffer(inkFramebuffer);
  }

  return { draw, dispose };
}

function createMaskVertices(chunk: GpuBristleChunk): Float32Array {
  const values: number[] = [];
  const halfWidth = chunk.brushSize / 2;
  const originX = chunk.bboxRect.left;
  const originY = chunk.bboxRect.top;
  for (const segment of chunk.segments) {
    const fromLeft = maskVertex(
      segment.fromX + segment.fromFrameY * halfWidth - originX,
      segment.fromY - segment.fromFrameX * halfWidth - originY,
      segment.fromFieldColumn,
      0,
      segment.fromPressure,
      segment.trialId,
    );
    const fromRight = maskVertex(
      segment.fromX - segment.fromFrameY * halfWidth - originX,
      segment.fromY + segment.fromFrameX * halfWidth - originY,
      segment.fromFieldColumn,
      chunk.maskFieldRows - 1,
      segment.fromPressure,
      segment.trialId,
    );
    const toLeft = maskVertex(
      segment.toX + segment.toFrameY * halfWidth - originX,
      segment.toY - segment.toFrameX * halfWidth - originY,
      segment.toFieldColumn,
      0,
      segment.toPressure,
      segment.trialId,
    );
    const toRight = maskVertex(
      segment.toX - segment.toFrameY * halfWidth - originX,
      segment.toY + segment.toFrameX * halfWidth - originY,
      segment.toFieldColumn,
      chunk.maskFieldRows - 1,
      segment.toPressure,
      segment.trialId,
    );
    values.push(
      ...fromLeft,
      ...fromRight,
      ...toRight,
      ...fromLeft,
      ...toRight,
      ...toLeft,
    );
  }
  return new Float32Array(values);
}

function maskVertex(
  x: number,
  y: number,
  u: number,
  v: number,
  pressure: number,
  trialId: number,
): readonly number[] {
  return [x, y, u, v, pressure, trialId];
}

function createInkVertices(chunk: GpuBristleChunk): Float32Array {
  const values: number[] = [];
  for (const segment of chunk.segments) {
    const vertices = inkQuad(segment, chunk);
    values.push(
      ...vertices.topLeft,
      ...vertices.bottomLeft,
      ...vertices.bottomRight,
      ...vertices.topLeft,
      ...vertices.bottomRight,
      ...vertices.topRight,
    );
  }
  return new Float32Array(values);
}

function inkQuad(segment: GpuSweepSegment, chunk: GpuBristleChunk) {
  const dx = segment.toX - segment.fromX;
  const dy = segment.toY - segment.fromY;
  const length = Math.hypot(dx, dy);
  const pathX = dx / length;
  const pathY = dy / length;
  const sampled = normalize(
    segment.fromFrameX + segment.toFrameX,
    segment.fromFrameY + segment.toFrameY,
  );
  const alignment = pathX * sampled.x + pathY * sampled.y;
  const frame =
    Math.abs(alignment) > 0.96
      ? {
          x: pathX * (alignment >= 0 ? 1 : -1),
          y: pathY * (alignment >= 0 ? 1 : -1),
        }
      : sampled;
  const centerX = (segment.fromX + segment.toX) / 2 - chunk.bboxRect.left;
  const centerY = (segment.fromY + segment.toY) / 2 - chunk.bboxRect.top;
  const left = -length / 2 - segment.overlap;
  const right = length / 2 + segment.overlap;
  const top = -chunk.brushSize / 2;
  const bottom = chunk.brushSize / 2;
  return {
    topLeft: inkVertex(centerX, centerY, frame.x, frame.y, left, top, 0, 0),
    bottomLeft: inkVertex(
      centerX,
      centerY,
      frame.x,
      frame.y,
      left,
      bottom,
      0,
      1,
    ),
    topRight: inkVertex(centerX, centerY, frame.x, frame.y, right, top, 1, 0),
    bottomRight: inkVertex(
      centerX,
      centerY,
      frame.x,
      frame.y,
      right,
      bottom,
      1,
      1,
    ),
  };
}

function inkVertex(
  centerX: number,
  centerY: number,
  frameX: number,
  frameY: number,
  x: number,
  y: number,
  u: number,
  v: number,
): readonly number[] {
  return [
    centerX + frameX * x - frameY * y,
    centerY + frameY * x + frameX * y,
    u,
    v,
  ];
}

function normalize(
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  const length = Math.hypot(x, y);
  return length > 0.000001 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

function uniformLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  return requireResource(
    gl.getUniformLocation(program, name),
    `GPU bristle ${name} uniform`,
  );
}

function configureGeometry(
  gl: WebGL2RenderingContext,
  maskVertexArray: WebGLVertexArrayObject,
  inkVertexArray: WebGLVertexArrayObject,
  vertexBuffer: WebGLBuffer,
): void {
  gl.bindVertexArray(maskVertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  const maskStride = MASK_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  for (let location = 0; location < 4; location++) {
    gl.enableVertexAttribArray(location);
  }
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, maskStride, 0);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, maskStride, 2 * 4);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, maskStride, 4 * 4);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, maskStride, 5 * 4);

  gl.bindVertexArray(inkVertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  const inkStride = INK_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, inkStride, 0);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, inkStride, 2 * 4);
}

function configureTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  filter: number,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
