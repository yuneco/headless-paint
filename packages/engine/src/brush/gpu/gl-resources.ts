import { perfMark } from "../perf-debug";
import { COMMIT_CANVAS_SIZE } from "./commit-packing";
import {
  BRANCH_DATA_BINDING,
  BRANCH_DATA_FLOATS,
  FIELD_BATCH_MIX_FRAGMENT_SHADER_SOURCE,
  FIELD_DIFFUSION_FIXED_FRAGMENT_UNIFORM_VECTORS,
  FIELD_MIX_FRAGMENT_SHADER_SOURCE,
  FIELD_VERTEX_SHADER_SOURCE,
  FRAGMENT_SHADER_SOURCE,
  MAX_GPU_STROKE_BRANCHES,
  VERTEX_SHADER_SOURCE,
  createFieldDiffusionFragmentShaderSource,
} from "./shader-sources";

export interface GpuStrokeGlResources {
  readonly canvas: OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  readonly contextState: { lost: boolean };
  readonly program: WebGLProgram;
  readonly fieldMixProgram: WebGLProgram;
  readonly fieldBatchMixProgram: WebGLProgram;
  readonly fieldDiffusionProgram: WebGLProgram;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly quadBuffer: WebGLBuffer;
  readonly instanceBuffer: WebGLBuffer;
  readonly branchDataBuffer: WebGLBuffer;
  readonly accumTexture: WebGLTexture;
  readonly sourceTexture: WebGLTexture;
  readonly tipTexture: WebGLTexture;
  readonly fieldTextures: readonly [WebGLTexture, WebGLTexture];
  readonly fieldFramebuffers: readonly [WebGLFramebuffer, WebGLFramebuffer];
  readonly materialCheckpointTexture: WebGLTexture;
  readonly materialCheckpointFramebuffer: WebGLFramebuffer;
  readonly fieldBatchCheckpointTexture: WebGLTexture;
  readonly fieldBatchCheckpointFramebuffer: WebGLFramebuffer;
  readonly fieldBatchRunDataTexture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly sourceFramebuffer: WebGLFramebuffer;
  readonly surfaceSizeLocation: WebGLUniformLocation;
  readonly strokeFieldUniforms: {
    readonly size: WebGLUniformLocation;
    readonly textureSize: WebGLUniformLocation;
    readonly rowStride: WebGLUniformLocation;
  };
  readonly fieldMixUniforms: {
    readonly fieldDimensions: WebGLUniformLocation;
  };
  readonly fieldBatchMixUniforms: {
    readonly fieldDimensions: WebGLUniformLocation;
    readonly surfaceDimensions: WebGLUniformLocation;
    readonly runCount: WebGLUniformLocation;
  };
  readonly fieldDiffusionUniforms: {
    readonly fieldDimensions: WebGLUniformLocation;
    readonly strengths: WebGLUniformLocation;
  };
  readonly fieldPassScratch: {
    readonly branchData: Float32Array<ArrayBuffer>;
    readonly passAmounts: Float32Array<ArrayBuffer>;
    readonly strengths: Float32Array<ArrayBuffer>;
    mixColumns: number;
    mixRows: number;
    batchMixColumns: number;
    batchMixRows: number;
    batchRunCapacity: number;
    diffusionColumns: number;
    diffusionRows: number;
  };
  readonly maxBranchCount: number;
  readonly useFloatField: boolean;
}

export function createGpuStrokeGlResources(
  width: number,
  height: number,
  instanceByteLength: number,
  instanceFloats: number,
): GpuStrokeGlResources {
  const canvas = new OffscreenCanvas(COMMIT_CANVAS_SIZE, COMMIT_CANVAS_SIZE);
  perfMark("realloc:commitCanvas", {
    width: COMMIT_CANVAS_SIZE,
    height: COMMIT_CANVAS_SIZE,
    forceRecord: true,
  });
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    stencil: false,
  });
  if (!gl) throw new Error("WebGL2 is unavailable");

  const fragmentUniformVectors = Number(
    gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
  );
  const availableBranchUniformVectors = Number.isFinite(fragmentUniformVectors)
    ? Math.floor(fragmentUniformVectors) -
      FIELD_DIFFUSION_FIXED_FRAGMENT_UNIFORM_VECTORS
    : 0;
  const maxBranchCount = Math.min(
    MAX_GPU_STROKE_BRANCHES,
    Math.max(0, availableBranchUniformVectors),
  );
  if (maxBranchCount < 1) {
    throw new Error("GPU fragment uniform capacity is insufficient");
  }
  const contextState = { lost: false };
  canvas.addEventListener("webglcontextlost", () => {
    contextState.lost = true;
  });

  const program = createProgram(
    gl,
    VERTEX_SHADER_SOURCE,
    FRAGMENT_SHADER_SOURCE,
    "GPU stroke",
  );
  const fieldMixProgram = createProgram(
    gl,
    FIELD_VERTEX_SHADER_SOURCE,
    FIELD_MIX_FRAGMENT_SHADER_SOURCE,
    "GPU material field mix",
  );
  const fieldBatchMixProgram = createProgram(
    gl,
    FIELD_VERTEX_SHADER_SOURCE,
    FIELD_BATCH_MIX_FRAGMENT_SHADER_SOURCE,
    "GPU material field batch mix",
  );
  const fieldDiffusionProgram = createProgram(
    gl,
    FIELD_VERTEX_SHADER_SOURCE,
    createFieldDiffusionFragmentShaderSource(maxBranchCount),
    "GPU material field diffusion",
  );
  const vertexArray = requireResource(
    gl.createVertexArray(),
    "WebGL vertex array",
  );
  const instanceBuffer = requireResource(
    gl.createBuffer(),
    "WebGL instance buffer",
  );
  const branchDataBuffer = requireResource(
    gl.createBuffer(),
    "WebGL branch data uniform buffer",
  );
  const accumTexture = requireResource(
    gl.createTexture(),
    "WebGL accumulation texture",
  );
  const sourceTexture = requireResource(
    gl.createTexture(),
    "WebGL source texture",
  );
  const tipTexture = requireResource(gl.createTexture(), "WebGL tip texture");
  const fieldTextures = [
    requireResource(gl.createTexture(), "WebGL field texture"),
    requireResource(gl.createTexture(), "WebGL field texture"),
  ] as const;
  const fieldFramebuffers = [
    requireResource(gl.createFramebuffer(), "WebGL field framebuffer"),
    requireResource(gl.createFramebuffer(), "WebGL field framebuffer"),
  ] as const;
  const materialCheckpointTexture = requireResource(
    gl.createTexture(),
    "WebGL material checkpoint array texture",
  );
  const materialCheckpointFramebuffer = requireResource(
    gl.createFramebuffer(),
    "WebGL material checkpoint framebuffer",
  );
  const fieldBatchCheckpointTexture = requireResource(
    gl.createTexture(),
    "GPU material field batch checkpoint texture",
  );
  const fieldBatchCheckpointFramebuffer = requireResource(
    gl.createFramebuffer(),
    "GPU material field batch checkpoint framebuffer",
  );
  const fieldBatchRunDataTexture = requireResource(
    gl.createTexture(),
    "GPU material field batch run data texture",
  );
  const framebuffer = requireResource(
    gl.createFramebuffer(),
    "WebGL framebuffer",
  );
  const sourceFramebuffer = requireResource(
    gl.createFramebuffer(),
    "WebGL source framebuffer",
  );
  const surfaceSizeLocation = requireResource(
    gl.getUniformLocation(program, "uSurfaceSize"),
    "uSurfaceSize uniform",
  );
  const strokeFieldUniforms = {
    size: requireResource(
      gl.getUniformLocation(program, "uFieldSize"),
      "GPU stroke field size uniform",
    ),
    textureSize: requireResource(
      gl.getUniformLocation(program, "uFieldTextureSize"),
      "GPU stroke field texture size uniform",
    ),
    rowStride: requireResource(
      gl.getUniformLocation(program, "uFieldRowStride"),
      "GPU stroke field row stride uniform",
    ),
  };
  const fieldMixUniforms = {
    fieldDimensions: requireResource(
      gl.getUniformLocation(fieldMixProgram, "uFieldDimensions"),
      "GPU material field mix dimensions uniform",
    ),
  };
  const fieldBatchMixUniforms = {
    fieldDimensions: requireResource(
      gl.getUniformLocation(fieldBatchMixProgram, "uFieldDimensions"),
      "GPU material field batch mix dimensions uniform",
    ),
    surfaceDimensions: requireResource(
      gl.getUniformLocation(fieldBatchMixProgram, "uSurfaceDimensions"),
      "GPU material field batch mix surface dimensions uniform",
    ),
    runCount: requireResource(
      gl.getUniformLocation(fieldBatchMixProgram, "uRunCount"),
      "GPU material field batch mix run count uniform",
    ),
  };
  const fieldDiffusionUniforms = {
    fieldDimensions: requireResource(
      gl.getUniformLocation(fieldDiffusionProgram, "uFieldDimensions"),
      "GPU material field diffusion dimensions uniform",
    ),
    strengths: requireResource(
      gl.getUniformLocation(fieldDiffusionProgram, "uStrengths[0]"),
      "GPU material field diffusion strengths uniform",
    ),
  };
  const fieldPassScratch = {
    branchData: new Float32Array(BRANCH_DATA_FLOATS),
    passAmounts: new Float32Array(maxBranchCount),
    strengths: new Float32Array(maxBranchCount),
    mixColumns: 0,
    mixRows: 0,
    batchMixColumns: 0,
    batchMixRows: 0,
    batchRunCapacity: 0,
    diffusionColumns: 0,
    diffusionRows: 0,
  };

  const quadBuffer = configureStrokeGeometry(
    gl,
    vertexArray,
    instanceBuffer,
    instanceByteLength,
    instanceFloats,
  );
  configureBranchDataBuffer(gl, fieldMixProgram, branchDataBuffer);
  configureTexture2d(gl, accumTexture, gl.NEAREST);
  configureTexture2d(gl, sourceTexture, gl.NEAREST);
  configureTexture2d(gl, tipTexture, gl.LINEAR);
  for (const texture of fieldTextures) {
    configureTexture2d(gl, texture, gl.LINEAR);
  }
  configureTextureArray(gl, materialCheckpointTexture, gl.NEAREST);
  configureTexture2d(gl, fieldBatchCheckpointTexture, gl.NEAREST);
  configureTexture2d(gl, fieldBatchRunDataTexture, gl.NEAREST);
  const useFloatField = Boolean(
    gl.getExtension("EXT_color_buffer_float") ??
      gl.getExtension("EXT_color_buffer_half_float"),
  );
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "uTip"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uField"), 1);
  gl.uniform2f(surfaceSizeLocation, width, height);
  gl.useProgram(fieldMixProgram);
  gl.uniform1i(
    requireResource(
      gl.getUniformLocation(fieldMixProgram, "uCheckpoints"),
      "GPU material field checkpoint sampler uniform",
    ),
    0,
  );
  gl.uniform1i(
    requireResource(
      gl.getUniformLocation(fieldMixProgram, "uPreviousField"),
      "GPU material field previous sampler uniform",
    ),
    1,
  );
  gl.useProgram(fieldBatchMixProgram);
  gl.uniform1i(
    requireResource(
      gl.getUniformLocation(fieldBatchMixProgram, "uCheckpoints"),
      "GPU material field batch checkpoint sampler uniform",
    ),
    0,
  );
  gl.uniform1i(
    requireResource(
      gl.getUniformLocation(fieldBatchMixProgram, "uPreviousField"),
      "GPU material field batch previous sampler uniform",
    ),
    1,
  );
  gl.uniform1i(
    requireResource(
      gl.getUniformLocation(fieldBatchMixProgram, "uRunData"),
      "GPU material field batch run data sampler uniform",
    ),
    2,
  );
  gl.uniform1i(
    requireResource(
      gl.getUniformLocation(fieldBatchMixProgram, "uFlushStartAccum"),
      "GPU material field batch accumulation sampler uniform",
    ),
    3,
  );
  gl.useProgram(fieldDiffusionProgram);
  gl.uniform1i(
    requireResource(
      gl.getUniformLocation(fieldDiffusionProgram, "uPreviousField"),
      "GPU material field diffusion sampler uniform",
    ),
    1,
  );

  return {
    canvas,
    gl,
    contextState,
    program,
    fieldMixProgram,
    fieldBatchMixProgram,
    fieldDiffusionProgram,
    vertexArray,
    quadBuffer,
    instanceBuffer,
    branchDataBuffer,
    accumTexture,
    sourceTexture,
    tipTexture,
    fieldTextures,
    fieldFramebuffers,
    materialCheckpointTexture,
    materialCheckpointFramebuffer,
    fieldBatchCheckpointTexture,
    fieldBatchCheckpointFramebuffer,
    fieldBatchRunDataTexture,
    framebuffer,
    sourceFramebuffer,
    surfaceSizeLocation,
    strokeFieldUniforms,
    fieldMixUniforms,
    fieldBatchMixUniforms,
    fieldDiffusionUniforms,
    fieldPassScratch,
    maxBranchCount,
    useFloatField,
  };
}

export function disposeGpuStrokeGlResources(
  resources: GpuStrokeGlResources,
): void {
  const gl = resources.gl;
  gl.deleteProgram(resources.program);
  gl.deleteProgram(resources.fieldMixProgram);
  gl.deleteProgram(resources.fieldBatchMixProgram);
  gl.deleteProgram(resources.fieldDiffusionProgram);
  gl.deleteVertexArray(resources.vertexArray);
  gl.deleteBuffer(resources.quadBuffer);
  gl.deleteBuffer(resources.instanceBuffer);
  gl.deleteBuffer(resources.branchDataBuffer);
  gl.deleteTexture(resources.accumTexture);
  gl.deleteTexture(resources.sourceTexture);
  gl.deleteTexture(resources.tipTexture);
  for (const texture of resources.fieldTextures) gl.deleteTexture(texture);
  for (const framebuffer of resources.fieldFramebuffers) {
    gl.deleteFramebuffer(framebuffer);
  }
  gl.deleteTexture(resources.materialCheckpointTexture);
  gl.deleteFramebuffer(resources.materialCheckpointFramebuffer);
  gl.deleteTexture(resources.fieldBatchCheckpointTexture);
  gl.deleteFramebuffer(resources.fieldBatchCheckpointFramebuffer);
  gl.deleteTexture(resources.fieldBatchRunDataTexture);
  gl.deleteFramebuffer(resources.framebuffer);
  gl.deleteFramebuffer(resources.sourceFramebuffer);
}

export function createProgram(
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

export function requireResource<T>(value: T | null, label: string): T {
  if (!value) throw new Error(`Failed to create ${label}`);
  return value;
}

export function configureStrokeGeometry(
  gl: WebGL2RenderingContext,
  vertexArray: WebGLVertexArrayObject,
  instanceBuffer: WebGLBuffer,
  instanceByteLength: number,
  instanceFloats: number,
): WebGLBuffer {
  const unitQuad = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
  const quadBuffer = requireResource(gl.createBuffer(), "WebGL quad buffer");
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, instanceByteLength, gl.DYNAMIC_DRAW);
  const stride = instanceFloats * Float32Array.BYTES_PER_ELEMENT;
  for (let index = 0; index < 5; index++) {
    const location = index + 1;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(
      location,
      index === 0 ? 2 : 1,
      gl.FLOAT,
      false,
      stride,
      index === 0 ? 0 : (index + 1) * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  return quadBuffer;
}

export function configureBranchDataBuffer(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  buffer: WebGLBuffer,
): void {
  const blockIndex = gl.getUniformBlockIndex(program, "BranchData");
  if (blockIndex === gl.INVALID_INDEX) {
    throw new Error("GPU branch data uniform block is unavailable");
  }
  gl.uniformBlockBinding(program, blockIndex, BRANCH_DATA_BINDING);
  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
  gl.bufferData(
    gl.UNIFORM_BUFFER,
    BRANCH_DATA_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    gl.DYNAMIC_DRAW,
  );
  gl.bindBufferBase(gl.UNIFORM_BUFFER, BRANCH_DATA_BINDING, buffer);
}

export function configureTexture2d(
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

export function configureTextureArray(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  filter: number,
): void {
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
