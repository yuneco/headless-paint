import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import {
  createBrushAccelerator,
  getBrushAcceleratorRuntime,
  isWebKitUserAgent,
  resolveBrushAcceleratorBackend,
} from "./accelerator";
import { invalidateGpuLayerResidency } from "./gpu-layer-residency";
import {
  type GpuStrokeSurface,
  createGpuStrokeSurface,
} from "./gpu-stroke-surface";

vi.mock("./gpu-stroke-surface", () => ({
  createGpuStrokeSurface: vi.fn(),
}));

const SAFARI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const CHROME_USER_AGENT =
  "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";

beforeEach(() => {
  vi.mocked(createGpuStrokeSurface)
    .mockReset()
    .mockReturnValue({
      width: 1,
      height: 1,
      lost: false,
      maxBranchCount: 64,
      dispose: vi.fn(),
    } as unknown as GpuStrokeSurface);
});

describe("createBrushAccelerator", () => {
  it('backend: "cpu" は常に null を返す', () => {
    expect(createBrushAccelerator({ backend: "cpu" })).toBeNull();
  });

  it("commitMode の既定 bitmap を surface に渡す", () => {
    const accelerator = createBrushAccelerator({ backend: "webgl2" });

    expect(accelerator).not.toBeNull();
    expect(createGpuStrokeSurface).toHaveBeenCalledWith(1, 1, "bitmap");
    accelerator?.dispose();
  });

  it("commitMode の direct を surface に渡す", () => {
    const accelerator = createBrushAccelerator({
      backend: "webgl2",
      commitMode: "direct",
    });

    expect(accelerator).not.toBeNull();
    expect(createGpuStrokeSurface).toHaveBeenCalledWith(1, 1, "direct");
    accelerator?.dispose();
  });

  it("Safari UA を WebKit 系として判定する", () => {
    expect(isWebKitUserAgent(SAFARI_USER_AGENT)).toBe(true);
  });

  it("iOS Safari UA を WebKit 系として判定する", () => {
    expect(
      isWebKitUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
          "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(true);
  });

  it("Chrome / Chromium / Edge / Firefox UA を除外する", () => {
    const excluded = [
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      "Mozilla/5.0 AppleWebKit/537.36 Chromium/140.0.0.0 Safari/537.36",
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      "Mozilla/5.0 Gecko/20100101 Firefox/142.0",
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 FxiOS/142.0 Mobile/15E148 Safari/605.1.15",
    ];
    for (const userAgent of excluded) {
      expect(isWebKitUserAgent(userAgent)).toBe(false);
    }
  });
});

describe("resolveBrushAcceleratorBackend", () => {
  it("Safari UA の auto は WebGL2 を選ぶ", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "auto" },
        { userAgent: SAFARI_USER_AGENT, webgl2Available: () => true },
      ),
    ).toEqual({ backend: "webgl2", reason: "auto: webkit" });
  });

  it("Chrome UA の auto は WebGL2 の可否にかかわらず CPU を選ぶ", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "auto" },
        { userAgent: CHROME_USER_AGENT, webgl2Available: () => true },
      ),
    ).toEqual({ backend: "cpu", reason: "auto: not webkit" });
  });

  it("WebGL2 が利用できなければ CPU を選ぶ", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "webgl2" },
        { userAgent: CHROME_USER_AGENT, webgl2Available: () => false },
      ),
    ).toEqual({ backend: "cpu", reason: "webgl2: unavailable" });
  });

  it("明示的な WebGL2 指定を reason に反映する", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "webgl2" },
        { userAgent: CHROME_USER_AGENT, webgl2Available: () => true },
      ),
    ).toEqual({ backend: "webgl2", reason: "webgl2: setting" });
  });

  it("CPU 指定は WebGL2 の可否にかかわらず CPU を選ぶ", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "cpu" },
        { userAgent: SAFARI_USER_AGENT, webgl2Available: () => true },
      ),
    ).toEqual({ backend: "cpu", reason: "cpu: setting" });
  });
});

describe("undo-1 snapshot lifecycle (no browser)", () => {
  function setupUndo(residentBeforeStroke = true) {
    const canvas = new EventTarget();
    const surface = {
      canvas,
      width: 1,
      height: 1,
      lost: false,
      maxBranchCount: 64,
      beginStroke: vi.fn(),
      commitToLayer: vi.fn(),
      cancelStroke: vi.fn(),
      endStroke: vi.fn(),
      restoreUndoToLayer: vi.fn(() => true),
      dispose: vi.fn(),
    };
    vi.mocked(createGpuStrokeSurface).mockReturnValue(
      surface as unknown as GpuStrokeSurface,
    );
    const accelerator = createBrushAccelerator({ backend: "webgl2" });
    const runtime = getBrushAcceleratorRuntime(accelerator);
    if (!accelerator || !runtime) throw new Error("Missing test accelerator");
    const layer = {
      width: 1,
      height: 1,
      canvas: {},
    } as Layer;
    if (residentBeforeStroke) {
      accelerator.warmUp(layer);
      surface.beginStroke.mockClear();
      surface.endStroke.mockClear();
    }
    const owner = {};
    const command = {};
    const branch = [command];
    expect(runtime.beginStroke(owner, layer, layer.canvas)).toBe(true);
    runtime.commitToLayer(owner, layer);
    runtime.endStroke(owner, true);
    expect(runtime.retainUndoSnapshot(layer, command)).toBe(true);
    runtime.bindUndoSnapshot(command, 7, branch);
    return { accelerator, runtime, surface, layer, command, branch, canvas };
  }

  it("restores once without beginning or replaying a stroke, retaining residency", () => {
    const { accelerator, runtime, surface, layer, branch } = setupUndo();
    expect(surface.endStroke).toHaveBeenLastCalledWith(true);
    expect(runtime.restoreUndoSnapshot(layer, 7, branch)).toBe(true);
    expect(surface.restoreUndoToLayer).toHaveBeenCalledExactlyOnceWith(layer);
    expect(surface.beginStroke).toHaveBeenCalledTimes(1);
    expect(runtime.isLayerResident(layer)).toBe(true);
    expect(runtime.restoreUndoSnapshot(layer, 7, branch)).toBe(false);
    accelerator.dispose();
  });

  it("an uploaded CPU base can hit undo without changing its nonresident status", () => {
    const { accelerator, runtime, surface, layer, branch } = setupUndo(false);
    expect(runtime.restoreUndoSnapshot(layer, 7, branch)).toBe(true);
    expect(surface.restoreUndoToLayer).toHaveBeenCalledExactlyOnceWith(layer);
    expect(runtime.isLayerResident(layer)).toBe(false);
    accelerator.dispose();
  });

  it.each(["index", "branch", "layer", "size"] as const)(
    "rejects a different %s and consumes the stale entry",
    (mismatch) => {
      const { accelerator, runtime, surface, layer, branch } = setupUndo();
      const target = mismatch === "layer" ? { ...layer } : layer;
      if (mismatch === "size") (layer as { width: number }).width = 2;
      expect(
        runtime.restoreUndoSnapshot(
          target,
          mismatch === "index" ? 6 : 7,
          mismatch === "branch" ? [...branch] : branch,
        ),
      ).toBe(false);
      expect(surface.restoreUndoToLayer).not.toHaveBeenCalled();
      expect(runtime.restoreUndoSnapshot(layer, 7, branch)).toBe(false);
      accelerator.dispose();
    },
  );

  it.each([
    "external",
    "checkpointRestore",
    "clearLayer",
    "cpuBrush",
    "copyLayerPixels",
    "setPixel",
    "transformLayer",
    "wrapShift",
    "mergeLayerDown",
    "acceleratorReplaced",
    "replayFailure",
  ] as const)("residency invalidation %s also discards undo", (reason) => {
    const { accelerator, runtime, surface, layer, branch } = setupUndo();
    accelerator.invalidate(layer, reason);
    expect(runtime.restoreUndoSnapshot(layer, 7, branch)).toBe(false);
    expect(surface.restoreUndoToLayer).not.toHaveBeenCalled();
    accelerator.dispose();
  });

  it("uses the engine's external-write hook without an explicit accelerator", () => {
    const { accelerator, runtime, layer, branch } = setupUndo();
    invalidateGpuLayerResidency(layer, "setPixel");
    expect(runtime.restoreUndoSnapshot(layer, 7, branch)).toBe(false);
    accelerator.dispose();
  });

  it.each([
    "newStroke",
    "cancel",
    "layerSwitch",
    "resize",
    "contextLoss",
    "dispose",
  ])("%s cannot reuse the completed snapshot", (action) => {
    const { accelerator, runtime, surface, layer, branch, canvas } =
      setupUndo();
    if (action === "newStroke" || action === "cancel") {
      const owner = {};
      runtime.beginStroke(owner, layer);
      if (action === "cancel") runtime.cancelStroke(owner);
      runtime.endStroke(owner, action === "newStroke");
    } else if (action === "layerSwitch") {
      accelerator.warmUp({ ...layer });
    } else if (action === "resize") {
      runtime.isLayerResident({ ...layer, width: 2 });
    } else if (action === "contextLoss") {
      surface.lost = true;
      canvas.dispatchEvent(new Event("webglcontextlost"));
    } else {
      accelerator.dispose();
    }
    expect(runtime.restoreUndoSnapshot(layer, 7, branch)).toBe(false);
    expect(surface.restoreUndoToLayer).not.toHaveBeenCalled();
    accelerator.dispose();
  });

  it("token-specific disposal of an old branch leaves the new entry intact", () => {
    const { accelerator, runtime, layer, branch } = setupUndo();
    runtime.discardUndoSnapshot({});
    expect(runtime.restoreUndoSnapshot(layer, 7, branch)).toBe(true);
    accelerator.dispose();
  });

  it("a failed GPU restore invalidates residency and falls back", () => {
    const { accelerator, runtime, surface, layer, branch } = setupUndo();
    surface.restoreUndoToLayer.mockImplementation(() => {
      throw new Error("lost");
    });
    expect(runtime.restoreUndoSnapshot(layer, 7, branch)).toBe(false);
    expect(runtime.isLayerResident(layer)).toBe(false);
    accelerator.dispose();
  });
});
