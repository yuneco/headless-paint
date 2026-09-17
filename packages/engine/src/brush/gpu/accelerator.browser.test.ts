import { afterEach, describe, expect, it } from "vitest";
import { createLayer } from "../../layer";
import {
  type BrushAccelerator,
  createBrushAccelerator,
  getBrushAcceleratorRuntime,
} from "./accelerator";

let acceleratorUnderTest: BrushAccelerator | null = null;

afterEach(() => {
  acceleratorUnderTest?.dispose();
  acceleratorUnderTest = null;
});

describe("BrushAccelerator browser lifecycle", () => {
  it("Chromium の auto backend は null", () => {
    expect(createBrushAccelerator()).toBeNull();
  });

  it("dispose 後の beginStroke は false", () => {
    const accelerator = createBrushAccelerator({ backend: "webgl2" });
    expect(accelerator).not.toBeNull();
    if (!accelerator) return;
    acceleratorUnderTest = accelerator;
    const runtime = getBrushAcceleratorRuntime(accelerator);
    expect(runtime).not.toBeNull();
    if (!runtime) return;
    const layer = createLayer(32, 24);

    accelerator.dispose();

    expect(runtime.beginStroke({}, layer, layer.canvas, 1)).toBe(false);
  });

  it("maxBranches を stroke 適格判定に使う", () => {
    const accelerator = createBrushAccelerator({
      backend: "webgl2",
      maxBranches: 2,
    });
    expect(accelerator).not.toBeNull();
    if (!accelerator) return;
    acceleratorUnderTest = accelerator;
    const runtime = getBrushAcceleratorRuntime(accelerator);
    expect(runtime?.supportsBranchCount(2)).toBe(true);
    expect(runtime?.supportsBranchCount(3)).toBe(false);
  });

  it("warmUp で residency hit、invalidate で miss になる", () => {
    const accelerator = createBrushAccelerator({ backend: "webgl2" });
    expect(accelerator).not.toBeNull();
    if (!accelerator) return;
    acceleratorUnderTest = accelerator;
    const runtime = getBrushAcceleratorRuntime(accelerator);
    expect(runtime).not.toBeNull();
    if (!runtime) return;
    const layer = createLayer(48, 32);

    accelerator.warmUp(layer);
    expect(runtime.isLayerResident(layer)).toBe(true);
    const owner = {};
    expect(runtime.beginStroke(owner, layer, undefined, 1)).toBe(true);
    runtime.endStroke(owner);

    accelerator.invalidate(layer);
    expect(runtime.isLayerResident(layer)).toBe(false);
    expect(runtime.beginStroke({}, layer, undefined, 1)).toBe(false);
  });

  it("context lost 後の beginStroke は false", () => {
    const accelerator = createBrushAccelerator({ backend: "webgl2" });
    expect(accelerator).not.toBeNull();
    if (!accelerator) return;
    acceleratorUnderTest = accelerator;
    const runtime = getBrushAcceleratorRuntime(accelerator);
    expect(runtime).not.toBeNull();
    if (!runtime) return;
    const layer = createLayer(32, 24);
    const owner = {};
    expect(runtime.beginStroke(owner, layer, layer.canvas, 1)).toBe(true);
    runtime.enter(owner);
    const surface = runtime.getActiveSurface() as {
      readonly canvas: OffscreenCanvas;
    } | null;
    expect(surface).not.toBeNull();
    surface?.canvas.dispatchEvent(new Event("webglcontextlost"));
    runtime.leave(owner);
    runtime.endStroke(owner);

    expect(runtime.beginStroke({}, layer, layer.canvas, 1)).toBe(false);
  });
});
