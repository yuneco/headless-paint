import { describe, expect, it } from "vitest";
import { createLayer } from "./layer";
import {
  addLayer,
  findLayerById,
  getLayerIndex,
  moveLayer,
  removeLayer,
  updateLayerMeta,
} from "./layer-collection";

describe("addLayer", () => {
  it("should add layer at the end by default", () => {
    const l1 = createLayer(10, 10, { name: "L1" });
    const layers = [l1];

    const [updated, newLayer] = addLayer(layers, 10, 10, { name: "L2" });

    expect(updated).toHaveLength(2);
    expect(updated[0]).toBe(l1);
    expect(updated[1]).toBe(newLayer);
    expect(newLayer.meta.name).toBe("L2");
  });

  it("should insert at specified index", () => {
    const l1 = createLayer(10, 10, { name: "L1" });
    const l2 = createLayer(10, 10, { name: "L2" });
    const layers = [l1, l2];

    const [updated, newLayer] = addLayer(layers, 10, 10, { name: "L3" }, 1);

    expect(updated).toHaveLength(3);
    expect(updated[0]).toBe(l1);
    expect(updated[1]).toBe(newLayer);
    expect(updated[2]).toBe(l2);
  });

  it("should return new array without mutating original", () => {
    const layers = [createLayer(10, 10)];
    const [updated] = addLayer(layers, 10, 10);

    expect(updated).not.toBe(layers);
    expect(layers).toHaveLength(1);
    expect(updated).toHaveLength(2);
  });
});

describe("removeLayer", () => {
  it("should remove layer by ID", () => {
    const l1 = createLayer(10, 10);
    const l2 = createLayer(10, 10);
    const layers = [l1, l2];

    const updated = removeLayer(layers, l1.id);

    expect(updated).toHaveLength(1);
    expect(updated[0]).toBe(l2);
  });

  it("should return original array if ID not found", () => {
    const layers = [createLayer(10, 10)];
    const updated = removeLayer(layers, "nonexistent");

    expect(updated).toBe(layers);
  });
});

describe("findLayerById", () => {
  it("should find layer by ID", () => {
    const l1 = createLayer(10, 10);
    const l2 = createLayer(10, 10);
    const layers = [l1, l2];

    expect(findLayerById(layers, l1.id)).toBe(l1);
    expect(findLayerById(layers, l2.id)).toBe(l2);
  });

  it("should return undefined for nonexistent ID", () => {
    const layers = [createLayer(10, 10)];
    expect(findLayerById(layers, "nonexistent")).toBeUndefined();
  });
});

describe("getLayerIndex", () => {
  it("should return correct index", () => {
    const l1 = createLayer(10, 10);
    const l2 = createLayer(10, 10);
    const layers = [l1, l2];

    expect(getLayerIndex(layers, l1.id)).toBe(0);
    expect(getLayerIndex(layers, l2.id)).toBe(1);
  });

  it("should return -1 for nonexistent ID", () => {
    const layers = [createLayer(10, 10)];
    expect(getLayerIndex(layers, "nonexistent")).toBe(-1);
  });
});

describe("moveLayer", () => {
  it("should move layer from one position to another", () => {
    const l1 = createLayer(10, 10, { name: "L1" });
    const l2 = createLayer(10, 10, { name: "L2" });
    const l3 = createLayer(10, 10, { name: "L3" });
    const layers = [l1, l2, l3];

    const updated = moveLayer(layers, 0, 2);

    expect(updated[0]).toBe(l2);
    expect(updated[1]).toBe(l3);
    expect(updated[2]).toBe(l1);
  });

  it("should return same array if fromIndex equals toIndex", () => {
    const layers = [createLayer(10, 10), createLayer(10, 10)];
    const updated = moveLayer(layers, 0, 0);

    expect(updated).toBe(layers);
  });

  it("should return same array for out-of-bounds indices", () => {
    const layers = [createLayer(10, 10)];
    expect(moveLayer(layers, -1, 0)).toBe(layers);
    expect(moveLayer(layers, 0, 1)).toBe(layers);
  });

  it("should preserve relative order of other elements", () => {
    const l1 = createLayer(10, 10, { name: "L1" });
    const l2 = createLayer(10, 10, { name: "L2" });
    const l3 = createLayer(10, 10, { name: "L3" });
    const l4 = createLayer(10, 10, { name: "L4" });
    const layers = [l1, l2, l3, l4];

    const updated = moveLayer(layers, 3, 1);

    expect(updated[0]).toBe(l1);
    expect(updated[1]).toBe(l4);
    expect(updated[2]).toBe(l2);
    expect(updated[3]).toBe(l3);
  });
});

describe("updateLayerMeta", () => {
  it("should update specified fields only", () => {
    const l1 = createLayer(10, 10, { name: "L1", visible: true, opacity: 1 });
    const layers = [l1];

    const updated = updateLayerMeta(layers, l1.id, { visible: false });

    expect(updated[0].meta.visible).toBe(false);
    expect(updated[0].meta.name).toBe("L1");
    expect(updated[0].meta.opacity).toBe(1);
  });

  it("should return new array (immutable)", () => {
    const l1 = createLayer(10, 10);
    const layers = [l1];

    const updated = updateLayerMeta(layers, l1.id, { name: "Updated" });

    expect(updated).not.toBe(layers);
    expect(updated[0]).not.toBe(l1);
    expect(l1.meta.name).toBe("Layer"); // original unchanged
  });
});
