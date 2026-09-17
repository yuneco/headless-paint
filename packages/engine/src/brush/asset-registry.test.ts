import { describe, expect, it } from "vitest";
import { createBrushAssetRegistry } from "./tip";

describe("BrushAssetRegistry height maps", () => {
  it("keeps references, overwrites IDs and separates tip and height map namespaces", () => {
    const registry = createBrushAssetRegistry();
    const map = { width: 1, height: 1, heights: new Float32Array([0.5]) };
    const tip = {} as ImageBitmap;
    expect(registry.getHeightMap("paper")).toBeUndefined();
    registry.setTip("paper", tip);
    registry.setHeightMap("paper", map);
    expect(registry.getTip("paper")).toBe(tip);
    expect(registry.getHeightMap("paper")).toBe(map);
    const replacement = { ...map, heights: new Float32Array([1]) };
    registry.setHeightMap("paper", replacement);
    expect(registry.getHeightMap("paper")).toBe(replacement);
    expect(registry.getTip("paper")).toBe(tip);
  });

  it.each([0, -1, 2049, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid width and height without replacing an existing map: %s",
    (dimension) => {
      const registry = createBrushAssetRegistry();
      const map = { width: 1, height: 1, heights: new Float32Array([0.5]) };
      registry.setHeightMap("paper", map);
      for (const invalid of [
        { ...map, width: dimension },
        { ...map, height: dimension },
      ]) {
        expect(() => registry.setHeightMap("paper", invalid)).toThrow(
          RangeError,
        );
        expect(registry.getHeightMap("paper")).toBe(map);
      }
    },
  );

  it.each([5, 7])("rejects mismatched heights length: %s", (length) => {
    const registry = createBrushAssetRegistry();
    expect(() =>
      registry.setHeightMap("paper", {
        width: 3,
        height: 2,
        heights: new Float32Array(length),
      }),
    ).toThrow("Bristle height map heights length must equal width * height");
    expect(registry.getHeightMap("paper")).toBeUndefined();
  });

  it.each([1, 2048])("accepts boundary dimensions: %s", (size) => {
    const registry = createBrushAssetRegistry();
    const map = {
      width: size,
      height: size,
      heights: new Float32Array(size * size),
    };
    registry.setHeightMap("paper", map);
    expect(registry.getHeightMap("paper")).toBe(map);
  });
});
