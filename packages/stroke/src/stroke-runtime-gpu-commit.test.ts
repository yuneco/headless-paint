import {
  DEFAULT_PRESSURE_CURVE,
  ROUGH_BRISTLE,
  createLayer,
} from "@headless-paint/engine";
import type {
  BrushRenderState,
  Layer,
  StrokeStyle,
} from "@headless-paint/engine";
import { describe, expect, it, vi } from "vitest";
import { createIncrementalStrokeRenderer } from "./incremental-stroke";
import { createStrokeRuntime } from "./stroke-runtime";

// Exercise the real renderer/runtime bridge while keeping rasterization out of
// these timer tests. Pixel contracts are covered by the browser suites.
vi.mock("@headless-paint/engine", async (importOriginal) => {
  const engine =
    await importOriginal<typeof import("@headless-paint/engine")>();
  return {
    ...engine,
    createLayer: vi.fn(() => ({
      id: "layer",
      width: 64,
      height: 64,
      canvas: {},
      ctx: { drawImage: vi.fn() },
      meta: { name: "layer", visible: true, opacity: 1, alphaLocked: false },
    })),
    clearLayer: vi.fn(),
    renderPendingLayer: vi.fn(),
    appendToCommittedLayer: vi.fn(
      (
        _layer: Layer,
        _points: unknown,
        _style: unknown,
        _expand: unknown,
        _overlap: unknown,
        state: BrushRenderState,
      ) => state,
    ),
  };
});

const style: StrokeStyle = {
  brush: ROUGH_BRISTLE,
  color: { r: 50, g: 90, b: 120, a: 255 },
  lineWidth: 8,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  compositeOperation: "source-over",
};
const expand = {
  levels: [
    { mode: "none" as const, offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
  ],
};
const point = (timestamp: number) => ({
  x: 16 + timestamp / 10,
  y: 32,
  pressure: 1,
  timestamp,
});

function setup(stubTimers = false) {
  const accelerator = {
    backend: "webgl2" as const,
    warmUp: vi.fn(),
    invalidate: vi.fn(),
    dispose: vi.fn(),
    supportsBranchCount: () => true,
    beginStroke: vi.fn((_owner: object) => true),
    enter: vi.fn(),
    leave: vi.fn(),
    isLayerResident: () => true,
    isStrokeLost: vi.fn(() => false),
    commitToLayer: vi.fn(
      (_owner: object, _layer: Layer, defer = false) => defer,
    ),
    pollPendingCommit: vi.fn(() => false),
    drainPendingCommit: vi.fn(),
    cancelStroke: vi.fn(() => true),
    endStroke: vi.fn(),
  };
  const callbacks: (() => void)[] = [];
  const setTimeout = vi.fn((fn: () => void, _ms: number) => {
    if (!stubTimers) callbacks.push(fn);
    // Include ID zero: parity-helpers uses a zero-returning timer stub.
    return stubTimers ? 0 : callbacks.length - 1;
  });
  const clearTimeout = vi.fn();
  const requestRender = vi.fn();
  const runtime = createStrokeRuntime({
    accelerator,
    setTimeout,
    clearTimeout,
    requestRender,
    now: () => 0,
    onCommit: vi.fn(),
    onDrawingChanged: vi.fn(),
    randomSeed: () => 1,
  });
  const config = {
    layer: createLayer(64, 64),
    pendingLayer: createLayer(64, 64),
    style,
    filterPipeline: { filters: [] },
    expand,
    alphaLocked: false,
  };
  runtime.start(point(0), config);
  runtime.moveMany([point(40), point(80)]);
  return {
    runtime,
    accelerator,
    callbacks,
    setTimeout,
    clearTimeout,
    requestRender,
    config,
  };
}

describe("stroke runtime deferred GPU commit polling (no browser)", () => {
  it("reschedules TIMEOUT then requests a render when transfer completes", () => {
    const f = setup();
    const owner = f.accelerator.beginStroke.mock.calls[0]?.[0];
    expect(f.accelerator.commitToLayer).toHaveBeenLastCalledWith(
      owner,
      f.config.layer,
      true,
    );
    expect(f.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 0);
    f.requestRender.mockClear();
    f.callbacks.at(-1)?.();
    expect(f.requestRender).not.toHaveBeenCalled();
    const count = f.callbacks.length;
    f.accelerator.pollPendingCommit.mockReturnValue(true);
    f.callbacks.at(-1)?.();
    expect(f.accelerator.pollPendingCommit).toHaveBeenLastCalledWith(owner);
    expect(f.requestRender).toHaveBeenCalledOnce();
    expect(f.accelerator.drainPendingCommit).not.toHaveBeenCalled();
    expect(f.callbacks).toHaveLength(count);
    f.runtime.end();
  });

  it("drains after eight unsuccessful polls and stops scheduling", () => {
    const f = setup();
    f.requestRender.mockClear();
    for (let i = 0; i < 8; i++) f.callbacks.at(-1)?.();
    expect(f.accelerator.pollPendingCommit).toHaveBeenCalledTimes(8);
    expect(f.accelerator.drainPendingCommit).toHaveBeenCalledOnce();
    expect(f.requestRender).toHaveBeenCalledOnce();
    expect(f.setTimeout).toHaveBeenCalledTimes(8);
    f.runtime.end();
  });

  it.each(["end", "cancel", "dispose"] as const)(
    "%s invalidates captured timer callbacks",
    (action) => {
      const f = setup();
      const stale = f.callbacks.at(-1);
      f.runtime[action]();
      expect(f.clearTimeout).toHaveBeenCalledWith(0);
      f.requestRender.mockClear();
      stale?.();
      expect(f.accelerator.pollPendingCommit).not.toHaveBeenCalled();
      expect(f.requestRender).not.toHaveBeenCalled();
      if (action === "end") {
        expect(f.accelerator.commitToLayer).toHaveBeenLastCalledWith(
          expect.any(Object),
          f.config.layer,
          false,
        );
      } else {
        expect(f.accelerator.cancelStroke).toHaveBeenCalledOnce();
      }
    },
  );

  it("a replacement flush cancels the old timer and resets its poll budget", () => {
    const f = setup();
    const stale = f.callbacks.at(-1);
    f.runtime.moveMany([point(120), point(160)]);
    stale?.();
    expect(f.accelerator.pollPendingCommit).not.toHaveBeenCalled();
    f.callbacks.at(-1)?.();
    expect(f.accelerator.pollPendingCommit).toHaveBeenCalledOnce();
    f.runtime.cancel();
  });

  it("zero-returning inert timers still allow synchronous finalization", () => {
    const f = setup(true);
    f.runtime.end();
    expect(f.accelerator.pollPendingCommit).not.toHaveBeenCalled();
    expect(f.accelerator.commitToLayer).toHaveBeenLastCalledWith(
      expect.any(Object),
      f.config.layer,
      false,
    );
    expect(f.accelerator.endStroke).toHaveBeenCalledOnce();
  });

  it("final cadence does not defer or schedule polling even with the callback installed", () => {
    const f = setup();
    f.runtime.cancel();
    f.accelerator.commitToLayer.mockClear();
    const onGpuCommitPending = vi.fn();
    const renderer = createIncrementalStrokeRenderer({
      ...f.config,
      brushSeed: 1,
      accelerator: f.accelerator,
      gpuCommitCadence: "final",
      onGpuCommitPending,
    });
    renderer.feedMany([point(0), point(40), point(80)]);
    expect(f.accelerator.commitToLayer).not.toHaveBeenCalled();
    renderer.finalize();
    expect(f.accelerator.commitToLayer).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      f.config.layer,
      false,
    );
    expect(onGpuCommitPending).not.toHaveBeenCalled();
  });
});
