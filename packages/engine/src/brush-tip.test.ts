import { describe, expect, it } from "vitest";
import { createBrushTipRegistry, generateBrushTip } from "./brush-tip";
import type { Color } from "./types";

const BLACK: Color = { r: 0, g: 0, b: 0, a: 255 };
const RED: Color = { r: 255, g: 0, b: 0, a: 255 };

function getCtx(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");
  return ctx;
}

describe("generateBrushTip", () => {
  describe("circle tip", () => {
    it("hard circle (hardness=1.0) は指定サイズの OffscreenCanvas を返す", () => {
      const tip = generateBrushTip(
        { type: "circle", hardness: 1.0 },
        32,
        BLACK,
      );
      expect(tip).toBeInstanceOf(OffscreenCanvas);
      expect(tip.width).toBe(32);
      expect(tip.height).toBe(32);
    });

    it("hard circle は中心にピクセルが描画されている", () => {
      const tip = generateBrushTip(
        { type: "circle", hardness: 1.0 },
        32,
        BLACK,
      );
      const ctx = getCtx(tip);
      const pixel = ctx.getImageData(16, 16, 1, 1).data;
      expect(pixel[3]).toBeGreaterThan(0);
    });

    it("soft circle (hardness=0.0) は中心が不透明で端が透明", () => {
      const tip = generateBrushTip(
        { type: "circle", hardness: 0.0 },
        64,
        BLACK,
      );
      const ctx = getCtx(tip);

      const center = ctx.getImageData(32, 32, 1, 1).data;
      expect(center[3]).toBeGreaterThan(200);

      // 端（角近く）は透明
      const corner = ctx.getImageData(0, 0, 1, 1).data;
      expect(corner[3]).toBe(0);
    });

    it("中間 hardness (0.5) は gradient stop が設定される", () => {
      const tip = generateBrushTip({ type: "circle", hardness: 0.5 }, 32, RED);
      const ctx = getCtx(tip);
      // 中心は不透明
      const center = ctx.getImageData(16, 16, 1, 1).data;
      expect(center[0]).toBe(255); // red channel
      expect(center[3]).toBeGreaterThan(200);
    });

    it("色が正しく焼き込まれる", () => {
      const tip = generateBrushTip({ type: "circle", hardness: 1.0 }, 32, RED);
      const ctx = getCtx(tip);
      const pixel = ctx.getImageData(16, 16, 1, 1).data;
      expect(pixel[0]).toBe(255); // R
      expect(pixel[1]).toBe(0); // G
      expect(pixel[2]).toBe(0); // B
    });
  });

  describe("image tip", () => {
    it("registry が未指定の場合は例外を投げる", () => {
      expect(() =>
        generateBrushTip({ type: "image", imageId: "test" }, 32, BLACK),
      ).toThrow("BrushTipRegistry required");
    });

    it("imageId が見つからない場合は例外を投げる", () => {
      const registry = createBrushTipRegistry();
      expect(() =>
        generateBrushTip(
          { type: "image", imageId: "nonexistent" },
          32,
          BLACK,
          registry,
        ),
      ).toThrow("Image tip not found: nonexistent");
    });
  });
});

describe("createBrushTipRegistry", () => {
  it("set/get で画像を保存・取得できる", async () => {
    const registry = createBrushTipRegistry();

    // ImageBitmap を作成（1x1 白ピクセル）
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = getCtx(canvas);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1, 1);
    const bitmap = await createImageBitmap(canvas);

    registry.set("test-image", bitmap);
    expect(registry.get("test-image")).toBe(bitmap);
  });

  it("未登録の imageId は undefined を返す", () => {
    const registry = createBrushTipRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });
});
