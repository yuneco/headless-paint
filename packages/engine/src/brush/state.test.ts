import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH_MIXING } from "../types";
import { prepareMixingState } from "./mixing";
import { hashSeed } from "./prng";
import {
  cloneBrushRenderState,
  createDefaultBrushState,
  ensureBrushRenderState,
  getBranchBrushState,
  mergeBrushState,
  stateToBranch,
} from "./state";

describe("brush render state", () => {
  it("default state は常に branches を持つ", () => {
    expect(createDefaultBrushState()).toEqual({
      tipCanvas: null,
      seed: 0,
      branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
    });
  });

  it("branch 数を補完し、branch seed を hashSeed(seed, branchIndex) にする", () => {
    const state = ensureBrushRenderState(
      {
        tipCanvas: null,
        seed: 123,
        branches: [{ accumulatedDistance: 10, emissionCount: 2 }],
      },
      3,
    );

    expect(state.branches).toHaveLength(3);
    expect(state.branches[1]).toEqual({
      accumulatedDistance: 0,
      emissionCount: 0,
    });

    const branchState = getBranchBrushState(state, 2);
    expect(branchState.seed).toBe(hashSeed(123, 2));
    expect(branchState.branches).toEqual([
      { accumulatedDistance: 0, emissionCount: 0 },
    ]);
  });

  it("branch 描画結果を root state に merge する", () => {
    const root = {
      tipCanvas: null,
      seed: 123,
      branches: [
        { accumulatedDistance: 1, emissionCount: 1 },
        { accumulatedDistance: 2, emissionCount: 2 },
      ],
    };
    const rendered = {
      tipCanvas: null,
      seed: hashSeed(123, 1),
      branches: [{ accumulatedDistance: 20, emissionCount: 5 }],
    };
    const branches = [...root.branches];
    branches[1] = stateToBranch(rendered);

    expect(mergeBrushState(root, branches)).toEqual({
      tipCanvas: null,
      seed: 123,
      branches: [
        { accumulatedDistance: 1, emissionCount: 1 },
        { accumulatedDistance: 20, emissionCount: 5 },
      ],
    });
  });

  it("mixing state clone はnumeric fieldとcanvas ownershipを分離する", () => {
    const tipCanvas = new OffscreenCanvas(4, 4);
    const mixing = prepareMixingState(
      tipCanvas,
      { r: 255, g: 0, b: 0, a: 255 },
      DEFAULT_BRUSH_MIXING,
      undefined,
    );

    const state = {
      tipCanvas: null,
      seed: 1,
      branches: [
        {
          accumulatedDistance: 3,
          emissionCount: 4,
          mixing: { ...mixing, lastUpdateDistance: 10 },
        },
      ],
    };

    const cloned = cloneBrushRenderState(state);
    const clonedMixing = cloned?.branches[0].mixing;
    expect(clonedMixing?.fieldCanvas).toBeInstanceOf(OffscreenCanvas);
    expect(clonedMixing?.fieldCanvas).not.toBe(mixing.fieldCanvas);
    expect(clonedMixing?.field).not.toBe(mixing.field);
    expect(Array.from(clonedMixing?.field ?? [])).toEqual(
      Array.from(mixing.field),
    );
    expect(clonedMixing?.lastUpdateDistance).toBe(10);
  });

  it("pending clone は時間 emission 状態も複製する", () => {
    const state = {
      tipCanvas: null,
      seed: 1,
      branches: [
        {
          accumulatedDistance: 3,
          emissionCount: 4,
          lastTimestamp: 120,
          nextTimeEmissionAt: 145,
        },
      ],
    };

    const cloned = cloneBrushRenderState(state);
    expect(cloned?.branches[0].lastTimestamp).toBe(120);
    expect(cloned?.branches[0].nextTimeEmissionAt).toBe(145);
  });
});
