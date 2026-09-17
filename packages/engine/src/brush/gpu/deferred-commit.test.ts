import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { brushPerfDebug } from "../perf-debug";
import { createGpuStrokeGlResources } from "./gl-resources";
import { createGpuStrokeSurface } from "./gpu-stroke-surface";

vi.mock("./gl-resources", () => ({
  createGpuStrokeGlResources: vi.fn(),
  disposeGpuStrokeGlResources: vi.fn(),
}));
vi.mock("./bristle-pass", () => ({
  createGpuBristlePassResources: () => ({ dispose: vi.fn() }),
}));

afterEach(() => {
  brushPerfDebug.enabled = false;
  brushPerfDebug.reset();
});

function setup(mode: "bitmap" | "direct" = "bitmap", size = 64) {
  const calls: string[] = [];
  const fence = {} as WebGLSync;
  const gl = {
    ALREADY_SIGNALED: 0x911a,
    TIMEOUT_EXPIRED: 0x911b,
    CONDITION_SATISFIED: 0x911c,
    WAIT_FAILED: 0x911d,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    isContextLost: vi.fn(() => false),
    fenceSync: vi.fn((): WebGLSync | null => {
      calls.push("fence");
      return fence;
    }),
    clientWaitSync: vi.fn(() => 0x911b),
    deleteSync: vi.fn(() => calls.push("delete")),
    finish: vi.fn(() => calls.push("finish")),
    flush: vi.fn(() => calls.push("flush")),
    clear: vi.fn(() => calls.push("clear")),
    blitFramebuffer: vi.fn(() => calls.push("blit")),
  };
  const context = new Proxy(gl, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      return typeof key === "string" && key === key.toUpperCase() ? 0 : vi.fn();
    },
  }) as unknown as WebGL2RenderingContext;
  const bitmap = { width: 1024, height: 1024, close: vi.fn() };
  let loseContext = () => {};
  const canvas = {
    addEventListener: (_name: string, fn: () => void) => {
      loseContext = fn;
    },
    transferToImageBitmap: vi.fn(() => {
      calls.push("transfer");
      return bitmap;
    }),
  };
  vi.mocked(createGpuStrokeGlResources).mockReturnValue({
    canvas,
    gl: context,
    contextState: { lost: false },
    maxBranchCount: 64,
    fieldTextures: [{}, {}],
    strokeFieldUniforms: {},
  } as unknown as ReturnType<typeof createGpuStrokeGlResources>);
  const drawImage = vi.fn(() => calls.push("draw"));
  const layer = {
    width: size,
    height: size,
    ctx: {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      drawImage,
    },
  } as unknown as Layer;
  const surface = createGpuStrokeSurface(size, size, mode);
  expect(surface).not.toBeNull();
  if (!surface) throw new Error("Test surface creation failed");
  surface.beginStroke();
  const dab = (x = size / 2, dabSize = 16) =>
    surface.pushDab({ x, y: size / 2, size: dabSize, rotation: 0, alpha: 1 });
  calls.length = 0;
  return {
    surface,
    layer,
    gl,
    calls,
    canvas,
    bitmap,
    drawImage,
    dab,
    lose: () => {
      gl.isContextLost.mockReturnValue(true);
      loseContext();
    },
  };
}

describe("deferred GPU commit lifecycle (no browser)", () => {
  it.each([0x911a, 0x911c])(
    "transfers only after signaled status %i and deletes the fence afterwards",
    (status) => {
      const f = setup();
      brushPerfDebug.enabled = true;
      f.dab();
      expect(f.surface.commitToLayer(f.layer, true)).toBe(true);
      expect(f.gl.finish).not.toHaveBeenCalled();
      expect(f.canvas.transferToImageBitmap).not.toHaveBeenCalled();
      expect(f.calls.slice(-2)).toEqual(["fence", "flush"]);
      expect(f.surface.pollPendingCommit()).toBe(false);
      expect(f.gl.clientWaitSync).toHaveBeenCalledWith(expect.anything(), 0, 0);
      expect(f.drawImage).not.toHaveBeenCalled();
      f.gl.clientWaitSync.mockReturnValue(status);
      expect(f.surface.pollPendingCommit()).toBe(true);
      expect(f.calls.slice(-3)).toEqual(["transfer", "draw", "delete"]);
      expect(f.gl.finish).not.toHaveBeenCalled();
      expect(f.surface.pollPendingCommit()).toBe(true);
      expect(f.gl.deleteSync).toHaveBeenCalledOnce();
      expect(brushPerfDebug.snapshot().samples.gpuCommitPolls).toEqual([2]);
      expect(brushPerfDebug.snapshot().stages.gpuCommit.count).toBe(2);
      f.surface.dispose();
    },
  );

  it("drains WAIT_FAILED instead of treating it as completion", () => {
    const f = setup();
    f.dab();
    f.surface.commitToLayer(f.layer, true);
    f.gl.clientWaitSync.mockReturnValue(f.gl.WAIT_FAILED);
    expect(f.surface.pollPendingCommit()).toBe(true);
    expect(f.calls.slice(-4)).toEqual(["finish", "transfer", "draw", "delete"]);
    f.surface.dispose();
  });

  it("drains the previous canvas before the next commit clears it", () => {
    const f = setup();
    f.dab(16);
    f.surface.commitToLayer(f.layer, true);
    f.dab(48);
    f.calls.length = 0;
    f.surface.commitToLayer(f.layer, true);
    expect(f.calls.slice(0, 5)).toEqual([
      "finish",
      "transfer",
      "draw",
      "delete",
      "clear",
    ]);
    f.surface.dispose();
  });

  it.each(["endStroke", "dispose", "drainPendingCommit"] as const)(
    "%s drains a pending commit once",
    (action) => {
      const f = setup();
      f.dab();
      f.surface.commitToLayer(f.layer, true);
      f.surface[action]();
      expect(f.gl.finish).toHaveBeenCalledOnce();
      expect(f.drawImage).toHaveBeenCalledOnce();
      expect(f.surface.pollPendingCommit()).toBe(true);
      f.surface.dispose();
      expect(f.gl.deleteSync).toHaveBeenCalledOnce();
    },
  );

  it("cancel drains before restoring base and leaves no stale pending transfer", () => {
    const f = setup();
    f.dab();
    f.surface.commitToLayer(f.layer, true);
    f.calls.length = 0;
    f.surface.cancelStroke();
    expect(f.calls.slice(0, 5)).toEqual([
      "finish",
      "transfer",
      "draw",
      "delete",
      "blit",
    ]);
    expect(f.surface.pollPendingCommit()).toBe(true);
    expect(f.drawImage).toHaveBeenCalledTimes(2);
    f.surface.dispose();
  });

  it("context loss discards the fence without transferring", () => {
    const f = setup();
    f.dab();
    f.surface.commitToLayer(f.layer, true);
    f.lose();
    expect(f.surface.pollPendingCommit()).toBe(true);
    f.surface.dispose();
    expect(f.gl.finish).not.toHaveBeenCalled();
    expect(f.drawImage).not.toHaveBeenCalled();
    expect(f.gl.deleteSync).toHaveBeenCalledOnce();
  });

  it("multi-pass commits finish and transfer every pass without a fence", () => {
    const f = setup("bitmap", 1536);
    f.dab(768, 1536);
    expect(f.surface.commitToLayer(f.layer, true)).toBe(false);
    expect(f.gl.fenceSync).not.toHaveBeenCalled();
    expect(f.gl.finish.mock.calls.length).toBeGreaterThan(1);
    expect(f.gl.finish.mock.calls.length).toBe(
      f.canvas.transferToImageBitmap.mock.calls.length,
    );
    expect(f.drawImage).toHaveBeenCalledTimes(9);
    f.surface.dispose();
  });

  it("direct commits remain synchronous", () => {
    const f = setup("direct");
    f.dab();
    expect(f.surface.commitToLayer(f.layer, true)).toBe(false);
    expect(f.gl.fenceSync).not.toHaveBeenCalled();
    expect(f.canvas.transferToImageBitmap).not.toHaveBeenCalled();
    expect(f.drawImage).toHaveBeenCalledOnce();
    f.surface.dispose();
  });

  it("a failed fence allocation falls back to synchronous transfer", () => {
    const f = setup();
    f.gl.fenceSync.mockReturnValue(null);
    f.dab();
    expect(f.surface.commitToLayer(f.layer, true)).toBe(false);
    expect(f.gl.finish).toHaveBeenCalledOnce();
    expect(f.drawImage).toHaveBeenCalledOnce();
    f.surface.dispose();
  });

  it.each(["transfer", "size", "draw"])(
    "deferred %s failure uses the existing direct fallback",
    (failure) => {
      const f = setup();
      f.dab();
      f.surface.commitToLayer(f.layer, true);
      if (failure === "transfer")
        f.canvas.transferToImageBitmap.mockImplementationOnce(() => {
          throw new Error("transfer");
        });
      if (failure === "size") f.bitmap.width = 0;
      if (failure === "draw")
        f.drawImage.mockImplementationOnce(() => {
          throw new Error("draw");
        });
      f.surface.drainPendingCommit();
      expect(f.drawImage).toHaveBeenLastCalledWith(
        f.canvas,
        ...Array(8).fill(expect.any(Number)),
      );
      expect(f.gl.deleteSync).toHaveBeenCalledOnce();
      f.surface.dispose();
    },
  );
});
