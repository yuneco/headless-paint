import { describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import {
  createBrushAccelerator,
  getBrushAcceleratorRuntime,
} from "./accelerator";
import {
  type GpuStrokeSurface,
  createGpuStrokeSurface,
} from "./gpu-stroke-surface";

vi.mock("./gpu-stroke-surface", () => ({ createGpuStrokeSurface: vi.fn() }));

describe("accelerator pending commit owner isolation (no browser)", () => {
  it("only the active owner can poll or drain; missing surfaces report completion", () => {
    const surface = {
      width: 1,
      height: 1,
      lost: false,
      maxBranchCount: 64,
      canvas: { addEventListener: vi.fn() },
      beginStroke: vi.fn(),
      endStroke: vi.fn(),
      dispose: vi.fn(),
      pollPendingCommit: vi.fn(() => false),
      drainPendingCommit: vi.fn(),
      commitToLayer: vi.fn(() => true),
    };
    vi.mocked(createGpuStrokeSurface).mockReturnValue(
      surface as unknown as GpuStrokeSurface,
    );
    const accelerator = createBrushAccelerator({ backend: "webgl2" });
    const runtime = getBrushAcceleratorRuntime(accelerator);
    if (!runtime) throw new Error("Missing test accelerator");
    const owner = {};
    const foreign = {};
    const layer = { width: 1, height: 1, canvas: {} } as Layer;
    expect(runtime.pollPendingCommit(owner)).toBe(true);
    expect(runtime.beginStroke(owner, layer, layer.canvas)).toBe(true);
    expect(runtime.commitToLayer(owner, layer, true)).toBe(true);
    expect(surface.commitToLayer).toHaveBeenCalledWith(layer, true);
    expect(runtime.pollPendingCommit(foreign)).toBe(true);
    runtime.drainPendingCommit(foreign);
    expect(surface.pollPendingCommit).not.toHaveBeenCalled();
    expect(surface.drainPendingCommit).not.toHaveBeenCalled();
    expect(runtime.pollPendingCommit(owner)).toBe(false);
    runtime.drainPendingCommit(owner);
    expect(surface.drainPendingCommit).toHaveBeenCalledOnce();
    runtime.endStroke(owner);
    expect(runtime.pollPendingCommit(owner)).toBe(true);
    accelerator?.dispose();
    expect(runtime.pollPendingCommit(owner)).toBe(true);
    expect(surface.pollPendingCommit).toHaveBeenCalledOnce();
  });
});
