import { describe, expect, it } from "vitest";
import {
  compileSymmetry,
  createDefaultSymmetryConfig,
  expandSymmetry,
  getSymmetryCount,
} from "./symmetry";
import type { SymmetryConfig } from "./types";

const CENTER = { x: 100, y: 100 };

describe("createDefaultSymmetryConfig", () => {
  it("should create default config with layer center", () => {
    const config = createDefaultSymmetryConfig(200, 150);

    expect(config.mode).toBe("none");
    expect(config.origin).toEqual({ x: 100, y: 75 });
    expect(config.angle).toBe(0);
    expect(config.divisions).toBe(6);
  });
});

describe("getSymmetryCount", () => {
  it("should return 1 for none mode", () => {
    const config: SymmetryConfig = {
      mode: "none",
      origin: CENTER,
      angle: 0,
      divisions: 6,
    };
    expect(getSymmetryCount(config)).toBe(1);
  });

  it("should return 2 for axial mode", () => {
    const config: SymmetryConfig = {
      mode: "axial",
      origin: CENTER,
      angle: 0,
      divisions: 6,
    };
    expect(getSymmetryCount(config)).toBe(2);
  });

  it("should return divisions for radial mode", () => {
    const config: SymmetryConfig = {
      mode: "radial",
      origin: CENTER,
      angle: 0,
      divisions: 8,
    };
    expect(getSymmetryCount(config)).toBe(8);
  });

  it("should return divisions * 2 for kaleidoscope mode", () => {
    const config: SymmetryConfig = {
      mode: "kaleidoscope",
      origin: CENTER,
      angle: 0,
      divisions: 4,
    };
    expect(getSymmetryCount(config)).toBe(8);
  });
});

describe("compileSymmetry + expandSymmetry", () => {
  describe("none mode", () => {
    it("should return the same point", () => {
      const config: SymmetryConfig = {
        mode: "none",
        origin: CENTER,
        angle: 0,
        divisions: 6,
      };
      const compiled = compileSymmetry(config);
      const point = { x: 150, y: 120 };
      const result = expandSymmetry(point, compiled);

      expect(result).toHaveLength(1);
      expect(result[0].x).toBeCloseTo(150);
      expect(result[0].y).toBeCloseTo(120);
    });
  });

  describe("axial mode (vertical axis at center)", () => {
    it("should reflect point across vertical axis", () => {
      // 垂直軸（angle=0）で左右対称
      const config: SymmetryConfig = {
        mode: "axial",
        origin: CENTER,
        angle: 0,
        divisions: 6,
      };
      const compiled = compileSymmetry(config);

      // 原点から右に30の点
      const point = { x: 130, y: 100 };
      const result = expandSymmetry(point, compiled);

      expect(result).toHaveLength(2);
      // 元の点
      expect(result[0].x).toBeCloseTo(130);
      expect(result[0].y).toBeCloseTo(100);
      // 反射した点（原点から左に30）
      expect(result[1].x).toBeCloseTo(70);
      expect(result[1].y).toBeCloseTo(100);
    });

    it("should reflect point across horizontal axis", () => {
      // 水平軸（angle=π/2）で上下対称
      const config: SymmetryConfig = {
        mode: "axial",
        origin: CENTER,
        angle: Math.PI / 2,
        divisions: 6,
      };
      const compiled = compileSymmetry(config);

      // 原点から下に30の点
      const point = { x: 100, y: 130 };
      const result = expandSymmetry(point, compiled);

      expect(result).toHaveLength(2);
      // 元の点
      expect(result[0].x).toBeCloseTo(100);
      expect(result[0].y).toBeCloseTo(130);
      // 反射した点（原点から上に30）
      expect(result[1].x).toBeCloseTo(100);
      expect(result[1].y).toBeCloseTo(70);
    });
  });

  describe("radial mode", () => {
    it("should create 4 rotated points at 90 degree intervals", () => {
      const config: SymmetryConfig = {
        mode: "radial",
        origin: CENTER,
        angle: 0,
        divisions: 4,
      };
      const compiled = compileSymmetry(config);

      // 原点から右に50の点
      const point = { x: 150, y: 100 };
      const result = expandSymmetry(point, compiled);

      expect(result).toHaveLength(4);

      // 0°: 右 (150, 100)
      expect(result[0].x).toBeCloseTo(150);
      expect(result[0].y).toBeCloseTo(100);

      // 90°: 下 (100, 150)
      expect(result[1].x).toBeCloseTo(100);
      expect(result[1].y).toBeCloseTo(150);

      // 180°: 左 (50, 100)
      expect(result[2].x).toBeCloseTo(50);
      expect(result[2].y).toBeCloseTo(100);

      // 270°: 上 (100, 50)
      expect(result[3].x).toBeCloseTo(100);
      expect(result[3].y).toBeCloseTo(50);
    });

    it("should apply angle offset", () => {
      const config: SymmetryConfig = {
        mode: "radial",
        origin: CENTER,
        angle: Math.PI / 4, // 45度オフセット
        divisions: 4,
      };
      const compiled = compileSymmetry(config);

      // 原点から右に50の点
      const point = { x: 150, y: 100 };
      const result = expandSymmetry(point, compiled);

      expect(result).toHaveLength(4);

      // 45度オフセットなので斜め方向に回転
      const r = 50;
      const cos45 = Math.cos(Math.PI / 4);
      const sin45 = Math.sin(Math.PI / 4);

      // 45°: 右下
      expect(result[0].x).toBeCloseTo(CENTER.x + r * cos45);
      expect(result[0].y).toBeCloseTo(CENTER.y + r * sin45);
    });
  });

  describe("kaleidoscope mode", () => {
    it("should create 2N points (rotation + reflection)", () => {
      const config: SymmetryConfig = {
        mode: "kaleidoscope",
        origin: CENTER,
        angle: 0,
        divisions: 3,
      };
      const compiled = compileSymmetry(config);

      const point = { x: 150, y: 100 };
      const result = expandSymmetry(point, compiled);

      // 3分割 × 2 = 6点
      expect(result).toHaveLength(6);
    });

    it("should have symmetric pairs", () => {
      const config: SymmetryConfig = {
        mode: "kaleidoscope",
        origin: CENTER,
        angle: 0,
        divisions: 4,
      };
      const compiled = compileSymmetry(config);

      const point = { x: 130, y: 110 };
      const result = expandSymmetry(point, compiled);

      // 8点生成される
      expect(result).toHaveLength(8);

      // 全ての点が原点から同じ距離にあることを確認
      const originalDistance = Math.sqrt(
        (point.x - CENTER.x) ** 2 + (point.y - CENTER.y) ** 2,
      );

      for (const p of result) {
        const dist = Math.sqrt((p.x - CENTER.x) ** 2 + (p.y - CENTER.y) ** 2);
        expect(dist).toBeCloseTo(originalDistance);
      }
    });
  });

  describe("point on origin", () => {
    it("should stay at origin for all modes", () => {
      const modes = ["none", "axial", "radial", "kaleidoscope"] as const;

      for (const mode of modes) {
        const config: SymmetryConfig = {
          mode,
          origin: CENTER,
          angle: 0,
          divisions: 6,
        };
        const compiled = compileSymmetry(config);
        const result = expandSymmetry(CENTER, compiled);

        for (const p of result) {
          expect(p.x).toBeCloseTo(CENTER.x);
          expect(p.y).toBeCloseTo(CENTER.y);
        }
      }
    });
  });
});
