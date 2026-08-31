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
  readonly atlasSize: WebGLUniformLocation;
  readonly atlasOrigin: WebGLUniformLocation;
  readonly fieldSize: WebGLUniformLocation;
  readonly fieldTextureSize: WebGLUniformLocation;
  readonly fieldOrigin: WebGLUniformLocation;
  readonly documentOrigin: WebGLUniformLocation;
  readonly depositHardness: WebGLUniformLocation;
  readonly grainAmount: WebGLUniformLocation;
  readonly grainSoftness: WebGLUniformLocation;
  readonly grainSeed: WebGLUniformLocation;
  readonly strokeSeed: WebGLUniformLocation;
}

interface InkUniforms {
  readonly atlasSize: WebGLUniformLocation;
  readonly atlasOrigin: WebGLUniformLocation;
  readonly profileScale: WebGLUniformLocation;
}

interface CompositeUniforms {
  readonly surfaceSize: WebGLUniformLocation;
  readonly atlasSize: WebGLUniformLocation;
  readonly atlasOrigin: WebGLUniformLocation;
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

export interface GpuBristleDraw {
  readonly chunk: GpuBristleChunk;
  readonly target: BristlePassTarget;
}

interface AtlasSlot extends GpuBristleDraw {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface AtlasPage {
  readonly width: number;
  readonly height: number;
  readonly slots: readonly AtlasSlot[];
}

export interface GpuBristlePassResources {
  draw(chunk: GpuBristleChunk, target: BristlePassTarget): void;
  drawBatch(draws: readonly GpuBristleDraw[]): number;
  readMaskForTest(chunk: GpuBristleChunk): Uint8ClampedArray;
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
    atlasSize: uniformLocation(gl, maskProgram, "uAtlasSize"),
    atlasOrigin: uniformLocation(gl, maskProgram, "uAtlasOrigin"),
    fieldSize: uniformLocation(gl, maskProgram, "uFieldSize"),
    fieldTextureSize: uniformLocation(gl, maskProgram, "uMaskFieldTextureSize"),
    fieldOrigin: uniformLocation(gl, maskProgram, "uMaskFieldOrigin"),
    documentOrigin: uniformLocation(gl, maskProgram, "uDocumentOrigin"),
    depositHardness: uniformLocation(gl, maskProgram, "uDepositHardness"),
    grainAmount: uniformLocation(gl, maskProgram, "uGrainAmount"),
    grainSoftness: uniformLocation(gl, maskProgram, "uGrainSoftness"),
    grainSeed: uniformLocation(gl, maskProgram, "uGrainSeed"),
    strokeSeed: uniformLocation(gl, maskProgram, "uStrokeSeed"),
  };
  const inkUniforms: InkUniforms = {
    atlasSize: uniformLocation(gl, inkProgram, "uAtlasSize"),
    atlasOrigin: uniformLocation(gl, inkProgram, "uAtlasOrigin"),
    profileScale: uniformLocation(gl, inkProgram, "uProfileScale"),
  };
  const compositeUniforms: CompositeUniforms = {
    surfaceSize: uniformLocation(gl, compositeProgram, "uSurfaceSize"),
    atlasSize: uniformLocation(gl, compositeProgram, "uAtlasSize"),
    atlasOrigin: uniformLocation(gl, compositeProgram, "uAtlasOrigin"),
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
  const atlasTexture = requireResource(
    gl.createTexture(),
    "GPU bristle atlas texture",
  );
  const atlasFramebuffer = requireResource(
    gl.createFramebuffer(),
    "GPU bristle atlas framebuffer",
  );

  configureTexture(gl, maskFieldTexture, gl.NEAREST);
  configureTexture(gl, toothTexture, gl.NEAREST);
  configureTexture(gl, profileTexture, gl.LINEAR);
  configureTexture(gl, fallbackMaterialTexture, gl.NEAREST);
  configureTexture(gl, atlasTexture, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, atlasFramebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    atlasTexture,
    0,
  );
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
  gl.uniform1i(uniformLocation(gl, compositeProgram, "uAtlas"), 0);
  gl.uniform1i(uniformLocation(gl, compositeProgram, "uField"), 1);
  gl.uniform2i(compositeUniforms.surfaceSize, surfaceWidth, surfaceHeight);

  let atlasWidth = 0;
  let atlasHeight = 0;
  let maskFieldTextureWidth = 0;
  let maskFieldTextureHeight = 0;
  let profileTextureWidth = 0;
  let profileTextureHeight = 0;
  let vertexBufferCapacity = 0;
  let atlasStatusNeedsCheck = false;
  let profileSource: OffscreenCanvas | null = null;
  let toothSource: Float32Array<ArrayBuffer> | null = null;
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

  function draw(chunk: GpuBristleChunk, target: BristlePassTarget): void {
    drawBatch([{ chunk, target }]);
  }

  function drawBatch(draws: readonly GpuBristleDraw[]): number {
    const pages = createAtlasPages(draws, maxTextureSize);
    for (const page of pages) {
      ensureAtlasSize(page.width, page.height);
      drawAtlasPage(page);
      compositePage(page);
    }
    return pages.length * 2;
  }

  function readMaskForTest(chunk: GpuBristleChunk): Uint8ClampedArray {
    const chunkWidth = chunk.bboxRect.right - chunk.bboxRect.left;
    const chunkHeight = chunk.bboxRect.bottom - chunk.bboxRect.top;
    ensureAtlasSize(chunkWidth * 2, chunkHeight);
    uploadMaskFields([chunk]);
    uploadTooth(chunk);
    gl.bindFramebuffer(gl.FRAMEBUFFER, atlasFramebuffer);
    prepareAtlas();
    clearAtlas();
    drawMask(chunk, 0, 0);
    const pixels = new Uint8Array(chunkWidth * chunkHeight * 4);
    gl.readPixels(
      0,
      atlasHeight - chunkHeight,
      chunkWidth,
      chunkHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    const alpha = new Uint8ClampedArray(chunkWidth * chunkHeight);
    for (let y = 0; y < chunkHeight; y++) {
      const sourceY = chunkHeight - 1 - y;
      for (let x = 0; x < chunkWidth; x++) {
        alpha[y * chunkWidth + x] =
          pixels[(sourceY * chunkWidth + x) * 4 + 3] ?? 0;
      }
    }
    return alpha;
  }

  function ensureAtlasSize(width: number, height: number): void {
    if (width <= atlasWidth && height <= atlasHeight) return;
    atlasWidth = Math.max(atlasWidth, width);
    atlasHeight = Math.max(atlasHeight, height);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      atlasWidth,
      atlasHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    atlasStatusNeedsCheck = true;
  }

  function uploadMaskFields(chunks: readonly GpuBristleChunk[]): number[] {
    const usedWidth = chunks.reduce(
      (maximum, chunk) => Math.max(maximum, chunk.maskFieldColumns),
      0,
    );
    const usedHeight = chunks.reduce(
      (sum, chunk) => sum + chunk.maskFieldRows,
      0,
    );
    const origins: number[] = [];
    const packed = new Float32Array(usedWidth * usedHeight);
    let originY = 0;
    for (const chunk of chunks) {
      origins.push(originY);
      for (let row = 0; row < chunk.maskFieldRows; row++) {
        packed.set(
          chunk.maskField.subarray(
            row * chunk.maskFieldColumns,
            (row + 1) * chunk.maskFieldColumns,
          ),
          (originY + row) * usedWidth,
        );
      }
      originY += chunk.maskFieldRows;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, maskFieldTexture);
    if (
      usedWidth > maskFieldTextureWidth ||
      usedHeight > maskFieldTextureHeight
    ) {
      maskFieldTextureWidth = Math.max(maskFieldTextureWidth, usedWidth);
      maskFieldTextureHeight = Math.max(maskFieldTextureHeight, usedHeight);
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
      usedWidth,
      usedHeight,
      gl.RED,
      gl.FLOAT,
      packed,
    );
    return origins;
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

  function prepareAtlas(): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, atlasFramebuffer);
    if (!atlasStatusNeedsCheck) return;
    atlasStatusNeedsCheck = false;
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("GPU bristle atlas framebuffer is incomplete");
    }
  }

  function clearAtlas(): void {
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function drawAtlasPage(page: AtlasPage): void {
    perfStage("gpuBristleMask", () => {
      const fieldOrigins = uploadMaskFields(
        page.slots.map((slot) => slot.chunk),
      );
      const first = page.slots[0];
      const sharedTooth = page.slots.every(
        (slot) =>
          slot.chunk.grain.toothHeights === first?.chunk.grain.toothHeights,
      );
      const sharedProfile = page.slots.every(
        (slot) => slot.chunk.profileAtlas === first?.chunk.profileAtlas,
      );
      if (first) {
        uploadTooth(first.chunk);
        uploadProfile(first.chunk.profileAtlas);
      }
      prepareAtlas();
      clearAtlas();
      for (let index = 0; index < page.slots.length; index++) {
        const slot = page.slots[index];
        if (!slot) continue;
        if (!sharedTooth) uploadTooth(slot.chunk);
        if (!sharedProfile) uploadProfile(slot.chunk.profileAtlas);
        drawMask(slot.chunk, slot.x, slot.y, fieldOrigins[index] ?? 0);
        drawInk(slot.chunk, slot.x + slot.width, slot.y);
      }
    });
    perfStage("gpuBristleInk", () => {});
  }

  function drawMask(
    chunk: GpuBristleChunk,
    atlasX: number,
    atlasY: number,
    fieldOriginY = 0,
  ): void {
    gl.viewport(0, 0, atlasWidth, atlasHeight);
    const vertices = createMaskVertices(chunk);
    uploadGeometry(vertices);
    gl.bindVertexArray(maskVertexArray);
    gl.useProgram(maskProgram);
    gl.uniform2f(maskUniforms.atlasSize, atlasWidth, atlasHeight);
    gl.uniform2f(maskUniforms.atlasOrigin, atlasX, atlasY);
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
    gl.uniform2i(maskUniforms.fieldOrigin, 0, fieldOriginY);
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
  }

  function drawInk(
    chunk: GpuBristleChunk,
    atlasX: number,
    atlasY: number,
  ): void {
    gl.viewport(0, 0, atlasWidth, atlasHeight);
    const vertices = createInkVertices(chunk);
    uploadGeometry(vertices);
    gl.bindVertexArray(inkVertexArray);
    gl.useProgram(inkProgram);
    gl.uniform2f(inkUniforms.atlasSize, atlasWidth, atlasHeight);
    gl.uniform2f(inkUniforms.atlasOrigin, atlasX, atlasY);
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
  }

  function compositePage(page: AtlasPage): void {
    perfStage("gpuBristleComposite", () => {
      const first = page.slots[0];
      if (!first) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, first.target.accumFramebuffer);
      gl.viewport(0, 0, surfaceWidth, surfaceHeight);
      gl.enable(gl.SCISSOR_TEST);
      gl.useProgram(compositeProgram);
      gl.bindVertexArray(maskVertexArray);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const slot of page.slots) {
        const left = Math.max(0, slot.chunk.bboxRect.left);
        const top = Math.max(0, slot.chunk.bboxRect.top);
        const right = Math.min(surfaceWidth, slot.chunk.bboxRect.right);
        const bottom = Math.min(surfaceHeight, slot.chunk.bboxRect.bottom);
        if (right <= left || bottom <= top) continue;
        gl.scissor(left, surfaceHeight - bottom, right - left, bottom - top);
        setCompositeUniforms(slot);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.SCISSOR_TEST);
    });
  }

  function setCompositeUniforms(slot: AtlasSlot): void {
    const { chunk, target } = slot;
    const chunkWidth = chunk.bboxRect.right - chunk.bboxRect.left;
    const chunkHeight = chunk.bboxRect.bottom - chunk.bboxRect.top;
    gl.uniform2i(compositeUniforms.atlasSize, atlasWidth, atlasHeight);
    gl.uniform2i(compositeUniforms.atlasOrigin, slot.x, slot.y);
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
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.activeTexture(gl.TEXTURE1);
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
    gl.deleteTexture(atlasTexture);
    gl.deleteFramebuffer(atlasFramebuffer);
  }

  return { draw, drawBatch, readMaskForTest, dispose };
}

function createAtlasPages(
  draws: readonly GpuBristleDraw[],
  maxTextureSize: number,
): AtlasPage[] {
  const entries = draws.flatMap((draw) => {
    const width = draw.chunk.bboxRect.right - draw.chunk.bboxRect.left;
    const height = draw.chunk.bboxRect.bottom - draw.chunk.bboxRect.top;
    if (width <= 0 || height <= 0 || draw.chunk.segments.length === 0) {
      return [];
    }
    if (width * 2 > maxTextureSize || height > maxTextureSize) {
      throw new Error("GPU bristle chunk exceeds the atlas texture limit");
    }
    if (
      draw.chunk.maskFieldColumns > maxTextureSize ||
      draw.chunk.maskFieldRows > maxTextureSize
    ) {
      throw new Error("GPU bristle mask field exceeds the texture limit");
    }
    return [{ ...draw, width, height }];
  });
  if (entries.length === 0) return [];
  const totalArea = entries.reduce(
    (sum, entry) => sum + entry.width * 2 * entry.height,
    0,
  );
  const widest = entries.reduce(
    (maximum, entry) => Math.max(maximum, entry.width * 2),
    1,
  );
  const packWidth = Math.min(
    maxTextureSize,
    Math.max(widest, Math.ceil(Math.sqrt(totalArea))),
  );
  const pages: AtlasPage[] = [];
  let slots: AtlasSlot[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let usedWidth = 0;
  let maskRows = 0;

  const finishPage = () => {
    if (slots.length === 0) return;
    pages.push({ width: usedWidth, height: y + rowHeight, slots });
    slots = [];
    x = 0;
    y = 0;
    rowHeight = 0;
    usedWidth = 0;
    maskRows = 0;
  };

  for (const entry of entries) {
    const slotWidth = entry.width * 2;
    if (maskRows > 0 && maskRows + entry.chunk.maskFieldRows > maxTextureSize) {
      finishPage();
    }
    if (x > 0 && x + slotWidth > packWidth) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    if (y > 0 && y + entry.height > maxTextureSize) finishPage();
    slots.push({ ...entry, x, y });
    x += slotWidth;
    rowHeight = Math.max(rowHeight, entry.height);
    usedWidth = Math.max(usedWidth, x);
    maskRows += entry.chunk.maskFieldRows;
  }
  finishPage();
  return pages;
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
