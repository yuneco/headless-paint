import { describe, expect, it } from "vitest";
import {
  clearLayer,
  createLayer,
  getImageData,
  getPixel,
  setPixel,
} from "./layer";

describe("createLayer", () => {
  it("should create a layer with correct dimensions", () => {
    const layer = createLayer(100, 50);
    expect(layer.width).toBe(100);
    expect(layer.height).toBe(50);
  });

  it("should have default meta values", () => {
    const layer = createLayer(10, 10);
    expect(layer.meta.name).toBe("Layer");
    expect(layer.meta.visible).toBe(true);
    expect(layer.meta.opacity).toBe(1);
  });

  it("should accept custom meta values", () => {
    const layer = createLayer(10, 10, { name: "Background", opacity: 0.5 });
    expect(layer.meta.name).toBe("Background");
    expect(layer.meta.opacity).toBe(0.5);
    expect(layer.meta.visible).toBe(true);
  });

  it("should have canvas and ctx", () => {
    const layer = createLayer(10, 10);
    expect(layer.canvas).toBeInstanceOf(OffscreenCanvas);
    expect(layer.ctx).toBeDefined();
  });
});

describe("getPixel / setPixel", () => {
  it("should initialize pixels to transparent", () => {
    const layer = createLayer(10, 10);
    const pixel = getPixel(layer, 5, 5);
    expect(pixel).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("should set and get pixel correctly", () => {
    const layer = createLayer(10, 10);
    const color = { r: 255, g: 128, b: 64, a: 255 };
    setPixel(layer, 3, 4, color);
    expect(getPixel(layer, 3, 4)).toEqual(color);
  });

  it("should return transparent black for out-of-bounds getPixel", () => {
    const layer = createLayer(10, 10);
    expect(getPixel(layer, -1, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(getPixel(layer, 0, -1)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(getPixel(layer, 10, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(getPixel(layer, 0, 10)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("should ignore out-of-bounds setPixel", () => {
    const layer = createLayer(10, 10);
    const color = { r: 255, g: 0, b: 0, a: 255 };
    setPixel(layer, -1, 0, color);
    setPixel(layer, 10, 0, color);
    expect(getPixel(layer, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe("getImageData", () => {
  it("should return correct ImageData", () => {
    const layer = createLayer(2, 2);
    setPixel(layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 });
    setPixel(layer, 1, 1, { r: 0, g: 255, b: 0, a: 255 });

    const imageData = getImageData(layer);
    expect(imageData.width).toBe(2);
    expect(imageData.height).toBe(2);
    expect(imageData.data[0]).toBe(255);
    expect(imageData.data[1]).toBe(0);
    expect(imageData.data[2]).toBe(0);
    expect(imageData.data[3]).toBe(255);
    expect(imageData.data[12]).toBe(0);
    expect(imageData.data[13]).toBe(255);
    expect(imageData.data[14]).toBe(0);
    expect(imageData.data[15]).toBe(255);
  });
});

describe("clearLayer", () => {
  it("should clear all pixels", () => {
    const layer = createLayer(10, 10);
    setPixel(layer, 5, 5, { r: 255, g: 255, b: 255, a: 255 });
    clearLayer(layer);
    expect(getPixel(layer, 5, 5)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
