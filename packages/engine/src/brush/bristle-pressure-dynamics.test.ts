import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateRadius, evaluateParametricCurve } from "../draw";
import { createLayer } from "../layer";
import {
  DEFAULT_PRESSURE_CURVE,
  ROUGH_BRISTLE,
  type StrokeStyle,
} from "../types";
import { renderBristleBrushStroke } from "./bristle";
import { getBristleSectionCanvas } from "./bristle-section";
import {
  type BristlePassTarget,
  createGpuBristlePassResources,
} from "./gpu/bristle-pass";
import type { GpuBristleChunk } from "./gpu/gpu-stroke-surface";

const gpu = vi.hoisted(() => ({
  active: false,
  pushBristleChunk: vi.fn<(chunk: GpuBristleChunk) => void>(),
}));
vi.mock("./gpu/accelerator", () => ({
  getActiveGpuStrokeSurface: () => (gpu.active ? gpu : null),
}));
vi.mock("./gpu/gl-resources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gpu/gl-resources")>()),
  createProgram: (_gl: unknown, _vs: string, _fs: string, label: string) => ({
    label,
  }),
}));

// Record Canvas2D geometry and run the real CPU mask rasterizer without a
// browser. Pixel compositing/color interpolation remain browser assertions.
class RecordingCanvas {
  static instances: RecordingCanvas[] = [];
  readonly ctx = {
    canvas: this,
    fillStyle: "",
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    save: vi.fn(),
    restore: vi.fn(),
    resetTransform: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
  };
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    RecordingCanvas.instances.push(this);
  }
  getContext() {
    return this.ctx;
  }
}

beforeEach(() => {
  gpu.active = false;
  gpu.pushBristleChunk.mockClear();
  RecordingCanvas.instances = [];
  vi.stubGlobal("OffscreenCanvas", RecordingCanvas);
});
afterEach(() => vi.unstubAllGlobals());

function render(
  pressure: number | undefined,
  size: number,
  curved = false,
  dropout = 0,
) {
  const layer = createLayer(200, 200);
  const brush = {
    ...ROUGH_BRISTLE,
    pressureDynamics: { dropout, size },
    dynamics: {
      ...ROUGH_BRISTLE.dynamics,
      surfaceGrain: { ...ROUGH_BRISTLE.dynamics.surfaceGrain, amount: 0 },
    },
  };
  const style: StrokeStyle = {
    brush,
    lineWidth: 40,
    color: { r: 10, g: 20, b: 30, a: 255 },
    compositeOperation: "source-over",
    pressureCurve: curved ? { y1: 0, y2: 0 } : DEFAULT_PRESSURE_CURVE,
  };
  const state = renderBristleBrushStroke(
    layer,
    [20, 60, 100, 140].map((x) => ({ x, y: 100, pressure })),
    style,
    brush,
    {
      seed: 17,
      tipCanvas: null,
      branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
    },
    0,
    layer,
  );
  return { state, style };
}

describe("bristle pressure geometry (no browser)", () => {
  it.each([0, 1])(
    "CPU size=%s fills quads at calculateRadius half-width without a section image",
    (size) => {
      for (const pressure of [0.25, 1, undefined]) {
        RecordingCanvas.instances = [];
        const { style } = render(pressure, size);
        const radius = calculateRadius(pressure, 40, size, style.pressureCurve);
        const ink = RecordingCanvas.instances.find(
          (canvas) => canvas.ctx.fill.mock.calls.length > 0,
        );
        expect(ink).toBeDefined();
        if (!ink) throw new Error("Missing CPU ink sweep");
        for (const [, y] of ink.ctx.moveTo.mock.calls as unknown as number[][])
          expect(y).toBeCloseTo(-radius);
        const cross = ink.ctx.lineTo.mock.calls.map(
          (call) => (call as unknown as number[])[1],
        );
        expect(cross).toContain(radius);
        expect(cross).toContain(-radius);
        // drawImage is used once to apply the raster mask, never for lane/profile ink.
        expect(ink.ctx.drawImage).toHaveBeenCalledTimes(1);
        expect(
          RecordingCanvas.instances.some((canvas) => canvas.width === 2),
        ).toBe(false);
        const mask = RecordingCanvas.instances.find(
          (canvas) => canvas.ctx.putImageData.mock.calls.length > 0,
        );
        expect(mask).toBeDefined();
        const pixels = mask?.ctx.putImageData.mock.calls[0]?.[0] as unknown as {
          data: Uint8ClampedArray;
        };
        expect(pixels.data.some((value) => value === 255)).toBe(true);
      }
    },
  );

  it("CPU applies the pressure curve to dropout once", () => {
    const maskPixels = () => {
      const mask = RecordingCanvas.instances.find(
        (canvas) => canvas.ctx.putImageData.mock.calls.length > 0,
      );
      return (
        mask?.ctx.putImageData.mock.calls[0]?.[0] as unknown as {
          data: Uint8ClampedArray;
        }
      ).data;
    };
    for (const pressure of [0.25, undefined]) {
      RecordingCanvas.instances = [];
      const { style } = render(pressure, 0, true, 1);
      const curved = maskPixels();
      RecordingCanvas.instances = [];
      render(
        evaluateParametricCurve(pressure ?? 0.5, style.pressureCurve),
        0,
        false,
        1,
      );
      expect(maskPixels()).toEqual(curved);
    }
  });

  it("CPU size crops dropout noise without stretching its reference-width coordinates", () => {
    const masks = [0, 1].map((size) => {
      RecordingCanvas.instances = [];
      render(0.25, size, false, 1);
      const mask = RecordingCanvas.instances.find(
        (canvas) => canvas.ctx.putImageData.mock.calls.length > 0,
      );
      if (!mask) throw new Error("Missing CPU mask");
      return {
        width: mask.width,
        pixels: (
          mask.ctx.putImageData.mock.calls[0][0] as unknown as {
            data: Uint8ClampedArray;
          }
        ).data,
      };
    });
    // Both bboxes retain the reference half-width margin. Center y=24, while
    // the size=1 sweep spans y=14..34 (radius=10 instead of 20).
    expect(masks[0].width).toBe(masks[1].width);
    for (let y = 14; y < 34; y++) {
      for (let x = 30; x < 100; x++) {
        const offset = (y * masks[0].width + x) * 4 + 3;
        expect(masks[1].pixels[offset]).toBe(masks[0].pixels[offset]);
      }
    }
  });

  it.each([0, 1])(
    "GPU size=%s carries sample widths and curve-adjusted pressures",
    (size) => {
      gpu.active = true;
      for (const curved of [false, true]) {
        for (const pressure of [0.25, 1, undefined]) {
          gpu.pushBristleChunk.mockClear();
          const { style } = render(pressure, size, curved);
          const radius = calculateRadius(
            pressure,
            40,
            size,
            style.pressureCurve,
          );
          const effectivePressure = evaluateParametricCurve(
            pressure ?? 0.5,
            style.pressureCurve,
          );
          const chunk = gpu.pushBristleChunk.mock.calls[0]?.[0];
          expect(chunk).toBeDefined();
          if (!chunk) throw new Error("Missing GPU chunk");
          expect(chunk.brushSize).toBe(40);
          expect(chunk.profileAtlas).toBeNull();
          expect(chunk.useMaterialField).toBe(false);
          expect(chunk.bboxRect.top).toBeLessThanOrEqual(100 - radius);
          expect(chunk.bboxRect.bottom).toBeGreaterThanOrEqual(100 + radius);
          for (const segment of chunk.segments) {
            expect(segment.fromHalfWidth).toBeCloseTo(radius);
            expect(segment.toHalfWidth).toBeCloseTo(radius);
            expect(segment.fromPressure).toBeCloseTo(effectivePressure);
            expect(segment.toPressure).toBeCloseTo(effectivePressure);
          }
          const { gl, uploads } = recordingGl();
          const pass = createGpuBristlePassResources(gl, 200, 200);
          pass.readMaskForTest(chunk);
          const vertices = uploads[0];
          const first = chunk.segments[0];
          expect(vertices[1]).toBeCloseTo(
            first.fromY - radius - chunk.bboxRect.top,
          );
          expect(vertices[3]).toBeCloseTo(-radius);
          expect(vertices[7]).toBeCloseTo(
            first.fromY + radius - chunk.bboxRect.top,
          );
          expect(vertices[9]).toBeCloseTo(radius);
          pass.dispose();
        }
      }
    },
  );

  it("recomputes the previous endpoint width across flushes without applying the curve twice", () => {
    gpu.active = true;
    const { style, state } = render(0.25, 1, true);
    const layer = createLayer(200, 200);
    gpu.pushBristleChunk.mockClear();
    if (style.brush.type !== "bristle") throw new Error("Expected bristle");
    renderBristleBrushStroke(
      layer,
      [
        { x: 160, y: 100, pressure: 1 },
        { x: 180, y: 100, pressure: 1 },
      ],
      style,
      style.brush,
      state,
      0,
      layer,
    );
    const segment = gpu.pushBristleChunk.mock.calls[0][0].segments[0];
    expect(segment.fromHalfWidth).toBeCloseTo(
      calculateRadius(0.25, 40, 1, style.pressureCurve),
    );
    expect(segment.fromPressure).toBeCloseTo(
      evaluateParametricCurve(0.25, style.pressureCurve),
    );
    expect(segment.toHalfWidth).toBeCloseTo(40);
  });

  it("provides a fully painted 2px section cached by dimensions", () => {
    const section = getBristleSectionCanvas(40);
    expect([section.width, section.height]).toEqual([2, 80]);
    const ctx = section.getContext("2d");
    expect(ctx?.fillStyle).toBe("white");
    expect(ctx?.fillRect).toHaveBeenCalledWith(0, 0, 2, 80);
    expect(getBristleSectionCanvas(39.9)).toBe(section);
    expect(getBristleSectionCanvas(1).height).toBe(8);
  });

  it("skips ink and section uploads for plain chunks, retains mixing ink and composite callbacks", () => {
    gpu.active = true;
    render(0.5, 0);
    const chunk = gpu.pushBristleChunk.mock.calls[0][0];
    const { gl, methods, draws } = recordingGl();
    const pass = createGpuBristlePassResources(gl, 200, 200);
    const target = {
      accumFramebuffer: {},
      fieldTexture: {},
      previousFieldTexture: {},
      fieldMixWeights: [0, 1],
      fieldMixSpan: [0, 40],
      fieldGeometry: undefined,
      fieldColumns: 0,
      fieldRows: 0,
      fieldTextureWidth: 1,
      fieldTextureHeight: 1,
      branchIndex: 0,
    } as BristlePassTarget;
    const afterComposite = vi.fn();
    pass.drawBatch([{ chunk, target, afterComposite }]);
    expect(draws).toEqual(["GPU bristle mask", "GPU bristle composite"]);
    expect(methods.texSubImage2D).not.toHaveBeenCalled();
    expect(methods.uniform1i).toHaveBeenCalledWith("uUseInk", 0);
    const section = getBristleSectionCanvas(40);
    const mixed = { ...chunk, profileAtlas: section, useMaterialField: true };
    draws.length = 0;
    pass.drawBatch([
      { chunk, target, afterComposite },
      { chunk: mixed, target, afterComposite },
      { chunk, target, afterComposite },
    ]);
    expect(draws.filter((label) => label === "GPU bristle ink")).toHaveLength(
      1,
    );
    expect(afterComposite).toHaveBeenCalledTimes(4);
    expect(methods.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(methods.uniform1i).toHaveBeenCalledWith("uUseInk", 1);
    pass.draw(mixed, target);
    expect(methods.texSubImage2D).toHaveBeenCalledTimes(1);
    pass.dispose();
  });
});

function recordingGl() {
  const methods: Record<string, ReturnType<typeof vi.fn>> = {};
  const uploads: Float32Array[] = [];
  const draws: string[] = [];
  let program = { label: "" };
  Object.assign(methods, {
    texSubImage2D: vi.fn(),
    getParameter: vi.fn(() => 4096),
    getUniformLocation: vi.fn((_program, name) => name),
    checkFramebufferStatus: vi.fn(() => 0),
    useProgram: vi.fn((value) => {
      program = value;
    }),
    drawArrays: vi.fn(() => draws.push(program.label)),
    bufferSubData: vi.fn((_target, _offset, data) =>
      uploads.push(new Float32Array(data)),
    ),
  });
  const gl = new Proxy(
    {},
    {
      get(_target, key: string) {
        if (key === key.toUpperCase()) return 0;
        methods[key] ??= vi.fn(() => ({}));
        return methods[key];
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, methods, uploads, draws };
}
