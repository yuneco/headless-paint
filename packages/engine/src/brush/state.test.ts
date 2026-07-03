import { describe, expect, it } from "vitest";
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

  it("pending clone は mixing canvas を別 canvas にコピーする", () => {
    const colorBuffer = new OffscreenCanvas(2, 2);
    const colorCtx = colorBuffer.getContext("2d");
    if (!colorCtx) throw new Error("Failed to get 2d context");
    colorCtx.fillStyle = "rgb(255, 0, 0)";
    colorCtx.fillRect(0, 0, 2, 2);

    const state = {
      tipCanvas: null,
      seed: 1,
      branches: [
        {
          accumulatedDistance: 3,
          emissionCount: 4,
          mixing: {
            colorBuffer,
            lastMixingUpdateDistance: 10,
          },
        },
      ],
    };

    const cloned = cloneBrushRenderState(state);
    const clonedBuffer = cloned?.branches[0].mixing?.colorBuffer;
    expect(clonedBuffer).toBeInstanceOf(OffscreenCanvas);
    expect(clonedBuffer).not.toBe(colorBuffer);
    expect(cloned?.branches[0].mixing?.lastMixingUpdateDistance).toBe(10);
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
