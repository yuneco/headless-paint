import { describe, expect, it } from "vitest";
import {
  compileExpand,
  compileLocalTransforms,
  createDefaultExpandConfig,
  expandPoint,
  expandStroke,
  getExpandCount,
} from "./expand";
import type { ExpandConfig, Point } from "./types";

// ============================================================
// ヘルパー: 旧形式 → 新形式変換
// ============================================================

function singleLevel(
  mode: ExpandConfig["levels"][0]["mode"],
  origin: Point,
  angle: number,
  divisions: number,
): ExpandConfig {
  return {
    levels: [{ mode, offset: origin, angle, divisions }],
  };
}

// ============================================================
// createDefaultExpandConfig
// ============================================================

describe("createDefaultExpandConfig", () => {
  it("should create config with mode=none and center offset", () => {
    const config = createDefaultExpandConfig(1000, 800);
    expect(config.levels.length).toBe(1);
    expect(config.levels[0].mode).toBe("none");
    expect(config.levels[0].offset).toEqual({ x: 500, y: 400 });
    expect(config.levels[0].angle).toBe(0);
    expect(config.levels[0].divisions).toBe(6);
  });
});

// ============================================================
// compileLocalTransforms
// ============================================================

describe("compileLocalTransforms", () => {
  it("none: returns 1 identity matrix", () => {
    const transforms = compileLocalTransforms("none", 1);
    expect(transforms.length).toBe(1);
  });

  it("axial: returns 2 matrices", () => {
    const transforms = compileLocalTransforms("axial", 1);
    expect(transforms.length).toBe(2);
  });

  it("radial: returns N matrices", () => {
    const transforms = compileLocalTransforms("radial", 6);
    expect(transforms.length).toBe(6);
  });

  it("kaleidoscope: returns 2N matrices", () => {
    const transforms = compileLocalTransforms("kaleidoscope", 4);
    expect(transforms.length).toBe(8);
  });
});

// ============================================================
// getExpandCount
// ============================================================

describe("getExpandCount", () => {
  it("should return 1 for none mode", () => {
    expect(getExpandCount(singleLevel("none", { x: 0, y: 0 }, 0, 1))).toBe(1);
  });

  it("should return 2 for axial mode", () => {
    expect(getExpandCount(singleLevel("axial", { x: 0, y: 0 }, 0, 1))).toBe(2);
  });

  it("should return divisions for radial mode", () => {
    expect(getExpandCount(singleLevel("radial", { x: 0, y: 0 }, 0, 6))).toBe(6);
  });

  it("should return divisions*2 for kaleidoscope mode", () => {
    expect(
      getExpandCount(singleLevel("kaleidoscope", { x: 0, y: 0 }, 0, 4)),
    ).toBe(8);
  });

  it("should multiply counts for multi-level", () => {
    const config: ExpandConfig = {
      levels: [
        { mode: "radial", offset: { x: 500, y: 500 }, angle: 0, divisions: 3 },
        {
          mode: "kaleidoscope",
          offset: { x: 0, y: -80 },
          angle: 0,
          divisions: 4,
        },
      ],
    };
    expect(getExpandCount(config)).toBe(3 * 8);
  });
});

// ============================================================
// compileExpand — 単一レベル (既存テスト移行)
// ============================================================

describe("compileExpand — single level", () => {
  it("should compile none mode with 1 matrix", () => {
    const config = singleLevel("none", { x: 500, y: 500 }, 0, 1);
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(1);
    expect(compiled.matrices.length).toBe(1);
    expect(compiled.config).toBe(config);
  });

  it("should compile axial mode with 2 matrices", () => {
    const config = singleLevel("axial", { x: 500, y: 500 }, 0, 1);
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(2);
    expect(compiled.matrices.length).toBe(2);
  });

  it("should compile radial mode with N matrices", () => {
    const config = singleLevel("radial", { x: 500, y: 500 }, 0, 6);
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(6);
    expect(compiled.matrices.length).toBe(6);
  });

  it("should compile kaleidoscope mode with 2N matrices", () => {
    const config = singleLevel("kaleidoscope", { x: 500, y: 500 }, 0, 4);
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(8);
    expect(compiled.matrices.length).toBe(8);
  });
});

// ============================================================
// expandPoint — 単一レベル (既存テスト移行)
// ============================================================

describe("expandPoint — single level", () => {
  it("should return same point for none mode", () => {
    const compiled = compileExpand(
      singleLevel("none", { x: 500, y: 500 }, 0, 1),
    );
    const result = expandPoint({ x: 100, y: 200 }, compiled);
    expect(result.length).toBe(1);
    expect(result[0].x).toBeCloseTo(100);
    expect(result[0].y).toBeCloseTo(200);
  });

  it("should return 2 points for axial mode (vertical axis)", () => {
    const compiled = compileExpand(
      singleLevel("axial", { x: 500, y: 500 }, 0, 1),
    );
    const result = expandPoint({ x: 600, y: 300 }, compiled);
    expect(result.length).toBe(2);
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(300);
    expect(result[1].x).toBeCloseTo(400);
    expect(result[1].y).toBeCloseTo(300);
  });

  it("should return N points for radial mode", () => {
    const compiled = compileExpand(
      singleLevel("radial", { x: 500, y: 500 }, 0, 4),
    );
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
    const compiled = compileExpand(
      singleLevel("radial", { x: 500, y: 500 }, Math.PI / 2, 2),
    );
    const result = expandPoint({ x: 600, y: 500 }, compiled);
    expect(result.length).toBe(2);
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(500);
    expect(result[1].x).toBeCloseTo(400);
    expect(result[1].y).toBeCloseTo(500);
  });

  it("should reflect across rotated coordinate frame for axial mode with non-zero angle", () => {
    // angle=π/4 は座標系をπ/4回転し、ローカルY軸で反射
    // 旧APIのaxis角度とは異なるセマンティクス
    const compiled = compileExpand(
      singleLevel("axial", { x: 500, y: 500 }, Math.PI / 4, 1),
    );
    const result = expandPoint({ x: 600, y: 500 }, compiled);
    expect(result.length).toBe(2);
    // 第一出力は常に入力位置
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(500);
    // 第二出力は反射された点
    expect(result[1].x).toBeCloseTo(500);
    expect(result[1].y).toBeCloseTo(400);
  });

  it("should return 2N points for kaleidoscope mode (angle=0)", () => {
    const compiled = compileExpand(
      singleLevel("kaleidoscope", { x: 500, y: 500 }, 0, 4),
    );
    const result = expandPoint({ x: 600, y: 500 }, compiled);
    expect(result.length).toBe(8);
    // 入力位置(600,500)は0°軸上にあるため、複数の対称変換が同じ点に写像される
    // 出力順: [identity, reflect(π/4), rot(π/2), reflect(3π/4), rot(π), reflect(5π/4), rot(3π/2), reflect(7π/4)]
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(500);

    // 重要な不変条件: 出力は4つの一意な点のセット
    const unique = new Set(
      result.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`),
    );
    expect(unique).toContain("600,500");
    expect(unique).toContain("500,600");
    expect(unique).toContain("400,500");
    expect(unique).toContain("500,400");
    expect(unique.size).toBe(4);
  });

  it("should produce 2N unique points for kaleidoscope with off-axis input", () => {
    // 入力点が対称軸上にないとき、kaleidoscope N は 2N 個の一意な点を生成すべき
    const compiled = compileExpand(
      singleLevel("kaleidoscope", { x: 500, y: 500 }, 0, 4),
    );
    // (600, 510) は中心(500,500)に対してどの対称軸上にもない
    const result = expandPoint({ x: 600, y: 510 }, compiled);
    expect(result.length).toBe(8);

    const unique = new Set(
      result.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`),
    );
    // D_4 群: 4回転 + 4反射 = 8個の一意な点
    expect(unique.size).toBe(8);

    // 期待される8点 (center=500,500, relative input=(100,10)):
    // 回転: (600,510), (490,600), (400,490), (510,400)
    // 反射: (600,490), (510,600), (400,510), (490,400)
    expect(unique).toContain("600,510"); // identity
    expect(unique).toContain("490,600"); // rot π/2
    expect(unique).toContain("400,490"); // rot π
    expect(unique).toContain("510,400"); // rot 3π/2
    expect(unique).toContain("600,490"); // reflect across x-axis
    expect(unique).toContain("510,600"); // reflect across y=x
    expect(unique).toContain("400,510"); // reflect across y-axis
    expect(unique).toContain("490,400"); // reflect across y=-x
  });

  it("should keep first point unchanged for kaleidoscope mode with non-zero angle", () => {
    const compiled = compileExpand(
      singleLevel("kaleidoscope", { x: 500, y: 500 }, Math.PI / 4, 4),
    );
    const result = expandPoint({ x: 600, y: 500 }, compiled);
    expect(result.length).toBe(8);
    expect(result[0].x).toBeCloseTo(600);
    expect(result[0].y).toBeCloseTo(500);
  });

  it("should keep first point unchanged for kaleidoscope mode with arbitrary angle", () => {
    const angles = [Math.PI / 6, Math.PI / 3, Math.PI / 2, Math.PI];
    const divisions = [2, 3, 4, 6, 8];
    const inputPoint = { x: 600, y: 500 };
    const origin = { x: 500, y: 500 };

    for (const angle of angles) {
      for (const div of divisions) {
        const compiled = compileExpand(
          singleLevel("kaleidoscope", origin, angle, div),
        );
        const result = expandPoint(inputPoint, compiled);
        expect(result[0].x).toBeCloseTo(inputPoint.x);
        expect(result[0].y).toBeCloseTo(inputPoint.y);
      }
    }
  });
});

// ============================================================
// expandPoint — input position invariant (単一レベル)
// ============================================================

describe("expandPoint — input position invariant (single level)", () => {
  const origin = { x: 500, y: 500 };
  const inputPoint = { x: 600, y: 500 };
  const angles = [0, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2];

  it("none: input always preserved", () => {
    for (const angle of angles) {
      const compiled = compileExpand(singleLevel("none", origin, angle, 1));
      const result = expandPoint(inputPoint, compiled);
      expect(result[0].x).toBeCloseTo(inputPoint.x);
      expect(result[0].y).toBeCloseTo(inputPoint.y);
    }
  });

  it("axial: input always preserved regardless of angle", () => {
    for (const angle of angles) {
      const compiled = compileExpand(singleLevel("axial", origin, angle, 1));
      const result = expandPoint(inputPoint, compiled);
      expect(result[0].x).toBeCloseTo(inputPoint.x);
      expect(result[0].y).toBeCloseTo(inputPoint.y);
    }
  });

  it("radial: input always preserved regardless of angle", () => {
    for (const angle of angles) {
      for (const divisions of [2, 3, 4, 6, 8]) {
        const compiled = compileExpand(
          singleLevel("radial", origin, angle, divisions),
        );
        const result = expandPoint(inputPoint, compiled);
        expect(result[0].x).toBeCloseTo(inputPoint.x);
        expect(result[0].y).toBeCloseTo(inputPoint.y);
      }
    }
  });

  it("kaleidoscope: input always preserved regardless of angle", () => {
    for (const angle of angles) {
      for (const divisions of [2, 3, 4, 6, 8]) {
        const compiled = compileExpand(
          singleLevel("kaleidoscope", origin, angle, divisions),
        );
        const result = expandPoint(inputPoint, compiled);
        expect(result[0].x).toBeCloseTo(inputPoint.x);
        expect(result[0].y).toBeCloseTo(inputPoint.y);
      }
    }
  });
});

// ============================================================
// compileExpand — 多段テスト
// ============================================================

describe("compileExpand — multi-level", () => {
  it("2 levels: outputCount = parent × child", () => {
    const config: ExpandConfig = {
      levels: [
        { mode: "radial", offset: { x: 500, y: 500 }, angle: 0, divisions: 3 },
        {
          mode: "kaleidoscope",
          offset: { x: 0, y: -80 },
          angle: 0,
          divisions: 4,
        },
      ],
    };
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(3 * 8);
    expect(compiled.matrices.length).toBe(24);
  });

  it("2 levels: first output = input (invariant)", () => {
    const config: ExpandConfig = {
      levels: [
        { mode: "radial", offset: { x: 500, y: 500 }, angle: 0, divisions: 3 },
        {
          mode: "kaleidoscope",
          offset: { x: 0, y: -80 },
          angle: 0,
          divisions: 4,
        },
      ],
    };
    const compiled = compileExpand(config);
    const inputPoint = { x: 600, y: 400 };
    const result = expandPoint(inputPoint, compiled);
    expect(result[0].x).toBeCloseTo(inputPoint.x);
    expect(result[0].y).toBeCloseTo(inputPoint.y);
  });

  it("child mode=none → equivalent to parent only", () => {
    const parentOnly = singleLevel("radial", { x: 500, y: 500 }, 0, 3);
    const withNoneChild: ExpandConfig = {
      levels: [
        { mode: "radial", offset: { x: 500, y: 500 }, angle: 0, divisions: 3 },
        { mode: "none", offset: { x: 0, y: -80 }, angle: 0, divisions: 1 },
      ],
    };

    const compiledParent = compileExpand(parentOnly);
    const compiledMulti = compileExpand(withNoneChild);

    expect(compiledMulti.outputCount).toBe(compiledParent.outputCount);

    // 同じ入力点に対して同じ数の出力がある
    const inputPoint = { x: 600, y: 400 };
    const resultParent = expandPoint(inputPoint, compiledParent);
    const resultMulti = expandPoint(inputPoint, compiledMulti);

    expect(resultMulti.length).toBe(resultParent.length);
    // 第一出力は同じ
    expect(resultMulti[0].x).toBeCloseTo(resultParent[0].x);
    expect(resultMulti[0].y).toBeCloseTo(resultParent[0].y);
  });

  it("child offset (0,0) → auto-angle = 0, still works", () => {
    const config: ExpandConfig = {
      levels: [
        { mode: "radial", offset: { x: 500, y: 500 }, angle: 0, divisions: 3 },
        {
          mode: "radial",
          offset: { x: 0, y: 0 },
          angle: 0,
          divisions: 2,
        },
      ],
    };
    const compiled = compileExpand(config);
    expect(compiled.outputCount).toBe(6);

    const inputPoint = { x: 600, y: 400 };
    const result = expandPoint(inputPoint, compiled);
    expect(result[0].x).toBeCloseTo(inputPoint.x);
    expect(result[0].y).toBeCloseTo(inputPoint.y);
  });

  it("child offset rotation → first output = input invariant", () => {
    const offsets = [
      { x: 0, y: -80 },
      { x: 80, y: 0 },
      { x: -50, y: 50 },
      { x: 30, y: -60 },
    ];

    for (const offset of offsets) {
      const config: ExpandConfig = {
        levels: [
          {
            mode: "radial",
            offset: { x: 500, y: 500 },
            angle: 0,
            divisions: 3,
          },
          {
            mode: "kaleidoscope",
            offset,
            angle: 0,
            divisions: 4,
          },
        ],
      };
      const compiled = compileExpand(config);
      const inputPoint = { x: 600, y: 400 };
      const result = expandPoint(inputPoint, compiled);
      expect(result[0].x).toBeCloseTo(inputPoint.x);
      expect(result[0].y).toBeCloseTo(inputPoint.y);
    }
  });

  it("parent angle variation → first output = input invariant", () => {
    const angles = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2, Math.PI];

    for (const angle of angles) {
      const config: ExpandConfig = {
        levels: [
          {
            mode: "radial",
            offset: { x: 500, y: 500 },
            angle,
            divisions: 3,
          },
          {
            mode: "kaleidoscope",
            offset: { x: 0, y: -80 },
            angle: 0,
            divisions: 4,
          },
        ],
      };
      const compiled = compileExpand(config);
      const inputPoint = { x: 600, y: 400 };
      const result = expandPoint(inputPoint, compiled);
      expect(result[0].x).toBeCloseTo(inputPoint.x);
      expect(result[0].y).toBeCloseTo(inputPoint.y);
    }
  });
});

// ============================================================
// expandStroke (単一レベル移行)
// ============================================================

describe("expandStroke", () => {
  it("should return empty strokes for empty input", () => {
    const compiled = compileExpand(
      singleLevel("radial", { x: 500, y: 500 }, 0, 4),
    );
    const result = expandStroke([], compiled);
    expect(result.length).toBe(4);
    expect(result[0]).toEqual([]);
    expect(result[1]).toEqual([]);
  });

  it("should expand stroke to multiple strokes", () => {
    const compiled = compileExpand(
      singleLevel("axial", { x: 500, y: 500 }, 0, 1),
    );
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
    const compiled = compileExpand(singleLevel("none", { x: 0, y: 0 }, 0, 1));
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
