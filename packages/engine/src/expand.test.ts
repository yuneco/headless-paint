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
    expect(config.divisions).toBe(6);
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

  it("should keep first point unchanged for radial mode with non-zero angle", () => {
    const config: ExpandConfig = {
      mode: "radial",
      origin: { x: 500, y: 500 },
      angle: Math.PI / 2,
      divisions: 2,
    };
    const compiled = compileExpand(config);
    const result = expandPoint({ x: 600, y: 500 }, compiled);
    expect(result.length).toBe(2);
    // i=0: 入力位置そのまま（angleで回転されない）
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(500);
    // i=1: origin中心に180°回転
    expect(result[1].x).toBeCloseTo(400);
    expect(result[1].y).toBeCloseTo(500);
  });

  it("should reflect across angled axis for axial mode with non-zero angle", () => {
    // angle=π/4 → 45度の軸で反転
    const config: ExpandConfig = {
      mode: "axial",
      origin: { x: 500, y: 500 },
      angle: Math.PI / 4,
      divisions: 1,
    };
    const compiled = compileExpand(config);
    // origin右の点 (600,500)
    const result = expandPoint({ x: 600, y: 500 }, compiled);
    expect(result.length).toBe(2);
    // 1番目: 入力位置そのまま
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(500);
    // 2番目: 45度軸で反転 → originから見て(100,0)が(0,100)になる
    expect(result[1].x).toBeCloseTo(500);
    expect(result[1].y).toBeCloseTo(600);
  });

  it("should return 2N points for kaleidoscope mode (angle=0)", () => {
    const config: ExpandConfig = {
      mode: "kaleidoscope",
      origin: { x: 500, y: 500 },
      angle: 0,
      divisions: 4,
    };
    const compiled = compileExpand(config);
    // origin右の点 (600,500)
    const result = expandPoint({ x: 600, y: 500 }, compiled);
    expect(result.length).toBe(8);
    // 入力(600,500)は0°軸上にあるため、隣接ペアが一致する
    // i=0 rotation(0°): 入力位置そのまま
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(500);
    // i=0 reflection(45°軸): (100,0)→反転→(0,100)
    expect(result[1].x).toBeCloseTo(500);
    expect(result[1].y).toBeCloseTo(600);
    // i=1 rotation(90°): (100,0)→回転→(0,100)
    expect(result[2].x).toBeCloseTo(500);
    expect(result[2].y).toBeCloseTo(600);
    // i=1 reflection(135°軸→rotation90°): 反転+回転で元に戻る
    expect(result[3].x).toBeCloseTo(600);
    expect(result[3].y).toBeCloseTo(500);
    // i=2 rotation(180°): (100,0)→(-100,0)
    expect(result[4].x).toBeCloseTo(400);
    expect(result[4].y).toBeCloseTo(500);
    // i=2 reflection(225°軸→rotation180°): (0,-100)
    expect(result[5].x).toBeCloseTo(500);
    expect(result[5].y).toBeCloseTo(400);
    // i=3 rotation(270°): (100,0)→(0,-100)
    expect(result[6].x).toBeCloseTo(500);
    expect(result[6].y).toBeCloseTo(400);
    // i=3 reflection(315°軸→rotation270°): 反転+回転で(-100,0)
    expect(result[7].x).toBeCloseTo(400);
    expect(result[7].y).toBeCloseTo(500);
  });

  it("should keep first point unchanged for kaleidoscope mode with non-zero angle", () => {
    // angle=π/4(45°)でも入力位置は必ず出力に含まれる
    const config: ExpandConfig = {
      mode: "kaleidoscope",
      origin: { x: 500, y: 500 },
      angle: Math.PI / 4,
      divisions: 4,
    };
    const compiled = compileExpand(config);
    const result = expandPoint({ x: 600, y: 500 }, compiled);
    expect(result.length).toBe(8);
    // 入力位置(600,500)が出力のいずれかに含まれる（ペイントツールの大前提）
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(500);
  });

  it("should keep first point unchanged for kaleidoscope mode with arbitrary angle", () => {
    // 任意のangleでも入力位置は必ず保持される
    const angles = [Math.PI / 6, Math.PI / 3, Math.PI / 2, Math.PI];
    const divisions = [2, 3, 4, 6, 8];
    const inputPoint = { x: 600, y: 500 };
    const origin = { x: 500, y: 500 };

    for (const angle of angles) {
      for (const div of divisions) {
        const config: ExpandConfig = {
          mode: "kaleidoscope",
          origin,
          angle,
          divisions: div,
        };
        const compiled = compileExpand(config);
        const result = expandPoint(inputPoint, compiled);
        expect(result[0].x).toBeCloseTo(inputPoint.x);
        expect(result[0].y).toBeCloseTo(inputPoint.y);
      }
    }
  });
});

describe("expandPoint — input position invariant", () => {
  // ペイントツールの大前提: どの対称設定でも入力位置は出力に含まれる
  const origin = { x: 500, y: 500 };
  const inputPoint = { x: 600, y: 500 };
  const angles = [0, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2];

  it("none: input always preserved", () => {
    for (const angle of angles) {
      const compiled = compileExpand({ mode: "none", origin, angle, divisions: 1 });
      const result = expandPoint(inputPoint, compiled);
      expect(result[0].x).toBeCloseTo(inputPoint.x);
      expect(result[0].y).toBeCloseTo(inputPoint.y);
    }
  });

  it("axial: input always preserved regardless of angle", () => {
    for (const angle of angles) {
      const compiled = compileExpand({ mode: "axial", origin, angle, divisions: 1 });
      const result = expandPoint(inputPoint, compiled);
      expect(result[0].x).toBeCloseTo(inputPoint.x);
      expect(result[0].y).toBeCloseTo(inputPoint.y);
    }
  });

  it("radial: input always preserved regardless of angle", () => {
    for (const angle of angles) {
      for (const divisions of [2, 3, 4, 6, 8]) {
        const compiled = compileExpand({ mode: "radial", origin, angle, divisions });
        const result = expandPoint(inputPoint, compiled);
        expect(result[0].x).toBeCloseTo(inputPoint.x);
        expect(result[0].y).toBeCloseTo(inputPoint.y);
      }
    }
  });

  it("kaleidoscope: input always preserved regardless of angle", () => {
    for (const angle of angles) {
      for (const divisions of [2, 3, 4, 6, 8]) {
        const compiled = compileExpand({ mode: "kaleidoscope", origin, angle, divisions });
        const result = expandPoint(inputPoint, compiled);
        expect(result[0].x).toBeCloseTo(inputPoint.x);
        expect(result[0].y).toBeCloseTo(inputPoint.y);
      }
    }
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
