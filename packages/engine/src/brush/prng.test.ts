import { describe, expect, it } from "vitest";
import { hashSeed, mulberry32 } from "./prng";

describe("mulberry32", () => {
  it("同じシードから同じ乱数列を生成する", () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    for (let i = 0; i < 10; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("異なるシードから異なる乱数列を生成する", () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(54321);
    const values1 = Array.from({ length: 5 }, () => rng1());
    const values2 = Array.from({ length: 5 }, () => rng2());
    expect(values1).not.toEqual(values2);
  });

  it("[0, 1) の範囲の値を返す", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hashSeed", () => {
  it("同じ入力から同じシードを生成する", () => {
    expect(hashSeed(100, 50.0)).toBe(hashSeed(100, 50.0));
  });

  it("距離の量子化: 近い距離値は同じシードを返す", () => {
    expect(hashSeed(100, 50.004)).toBe(hashSeed(100, 50.004));
  });

  it("異なる距離は異なるシードを返す", () => {
    expect(hashSeed(100, 10.0)).not.toBe(hashSeed(100, 20.0));
  });

  it("異なるグローバルシードは異なるシードを返す", () => {
    expect(hashSeed(100, 50.0)).not.toBe(hashSeed(200, 50.0));
  });
});
