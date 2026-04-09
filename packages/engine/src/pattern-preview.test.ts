import { describe, expect, it } from "vitest";
import { createLayer } from "./layer";
import { createPatternTile } from "./pattern-preview";
import type { PatternPreviewConfig } from "./pattern-preview";
import type { BackgroundSettings } from "./types";

const GRID_CONFIG: PatternPreviewConfig = {
  mode: "grid",
  opacity: 0.3,
  offsetX: 0,
  offsetY: 0,
};

function getPixelFromCanvas(
  canvas: OffscreenCanvas,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");
  const data = ctx.getImageData(x, y, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

describe("createPatternTile", () => {
  it("should return null when mode is none", () => {
    const layer = createLayer(10, 10);
    const result = createPatternTile([layer], { ...GRID_CONFIG, mode: "none" });
    expect(result).toBeNull();
  });

  it("should return null when no visible layers", () => {
    const layer = createLayer(10, 10, { visible: false });
    const result = createPatternTile([layer], GRID_CONFIG);
    expect(result).toBeNull();
  });

  it("should include background color when background is provided", () => {
    const layer = createLayer(10, 10);
    const bg: BackgroundSettings = {
      color: { r: 200, g: 100, b: 50, a: 255 },
      visible: true,
    };

    const tile = createPatternTile([layer], GRID_CONFIG, bg);
    expect(tile).not.toBeNull();
    if (!tile) return;

    // 空レイヤーの場合、タイルは背景色のみ
    const pixel = getPixelFromCanvas(tile, 5, 5);
    expect(pixel.r).toBe(200);
    expect(pixel.g).toBe(100);
    expect(pixel.b).toBe(50);
    expect(pixel.a).toBe(255);
  });

  it("should not include background when background.visible is false", () => {
    const layer = createLayer(10, 10);
    const bg: BackgroundSettings = {
      color: { r: 200, g: 100, b: 50, a: 255 },
      visible: false,
    };

    const tile = createPatternTile([layer], GRID_CONFIG, bg);
    expect(tile).not.toBeNull();
    if (!tile) return;

    // 背景なし + 空レイヤー → 透明
    const pixel = getPixelFromCanvas(tile, 5, 5);
    expect(pixel.a).toBe(0);
  });

  it("should apply compositeOperation when compositing layers", () => {
    // 白背景 + multiply赤レイヤー → 赤（白に赤を乗算 = 赤）
    const layer = createLayer(4, 4, { compositeOperation: "multiply" });
    layer.ctx.fillStyle = "rgba(255, 0, 0, 1)";
    layer.ctx.fillRect(0, 0, 4, 4);

    const bg: BackgroundSettings = {
      color: { r: 255, g: 255, b: 255, a: 255 },
      visible: true,
    };

    const tile = createPatternTile([layer], GRID_CONFIG, bg);
    expect(tile).not.toBeNull();
    if (!tile) return;

    const pixel = getPixelFromCanvas(tile, 2, 2);
    // multiply(white, red) = red
    expect(pixel.r).toBe(255);
    expect(pixel.g).toBe(0);
    expect(pixel.b).toBe(0);
    expect(pixel.a).toBe(255);
  });

  it("should produce different results with vs without background for blend modes", () => {
    // screen は白背景の有無で結果差が出やすく、browser 実装差の影響も受けにくい
    const layer = createLayer(4, 4, { compositeOperation: "screen" });
    layer.ctx.fillStyle = "rgba(128, 128, 128, 1)";
    layer.ctx.fillRect(0, 0, 4, 4);

    const bg: BackgroundSettings = {
      color: { r: 255, g: 255, b: 255, a: 255 },
      visible: true,
    };

    const withBg = createPatternTile([layer], GRID_CONFIG, bg);
    const withoutBg = createPatternTile([layer], GRID_CONFIG);

    expect(withBg).not.toBeNull();
    expect(withoutBg).not.toBeNull();
    if (!withBg || !withoutBg) return;

    const pixelWithBg = getPixelFromCanvas(withBg, 2, 2);
    const pixelWithoutBg = getPixelFromCanvas(withoutBg, 2, 2);

    // 背景あり: screen(white, gray) = white → 不透明
    expect(pixelWithBg.a).toBe(255);
    // 背景なし: transparent に対する screen は白背景時と異なる結果になる
    expect(
      pixelWithBg.r !== pixelWithoutBg.r ||
        pixelWithBg.g !== pixelWithoutBg.g ||
        pixelWithBg.a !== pixelWithoutBg.a,
    ).toBe(true);
  });

  it("should apply layer opacity in tile", () => {
    const layer = createLayer(4, 4, { opacity: 0.5 });
    layer.ctx.fillStyle = "rgba(255, 0, 0, 1)";
    layer.ctx.fillRect(0, 0, 4, 4);

    const bg: BackgroundSettings = {
      color: { r: 255, g: 255, b: 255, a: 255 },
      visible: true,
    };

    const tile = createPatternTile([layer], GRID_CONFIG, bg);
    expect(tile).not.toBeNull();
    if (!tile) return;

    const pixel = getPixelFromCanvas(tile, 2, 2);
    // 白背景に50%不透明の赤 → ピンク系 (r≈255, g≈128, b≈128)
    expect(pixel.r).toBeGreaterThan(200);
    expect(pixel.g).toBeGreaterThan(100);
    expect(pixel.g).toBeLessThan(160);
    expect(pixel.a).toBe(255);
  });
});
