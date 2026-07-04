import { mat3 } from "gl-matrix";
import type { ContentBounds, Point } from "./types";

export type Mat3Like = ArrayLike<number>;

export type QuadCorners = readonly [Point, Point, Point, Point];

export function getTransformedCorners(
  bounds: ContentBounds,
  matrix: Mat3Like,
): QuadCorners {
  const { x, y, width, height } = bounds;
  return [
    applyMatrix(matrix, { x, y }),
    applyMatrix(matrix, { x: x + width, y }),
    applyMatrix(matrix, { x, y: y + height }),
    applyMatrix(matrix, { x: x + width, y: y + height }),
  ];
}

export function getEdgeMidpoints(
  corners: QuadCorners,
): readonly [Point, Point, Point, Point] {
  const [tl, tr, bl, br] = corners;
  return [
    midpoint(tl, tr),
    midpoint(bl, br),
    midpoint(tl, bl),
    midpoint(tr, br),
  ];
}

export function getOutwardNormal(
  edgeStart: Point,
  edgeEnd: Point,
  quadCenter: Point,
): Point {
  const dx = edgeEnd.x - edgeStart.x;
  const dy = edgeEnd.y - edgeStart.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: -1 };

  const normal = { x: dy / len, y: -dx / len };
  const edgeCenter = midpoint(edgeStart, edgeEnd);
  const towardCenter = {
    x: quadCenter.x - edgeCenter.x,
    y: quadCenter.y - edgeCenter.y,
  };

  if (normal.x * towardCenter.x + normal.y * towardCenter.y > 0) {
    return { x: -normal.x, y: -normal.y };
  }

  return normal;
}

export function isPointInQuad(point: Point, corners: QuadCorners): boolean {
  const [tl, tr, bl, br] = corners;
  return isPointInQuadOrdered(point, tl, tr, br, bl);
}

export function composeTranslation(
  startMatrix: Mat3Like,
  dx: number,
  dy: number,
): Float32Array {
  const translation = mat3.fromTranslation(mat3.create(), [dx, dy]);
  return mat3.multiply(
    mat3.create(),
    translation,
    toMat3(startMatrix),
  ) as Float32Array;
}

export function composeRotation(
  startMatrix: Mat3Like,
  center: Point,
  angleDelta: number,
): Float32Array {
  const toOrigin = mat3.fromTranslation(mat3.create(), [-center.x, -center.y]);
  const rotation = mat3.fromRotation(mat3.create(), angleDelta);
  const fromOrigin = mat3.fromTranslation(mat3.create(), [center.x, center.y]);

  const temp = mat3.create();
  mat3.multiply(temp, rotation, toOrigin);
  mat3.multiply(temp, fromOrigin, temp);
  return mat3.multiply(
    mat3.create(),
    temp,
    toMat3(startMatrix),
  ) as Float32Array;
}

export function composeScaleAboutAnchor(
  startMatrix: Mat3Like,
  anchor: Point,
  sx: number,
  sy: number,
): Float32Array {
  const transformedAnchor = applyMatrix(startMatrix, anchor);
  const toOrigin = mat3.fromTranslation(mat3.create(), [
    -transformedAnchor.x,
    -transformedAnchor.y,
  ]);
  const scale = mat3.fromScaling(mat3.create(), [sx, sy]);
  const fromOrigin = mat3.fromTranslation(mat3.create(), [
    transformedAnchor.x,
    transformedAnchor.y,
  ]);

  const temp = mat3.create();
  mat3.multiply(temp, scale, toOrigin);
  mat3.multiply(temp, fromOrigin, temp);
  return mat3.multiply(
    mat3.create(),
    temp,
    toMat3(startMatrix),
  ) as Float32Array;
}

export function isIdentityMatrix(matrix: Mat3Like): boolean {
  return mat3.exactEquals(toMat3(matrix), mat3.create());
}

function applyMatrix(matrix: Mat3Like, point: Point): Point {
  return {
    x: matrix[0] * point.x + matrix[3] * point.y + matrix[6],
    y: matrix[1] * point.x + matrix[4] * point.y + matrix[7],
  };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function cross2d(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function isPointInQuadOrdered(
  p: Point,
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean {
  const d1 = cross2d(p, a, b);
  const d2 = cross2d(p, b, c);
  const d3 = cross2d(p, c, a);
  const inTri1 =
    (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
  if (inTri1) return true;

  const d4 = cross2d(p, a, c);
  const d5 = cross2d(p, c, d);
  const d6 = cross2d(p, d, a);
  return (d4 >= 0 && d5 >= 0 && d6 >= 0) || (d4 <= 0 && d5 <= 0 && d6 <= 0);
}

function toMat3(matrix: Mat3Like): mat3 {
  return mat3.fromValues(
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[3],
    matrix[4],
    matrix[5],
    matrix[6],
    matrix[7],
    matrix[8],
  );
}
