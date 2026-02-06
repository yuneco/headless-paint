import { describe, expect, it } from "vitest";
import {
  compileExpand,
  createDefaultExpandConfig,
  expandPoint,
  expandStroke,
  getExpandCount,
} from "./expand";
import type { ExpandConfig, Point } from "./types";

describe("createDefaultExpandConfig", () => {
  it("should create config with mode=none and center origin", () => {
    const config = createDefaultExpandConfig(1000, 800);
    expect(config.mode).toBe("none");
    expect(config.origin).toEqual({ x: 500, y: 400 });
    expect(config.angle).toBe(0);
    expect(config.divisions).toBe(1);
  });
});

describe("getExpandCount", () => {
  it("should return 1 for none mode", () => {
    const config: ExpandConfig = {
      mode: "none",
      origin: { x: 0, y: 0 },
      angle: 0,
      divisions: 1,
    };
    expect(getExpandCount(config)).toBe(1);
  });

  it("should return 2 for axial mode", () => {
    const config: ExpandConfig = {
      mode: "axial",
      origin: { x: 0, y: 0 },
      angle: 0,
      divisions: 1,
    };
    expect(getExpandCount(config)).toBe(2);
  });

  it("should return divisions for radial mode", () => {
    const config: ExpandConfig = {
      mode: "radial",
      origin: { x: 0, y: 0 },
      angle: 0,
      divisions: 6,
    };
    expect(getExpandCount(config)).toBe(6);
  });

  it("should return divisions*2 for kaleidoscope mode", () => {
    const config: ExpandConfig = {
      mode: "kaleidoscope",
      origin: { x: 0, y: 0 },
      angle: 0,
      divisions: 4,
    };
    expect(getExpandCount(config)).toBe(8);
  });
});

describe("compileExpand", () => {
  it("should compile none mode with 1 matrix", () => {
    const config: ExpandConfig = {
      mode: "none",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 1,
    };
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(1);
    expect(compiled.matrices.length).toBe(1);
    expect(compiled.config).toBe(config);
  });

  it("should compile axial mode with 2 matrices", () => {
    const config: ExpandConfig = {
      mode: "axial",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 1,
    };
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(2);
    expect(compiled.matrices.length).toBe(2);
  });

  it("should compile radial mode with N matrices", () => {
    const config: ExpandConfig = {
      mode: "radial",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 6,
    };
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(6);
    expect(compiled.matrices.length).toBe(6);
  });

  it("should compile kaleidoscope mode with 2N matrices", () => {
    const config: ExpandConfig = {
      mode: "kaleidoscope",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 4,
    };
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(8);
    expect(compiled.matrices.length).toBe(8);
  });
});

describe("expandPoint", () => {
  it("should return same point for none mode", () => {
    const config: ExpandConfig = {
      mode: "none",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 1,
    };
    const compiled = compileExpand(config);
    const result = expandPoint({ x: 100, y: 200 }, compiled);
    expect(result.length).toBe(1);
    expect(result[0].x).toBeCloseTo(100);
    expect(result[0].y).toBeCloseTo(200);
  });

  it("should return 2 points for axial mode (vertical axis)", () => {
    const config: ExpandConfig = {
      mode: "axial",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 1,
    };
    const compiled = compileExpand(config);
    const result = expandPoint({ x: 600, y: 300 }, compiled);
    expect(result.length).toBe(2);
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(300);
    expect(result[1].x).toBeCloseTo(400);
    expect(result[1].y).toBeCloseTo(300);
  });

  it("should return N points for radial mode", () => {
    const config: ExpandConfig = {
      mode: "radial",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 4,
    };
    const compiled = compileExpand(config);
    const result = expandPoint({ x: 600, y: 500 }, compiled);
    expect(result.length).toBe(4);
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(500);
    expect(result[1].x).toBeCloseTo(500);
    expect(result[1].y).toBeCloseTo(600);
    expect(result[2].x).toBeCloseTo(400);
    expect(result[2].y).toBeCloseTo(500);
    expect(result[3].x).toBeCloseTo(500);
    expect(result[3].y).toBeCloseTo(400);
  });
});

describe("expandStroke", () => {
  it("should return empty strokes for empty input", () => {
    const config: ExpandConfig = {
      mode: "radial",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 4,
    };
    const compiled = compileExpand(config);
    const result = expandStroke([], compiled);
    expect(result.length).toBe(4);
    expect(result[0]).toEqual([]);
    expect(result[1]).toEqual([]);
  });

  it("should expand stroke to multiple strokes", () => {
    const config: ExpandConfig = {
      mode: "axial",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 1,
    };
    const compiled = compileExpand(config);
    const points: Point[] = [
      { x: 600, y: 300 },
      { x: 650, y: 350 },
    ];
    const result = expandStroke(points, compiled);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(2);
    expect(result[1].length).toBe(2);
    expect(result[0][0].x).toBeCloseTo(600);
    expect(result[1][0].x).toBeCloseTo(400);
  });

  it("should maintain stroke continuity", () => {
    const config: ExpandConfig = {
      mode: "none",
      origin: { x: 0, y: 0 },
      angle: 0,
      divisions: 1,
    };
    const compiled = compileExpand(config);
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ];
    const result = expandStroke(points, compiled);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual(points);
  });
});
