import {
  type BrushRenderState,
  DEFAULT_PRESSURE_CURVE,
  ROUGH_BRISTLE,
  type StrokeStyle,
  appendToCommittedLayer,
  createBrushAssetRegistry,
  createLayer,
} from "@headless-paint/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIncrementalStrokeRenderer,
  createInitialBrushState,
} from "./incremental-stroke";
import { replayCommand } from "./replay";
import { createStrokeRuntime } from "./stroke-runtime";
import type { StrokeCommand } from "./types";

// Exercise real asset resolution and live/replay plumbing. Raster byte parity
// is covered separately in height-map-parity.test.ts with actual Canvas2D.
vi.mock("@headless-paint/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@headless-paint/engine")>()),
  createLayer: vi.fn(() => ({
    id: "layer",
    width: 64,
    height: 64,
    canvas: {},
    ctx: { drawImage: vi.fn() },
    meta: { name: "layer", visible: true, opacity: 1, alphaLocked: false },
  })),
  clearLayer: vi.fn(),
  copyLayerPixels: vi.fn(),
  renderPendingLayer: vi.fn(),
  appendToCommittedLayer: vi.fn(
    (_layer, _points, _style, _expand, _overlap, state: BrushRenderState) =>
      state,
  ),
}));

const style: StrokeStyle = {
  brush: {
    ...ROUGH_BRISTLE,
    dynamics: {
      ...ROUGH_BRISTLE.dynamics,
      surfaceGrain: {
        ...ROUGH_BRISTLE.dynamics.surfaceGrain,
        heightMapId: "paper",
        scalePx: 2,
      },
    },
  },
  color: { r: 0, g: 0, b: 0, a: 255 },
  lineWidth: 12,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  compositeOperation: "source-over",
};
const expand = {
  levels: [
    { mode: "none" as const, offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
  ],
};
const points = [0, 10, 20, 40, 80].map((timestamp) => ({
  x: 10 + timestamp / 2,
  y: 32,
  pressure: 0.5,
  timestamp,
}));
const map = { width: 2, height: 1, heights: new Float32Array([0, 1]) };
const replacement = { ...map, heights: new Float32Array([1, 0]) };

beforeEach(() => vi.clearAllMocks());

describe("stroke height map registry", () => {
  it("GPU recovery reuses the original map after registry replacement", () => {
    const registry = createBrushAssetRegistry();
    registry.setHeightMap("paper", map);
    const getHeightMap = vi.spyOn(registry, "getHeightMap");
    const isStrokeLost = vi.fn(() => false);
    const accelerator = {
      backend: "webgl2" as const,
      warmUp: vi.fn(),
      invalidate: vi.fn(),
      dispose: vi.fn(),
      supportsBranchCount: () => true,
      beginStroke: () => true,
      enter: vi.fn(),
      leave: vi.fn(),
      isLayerResident: () => true,
      isStrokeLost,
      commitToLayer: () => false,
      pollPendingCommit: () => true,
      drainPendingCommit: vi.fn(),
      cancelStroke: () => true,
      endStroke: vi.fn(),
    };
    const renderer = createIncrementalStrokeRenderer({
      layer: createLayer(64, 64),
      style,
      registry,
      accelerator,
      filterPipeline: { filters: [] },
      expand,
      alphaLocked: false,
      brushSeed: 17,
    });
    renderer.feedMany(points);
    registry.setHeightMap("paper", replacement);
    isStrokeLost.mockReturnValue(true);
    vi.mocked(appendToCommittedLayer).mockClear();
    renderer.finalize();
    expect(getHeightMap).toHaveBeenCalledExactlyOnceWith("paper");
    const recoveredCalls = vi.mocked(appendToCommittedLayer).mock.calls;
    expect(recoveredCalls.length).toBeGreaterThan(0);
    for (const call of recoveredCalls) expect(call[5]?.heightMap).toBe(map);
  });

  it("resolves once at live start, freezes the reference and resolves the same map for replay", () => {
    const registry = createBrushAssetRegistry();
    registry.setHeightMap("paper", map);
    const getHeightMap = vi.spyOn(registry, "getHeightMap");
    const onCommit = vi.fn<(command: StrokeCommand) => void>();
    const runtime = createStrokeRuntime({
      setTimeout: () => 0,
      clearTimeout: () => {},
      now: () => 0,
      requestRender: () => {},
      onDrawingChanged: () => {},
      onCommit,
    });
    runtime.start(points[0], {
      layer: createLayer(64, 64),
      pendingLayer: createLayer(64, 64),
      style,
      filterPipeline: { filters: [] },
      expand,
      alphaLocked: false,
      brushSeed: 17,
      registry,
    });
    expect(getHeightMap).toHaveBeenCalledExactlyOnceWith("paper");
    registry.setHeightMap("paper", replacement);
    runtime.moveMany(points.slice(1));
    runtime.end();
    const command = onCommit.mock.calls[0]?.[0];
    expect(command).toBeDefined();
    if (!command) throw new Error("Expected a committed stroke");
    const liveCalls = vi.mocked(appendToCommittedLayer).mock.calls;
    expect(liveCalls.length).toBeGreaterThan(0);
    for (const call of liveCalls) expect(call[5]?.heightMap).toBe(map);
    expect(getHeightMap).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(command)).not.toContain('"heights"');
    registry.setHeightMap("paper", map);
    vi.mocked(appendToCommittedLayer).mockClear();
    replayCommand(createLayer(64, 64), command, registry);
    expect(getHeightMap).toHaveBeenCalledTimes(2);
    const replayCalls = vi.mocked(appendToCommittedLayer).mock.calls;
    expect(replayCalls.length).toBeGreaterThan(0);
    for (const call of replayCalls) expect(call[5]?.heightMap).toBe(map);
    runtime.dispose();
  });

  it("throws the specified errors for missing registry and unregistered IDs at start and replay", () => {
    const registry = createBrushAssetRegistry();
    const command: StrokeCommand = {
      type: "stroke",
      layerId: "layer",
      style,
      inputPoints: points,
      filterPipeline: { filters: [] },
      expand,
      brushSeed: 17,
      alphaLocked: false,
      timestamp: 80,
    };
    for (const candidate of [undefined, registry]) {
      const message = candidate
        ? "Height map not found: paper"
        : "BrushAssetRegistry required for height map";
      expect(() => createInitialBrushState(style, 17, candidate)).toThrow(
        message,
      );
      expect(() =>
        replayCommand(createLayer(64, 64), command, candidate),
      ).toThrow(message);
    }
    expect(appendToCommittedLayer).not.toHaveBeenCalled();
  });

  it("procedural bristle needs no registry and keeps heightMap null", () => {
    expect(
      createInitialBrushState({ ...style, brush: ROUGH_BRISTLE }, 17).brushState
        ?.heightMap,
    ).toBeNull();
  });
});
