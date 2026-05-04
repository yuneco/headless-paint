import type { Layer, LayerMeta } from "@headless-paint/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDuplicateLayerCommand,
  applyMergeLayerDownCommand,
  duplicateLayerAtomic,
  mergeLayerDownAtomic,
} from "./layer-operations";

vi.mock("@headless-paint/engine", () => ({
  cloneLayer: vi.fn(
    (source: Layer, options?: { id?: string; meta?: Partial<LayerMeta> }) => ({
      ...source,
      id: options?.id ?? "cloned",
      meta: { ...source.meta, ...options?.meta },
    }),
  ),
  getLayerIndex: vi.fn((layers: readonly Layer[], layerId: string) =>
    layers.findIndex((layer) => layer.id === layerId),
  ),
  mergeLayerDown: vi.fn(
    (
      target: Layer,
      _source: Layer,
      options?: { resultMeta?: Partial<LayerMeta> },
    ) => {
      target.meta.name = options?.resultMeta?.name ?? target.meta.name;
      target.meta.visible = options?.resultMeta?.visible ?? target.meta.visible;
      target.meta.opacity = options?.resultMeta?.opacity ?? 1;
      target.meta.compositeOperation =
        options?.resultMeta?.compositeOperation ?? "source-over";
    },
  ),
}));

function createMockLayer(id: string, meta?: Partial<LayerMeta>): Layer {
  return {
    id,
    width: 4,
    height: 4,
    canvas: {} as OffscreenCanvas,
    ctx: {} as OffscreenCanvasRenderingContext2D,
    meta: { name: id, visible: true, opacity: 1, ...meta },
  };
}

describe("layer operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("duplicates a layer and returns an atomic command", () => {
    const source = createMockLayer("source", { name: "Source" });

    const result = duplicateLayerAtomic([source], {
      sourceLayerId: source.id,
      meta: { name: "Copy" },
    });

    expect(result).not.toBeNull();
    expect(result?.layers).toHaveLength(2);
    expect(result?.insertIndex).toBe(1);
    expect(result?.layer.meta.name).toBe("Copy");
    expect(result?.command).toMatchObject({
      type: "duplicate-layer",
      sourceLayerId: source.id,
      layerId: result?.layer.id,
      insertIndex: 1,
    });
  });

  it("applies duplicate command with recorded id and topology", () => {
    const source = createMockLayer("source");
    const command = {
      type: "duplicate-layer" as const,
      sourceLayerId: source.id,
      layerId: "recorded",
      insertIndex: 1,
      width: 4,
      height: 4,
      meta: { name: "Recorded", visible: true, opacity: 1 },
      timestamp: 1000,
    };

    const result = applyDuplicateLayerCommand([source], command);

    expect(result?.layer.id).toBe("recorded");
    expect(result?.command).toBe(command);
  });

  it("merges a layer down and returns an atomic command", () => {
    const target = createMockLayer("target", { name: "Target", opacity: 0.5 });
    const source = createMockLayer("source", { name: "Source", opacity: 0.8 });

    const result = mergeLayerDownAtomic([target, source], {
      sourceLayerId: source.id,
    });

    expect(result).not.toBeNull();
    expect(result?.layers).toEqual([target]);
    expect(target.meta.opacity).toBe(1);
    expect(target.meta.compositeOperation).toBe("source-over");
    expect(result?.command).toMatchObject({
      type: "merge-layer-down",
      sourceLayerId: source.id,
      targetLayerId: target.id,
      sourceIndex: 1,
      targetIndex: 0,
      sourceMeta: { name: "Source", visible: true, opacity: 0.8 },
      targetMetaBefore: { name: "Target", visible: true, opacity: 0.5 },
    });
  });

  it("rejects merge command when recorded topology does not match", () => {
    const target = createMockLayer("target");
    const source = createMockLayer("source");
    const command = mergeLayerDownAtomic([target, source], {
      sourceLayerId: source.id,
    })?.command;

    expect(command).toBeDefined();
    if (!command) return;
    expect(applyMergeLayerDownCommand([source, target], command)).toBeNull();
  });
});
