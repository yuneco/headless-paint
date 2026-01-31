import { createLayer, setPixel } from "@headless-paint/engine";
import { describe, expect, it } from "vitest";
import { createCheckpoint, restoreFromCheckpoint } from "./checkpoint";

describe("createCheckpoint", () => {
  it("should create a checkpoint with correct properties", () => {
    const layer = createLayer(10, 10);
    setPixel(layer, 5, 5, { r: 255, g: 0, b: 0, a: 255 });

    const checkpoint = createCheckpoint(layer, 5);

    expect(checkpoint.id).toMatch(/^cp_/);
    expect(checkpoint.commandIndex).toBe(5);
    expect(checkpoint.imageData).toBeInstanceOf(ImageData);
    expect(checkpoint.imageData.width).toBe(10);
    expect(checkpoint.imageData.height).toBe(10);
    expect(checkpoint.createdAt).toBeTypeOf("number");
  });

  it("should capture current layer state in imageData", () => {
    const layer = createLayer(2, 2);
    setPixel(layer, 0, 0, { r: 255, g: 128, b: 64, a: 255 });

    const checkpoint = createCheckpoint(layer, 0);

    expect(checkpoint.imageData.data[0]).toBe(255);
    expect(checkpoint.imageData.data[1]).toBe(128);
    expect(checkpoint.imageData.data[2]).toBe(64);
    expect(checkpoint.imageData.data[3]).toBe(255);
  });

  it("should generate unique IDs for each checkpoint", () => {
    const layer = createLayer(10, 10);
    const cp1 = createCheckpoint(layer, 0);
    const cp2 = createCheckpoint(layer, 1);

    expect(cp1.id).not.toBe(cp2.id);
  });
});

describe("restoreFromCheckpoint", () => {
  it("should restore layer to checkpoint state", () => {
    const layer = createLayer(2, 2);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });
    const checkpoint = createCheckpoint(layer, 0);

    // レイヤーを変更
    setPixel(layer, 0, 0, { r: 0, g: 255, b: 0, a: 255 });
    setPixel(layer, 1, 1, { r: 0, g: 0, b: 255, a: 255 });

    // チェックポイントから復元
    restoreFromCheckpoint(layer, checkpoint);

    // 復元後の確認
    const data = layer.ctx.getImageData(0, 0, 2, 2).data;
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    expect(data[3]).toBe(255);

    // 変更したピクセルが消えていることを確認
    expect(data[12]).toBe(0);
    expect(data[13]).toBe(0);
    expect(data[14]).toBe(0);
    expect(data[15]).toBe(0);
  });
});
