import { createLayer } from "@headless-paint/engine";
import type { ViewTransform } from "@headless-paint/input";
import { createViewTransform } from "@headless-paint/input";
import { describe, expect, it } from "vitest";
import {
  exportPaintDocument,
  exportPaintSettings,
  importPaintDocument,
  importPaintSettings,
} from "./persistence";

describe("persistence", () => {
  it("exports and imports settings snapshot", () => {
    const transform = createViewTransform();
    transform[0] = 2;
    transform[4] = 2;
    transform[6] = 123;
    transform[7] = 45;

    const snapshot = exportPaintSettings({
      tool: "pen",
      transform: transform as ViewTransform,
      background: {
        color: { r: 255, g: 255, b: 255, a: 255 },
        visible: true,
      },
      pen: {
        color: { r: 10, g: 20, b: 30, a: 255 },
        lineWidth: 8,
        pressureSensitivity: 0.8,
        pressureCurve: { y1: 0.2, y2: 0.6 },
        eraser: false,
        brush: { type: "round-pen" },
      },
      smoothing: {
        enabled: true,
        windowSize: 5,
      },
      expand: {
        levels: [
          {
            mode: "radial",
            offset: { x: 100, y: 120 },
            angle: 0.1,
            divisions: 6,
          },
        ],
      },
    });

    const imported = importPaintSettings(snapshot);
    expect(imported).not.toBeNull();
    expect(imported?.tool).toBe("pen");
    expect(imported?.transform[6]).toBe(123);
    expect(imported?.pen.brush.type).toBe("round-pen");
    expect(imported?.expand.levels[0].mode).toBe("radial");
  });

  it("returns null for invalid settings version", () => {
    const invalid = {
      version: 999,
      tool: "pen",
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    };
    expect(importPaintSettings(invalid)).toBeNull();
  });

  it("exports and imports document snapshot", async () => {
    const layer = createLayer(8, 8, { name: "Layer 1", visible: true });
    layer.ctx.fillStyle = "rgba(255,0,0,1)";
    layer.ctx.fillRect(2, 2, 2, 2);

    const snapshot = await exportPaintDocument({
      layerWidth: 8,
      layerHeight: 8,
      activeLayerId: layer.id,
      entries: [{ id: layer.id, committedLayer: layer }],
    });
    expect(snapshot.layers).toHaveLength(1);
    expect(snapshot.layers[0].pngBytes.byteLength).toBeGreaterThan(0);

    const imported = await importPaintDocument(snapshot);
    expect(imported).not.toBeNull();
    expect(imported?.layers).toHaveLength(1);

    const imageData = imported?.layers[0]?.imageData;
    expect(imageData).toBeDefined();
    if (!imageData) {
      return;
    }
    const idx = (2 + 2 * imageData.width) * 4;
    expect(imageData.data[idx]).toBe(255);
    expect(imageData.data[idx + 3]).toBe(255);
  });
});
