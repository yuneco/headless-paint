import { mat3 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import {
  type QuadCorners,
  composeRotation,
  composeScaleAboutAnchor,
  composeTranslation,
  getEdgeMidpoints,
  getOutwardNormal,
  getTransformedCorners,
  isIdentityMatrix,
  isPointInQuad,
} from "./transform-geometry";
import type { ContentBounds, Point } from "./types";

const EPSILON = 1e-6;

function expectPointClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

function expectMatrixClose(
  actual: ArrayLike<number>,
  expected: readonly number[],
) {
  expect(Array.from(actual)).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 6);
  });
}

describe("transform-geometry", () => {
  describe("getTransformedCorners", () => {
    it("applies matrix to bounds corners in overlay order", () => {
      const bounds: ContentBounds = { x: 10, y: 20, width: 4, height: 2 };

      expect(getTransformedCorners(bounds, mat3.create())).toEqual([
        { x: 10, y: 20 },
        { x: 14, y: 20 },
        { x: 10, y: 22 },
        { x: 14, y: 22 },
      ]);
    });

    it("handles rotation", () => {
      const bounds: ContentBounds = { x: 1, y: 2, width: 3, height: 4 };
      const matrix = mat3.fromRotation(mat3.create(), Math.PI / 2);
      const corners = getTransformedCorners(bounds, matrix);

      expectPointClose(corners[0], { x: -2, y: 1 });
      expectPointClose(corners[1], { x: -2, y: 4 });
      expectPointClose(corners[2], { x: -6, y: 1 });
      expectPointClose(corners[3], { x: -6, y: 4 });
    });

    it("handles flipped transforms", () => {
      const bounds: ContentBounds = { x: 1, y: 2, width: 3, height: 4 };
      const matrix = mat3.fromScaling(mat3.create(), [-1, 1]);
      const corners = getTransformedCorners(bounds, matrix);

      expect(corners).toEqual([
        { x: -1, y: 2 },
        { x: -4, y: 2 },
        { x: -1, y: 6 },
        { x: -4, y: 6 },
      ]);
    });
  });

  it("calculates edge midpoints in top, bottom, left, right order", () => {
    const corners: QuadCorners = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 20 },
      { x: 10, y: 20 },
    ];

    expect(getEdgeMidpoints(corners)).toEqual([
      { x: 5, y: 0 },
      { x: 5, y: 20 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ]);
  });

  it("calculates outward unit normals", () => {
    const center = { x: 5, y: 5 };

    expectPointClose(
      getOutwardNormal({ x: 0, y: 0 }, { x: 10, y: 0 }, center),
      { x: 0, y: -1 },
    );
    expectPointClose(
      getOutwardNormal({ x: 0, y: 10 }, { x: 10, y: 10 }, center),
      { x: 0, y: 1 },
    );
    expectPointClose(
      getOutwardNormal({ x: 0, y: 0 }, { x: 0, y: 10 }, center),
      { x: -1, y: 0 },
    );
  });

  describe("isPointInQuad", () => {
    const corners: QuadCorners = [
      { x: 0, y: 2 },
      { x: 2, y: 0 },
      { x: 2, y: 4 },
      { x: 4, y: 2 },
    ];

    it("returns true for points inside and on the boundary", () => {
      expect(isPointInQuad({ x: 2, y: 2 }, corners)).toBe(true);
      expect(isPointInQuad({ x: 1, y: 1 }, corners)).toBe(true);
      expect(isPointInQuad({ x: 0, y: 2 }, corners)).toBe(true);
      expect(isPointInQuad({ x: 2, y: 0 }, corners)).toBe(true);
    });

    it("returns false for points outside", () => {
      expect(isPointInQuad({ x: -0.01, y: 2 }, corners)).toBe(false);
      expect(isPointInQuad({ x: 2, y: 4.01 }, corners)).toBe(false);
      expect(isPointInQuad({ x: 4.01, y: 2 }, corners)).toBe(false);
    });
  });

  describe("matrix composition", () => {
    it("composes translation before the start matrix", () => {
      const start = mat3.fromTranslation(mat3.create(), [2, 3]);
      const result = composeTranslation(start, 5, -1);

      expectMatrixClose(result, [1, 0, 0, 0, 1, 0, 7, 2, 1]);
    });

    it("composes rotation about a layer-space center", () => {
      const result = composeRotation(
        mat3.create(),
        { x: 10, y: 5 },
        Math.PI / 2,
      );

      expectMatrixClose(result, [0, 1, 0, -1, 0, 0, 15, -5, 1]);
    });

    it("composes scale about an anchor transformed by the start matrix", () => {
      const start = mat3.fromTranslation(mat3.create(), [5, 7]);
      const result = composeScaleAboutAnchor(start, { x: 10, y: 20 }, 2, -1);

      expectMatrixClose(result, [2, 0, 0, 0, -1, 0, -5, 47, 1]);
    });
  });

  describe("isIdentityMatrix", () => {
    it("uses exact matrix equality", () => {
      expect(isIdentityMatrix(mat3.create())).toBe(true);

      const nearIdentity = mat3.create();
      nearIdentity[6] = EPSILON;
      expect(isIdentityMatrix(nearIdentity)).toBe(false);
    });
  });
});
