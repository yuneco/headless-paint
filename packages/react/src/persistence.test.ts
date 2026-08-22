import {
  DEFAULT_RADIAL_DISTRIBUTION,
  ROUGH_BRISTLE,
  createLayer,
  createViewTransform,
} from "@headless-paint/core";
import type { ViewTransform } from "@headless-paint/core";
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
        pressureCurve: { y1: 0.2, y2: 0.6 },
        eraser: false,
        brush: {
          type: "round-pen",
          pressureDynamics: { size: 0.8, flow: 0 },
        },
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

  it("exports and imports stamp brush mixing settings", () => {
    const snapshot = exportPaintSettings({
      tool: "pen",
      transform: createViewTransform() as ViewTransform,
      background: {
        color: { r: 255, g: 255, b: 255, a: 255 },
        visible: true,
      },
      pen: {
        color: { r: 10, g: 20, b: 30, a: 255 },
        lineWidth: 8,
        pressureCurve: { y1: 0.2, y2: 0.6 },
        eraser: false,
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 0.8 },
          dynamics: {
            spacing: 0.12,
            spacingSizeCoupling: 1,
            flow: 0.7,
            opacityJitter: 0,
            sizeJitter: 0,
            rotationJitter: 0,
            scatter: 0,
          },
          pressureDynamics: { size: 0.4, flow: 0.7 },
          mixing: {
            enabled: true,
            pickupRatePerPx: 0.007,
            restoreRatePerPx: 0.004,
            diffusionRatePerPx: 0.05,
            updateDistancePx: 15,
            checkpointDistancePx: 36,
            fieldColumns: 18,
            fieldRows: 8,
          },
        },
      },
      smoothing: {
        enabled: true,
        windowSize: 5,
      },
      expand: {
        levels: [
          { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
        ],
      },
    });

    const imported = importPaintSettings(snapshot);
    expect(imported?.pen.brush).toMatchObject({
      type: "stamp",
      dynamics: { spacingSizeCoupling: 1 },
      mixing: {
        enabled: true,
        pickupRatePerPx: 0.007,
        restoreRatePerPx: 0.004,
        diffusionRatePerPx: 0.05,
        updateDistancePx: 15,
        checkpointDistancePx: 36,
        fieldColumns: 18,
        fieldRows: 8,
      },
    });

    const invalidField = JSON.parse(JSON.stringify(snapshot)) as {
      pen: { brush: { mixing: { fieldColumns: number } } };
    };
    invalidField.pen.brush.mixing.fieldColumns = 1;
    expect(importPaintSettings(invalidField)).toBeNull();

    const invalidRate = JSON.parse(JSON.stringify(snapshot)) as {
      pen: { brush: { mixing: { pickupRatePerPx: number } } };
    };
    invalidRate.pen.brush.mixing.pickupRatePerPx = -0.1;
    expect(importPaintSettings(invalidRate)).toBeNull();

    const invalidCheckpoint = JSON.parse(JSON.stringify(snapshot)) as {
      pen: { brush: { mixing: { checkpointDistancePx: number } } };
    };
    invalidCheckpoint.pen.brush.mixing.checkpointDistancePx = 257;
    expect(importPaintSettings(invalidCheckpoint)).toBeNull();
  });

  it("旧stamp設定でspacingSizeCouplingが欠落した場合は0で補完する", () => {
    const snapshot = exportPaintSettings({
      tool: "pen",
      transform: createViewTransform() as ViewTransform,
      background: {
        color: { r: 255, g: 255, b: 255, a: 255 },
        visible: true,
      },
      pen: {
        color: { r: 10, g: 20, b: 30, a: 255 },
        lineWidth: 8,
        pressureCurve: { y1: 0.2, y2: 0.6 },
        eraser: false,
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 1 },
          dynamics: {
            spacing: 0.2,
            flow: 1,
            opacityJitter: 0,
            sizeJitter: 0,
            rotationJitter: 0,
            scatter: 0,
          } as never,
          pressureDynamics: { size: 1, flow: 0 },
        },
      },
      smoothing: { enabled: false, windowSize: 1 },
      expand: {
        levels: [
          { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
        ],
      },
    });

    const imported = importPaintSettings(snapshot);
    expect(imported?.pen.brush).toMatchObject({
      type: "stamp",
      dynamics: { spacingSizeCoupling: 0 },
    });
  });

  it("exports and imports the complete bristle brush contract", () => {
    const snapshot = exportPaintSettings({
      tool: "pen",
      transform: createViewTransform() as ViewTransform,
      background: {
        color: { r: 255, g: 255, b: 255, a: 255 },
        visible: true,
      },
      pen: {
        color: { r: 20, g: 50, b: 80, a: 255 },
        lineWidth: 64,
        pressureCurve: { y1: 0.15, y2: 0.8 },
        eraser: false,
        brush: ROUGH_BRISTLE,
      },
      smoothing: { enabled: false, windowSize: 1 },
      expand: {
        levels: [
          { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
        ],
      },
    });

    expect(importPaintSettings(snapshot)?.pen.brush).toEqual(ROUGH_BRISTLE);

    const missingGeometryStep = JSON.parse(JSON.stringify(snapshot)) as {
      pen: { brush: { dynamics: { geometryStepPx?: number } } };
    };
    missingGeometryStep.pen.brush.dynamics.geometryStepPx = undefined;
    expect(importPaintSettings(missingGeometryStep)).toBeNull();

    const invalidGrain = JSON.parse(JSON.stringify(snapshot)) as {
      pen: { brush: { dynamics: { surfaceGrain: { scalePx: number } } } };
    };
    invalidGrain.pen.brush.dynamics.surfaceGrain.scalePx = 0;
    expect(importPaintSettings(invalidGrain)).toBeNull();
  });

  it("旧mixing propertyだけのstamp設定は専用変換せずrejectする", () => {
    const legacyRatioOnly = {
      version: 1,
      tool: "pen",
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      background: {
        color: { r: 255, g: 255, b: 255, a: 255 },
        visible: true,
      },
      pen: {
        color: { r: 10, g: 20, b: 30, a: 255 },
        lineWidth: 8,
        pressureCurve: { y1: 0.2, y2: 0.6 },
        eraser: false,
        brush: {
          type: "stamp",
          tip: { type: "circle", hardness: 0.8 },
          dynamics: {
            spacing: 0.12,
            flow: 0.7,
            opacityJitter: 0,
            sizeJitter: 0,
            rotationJitter: 0,
            scatter: 0,
          },
          pressureDynamics: { size: 0.4, flow: 0.7 },
          mixing: {
            enabled: true,
            pickup: 0.3,
            restore: 0.08,
            updateDistanceRatio: 0.5,
          },
        },
      },
      smoothing: {
        enabled: true,
        windowSize: 5,
      },
      expand: {
        levels: [
          { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
        ],
      },
    };

    expect(importPaintSettings(legacyRatioOnly)).toBeNull();
  });

  it("imports legacy pressure settings by filling brush pressure dynamics", () => {
    const legacy = {
      version: 1,
      tool: "pen",
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      background: {
        color: { r: 255, g: 255, b: 255, a: 255 },
        visible: true,
      },
      pen: {
        color: { r: 10, g: 20, b: 30, a: 255 },
        lineWidth: 8,
        pressureSensitivity: 0.35,
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
          { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
        ],
      },
    };

    const imported = importPaintSettings(legacy);
    expect(imported?.pen.brush).toEqual({
      type: "round-pen",
      pressureDynamics: { size: 0.35, flow: 0 },
    });
  });

  it("imports spray density profile and size jitter mode", () => {
    const snapshot = {
      version: 1,
      tool: "pen",
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      background: {
        color: { r: 255, g: 255, b: 255, a: 255 },
        visible: true,
      },
      pen: {
        color: { r: 10, g: 20, b: 30, a: 255 },
        lineWidth: 8,
        pressureCurve: { y1: 0.2, y2: 0.6 },
        eraser: false,
        brush: {
          type: "spray",
          particle: { type: "circle", hardness: 1 },
          dynamics: {
            spacing: 0.1,
            density: 5,
            particleSize: 2,
            particleSizeJitter: 0.5,
            sizeJitterMode: "lognormal",
            opacityJitter: 0.2,
            flow: 0.35,
            radialDistribution: {
              startY: 0.8,
              control1: { x: 0.2, y: 1 },
              control2: { x: 0.8, y: 0.1 },
              endY: 0,
            },
          },
          pressureDynamics: { size: 0.2, flow: 1, density: 0.5 },
        },
      },
      smoothing: {
        enabled: true,
        windowSize: 5,
      },
      expand: {
        levels: [
          { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
        ],
      },
    };

    const imported = importPaintSettings(snapshot);
    expect(imported?.pen.brush).toMatchObject({
      type: "spray",
      dynamics: {
        sizeJitterMode: "lognormal",
        radialDistribution: {
          startY: 0.8,
          control1: { x: 0.2, y: 1 },
          control2: { x: 0.8, y: 0.1 },
          endY: 0,
        },
      },
    });
  });

  it("falls back invalid spray radialDistribution", () => {
    const snapshot = {
      version: 1,
      tool: "pen",
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      background: {
        color: { r: 255, g: 255, b: 255, a: 255 },
        visible: true,
      },
      pen: {
        color: { r: 10, g: 20, b: 30, a: 255 },
        lineWidth: 8,
        pressureCurve: { y1: 0.2, y2: 0.6 },
        eraser: false,
        brush: {
          type: "spray",
          particle: { type: "circle", hardness: 1 },
          dynamics: {
            spacing: 0.1,
            density: 5,
            particleSize: 2,
            particleSizeJitter: 0.5,
            sizeJitterMode: "bimodal",
            opacityJitter: 0.2,
            flow: 0.35,
            radialDistribution: { y1: 0, y2: 0.12 },
          },
          pressureDynamics: { size: 0.2, flow: 1, density: 0.5 },
        },
      },
      smoothing: {
        enabled: true,
        windowSize: 5,
      },
      expand: {
        levels: [
          { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
        ],
      },
    };

    const imported = importPaintSettings(snapshot);
    expect(imported?.pen.brush).toMatchObject({
      type: "spray",
      dynamics: {
        sizeJitterMode: "bimodal",
        radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
      },
    });
  });

  it("rejects unknown spray sizeJitterMode", () => {
    const snapshot = {
      version: 1,
      tool: "pen",
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      background: {
        color: { r: 255, g: 255, b: 255, a: 255 },
        visible: true,
      },
      pen: {
        color: { r: 10, g: 20, b: 30, a: 255 },
        lineWidth: 8,
        pressureCurve: { y1: 0.2, y2: 0.6 },
        eraser: false,
        brush: {
          type: "spray",
          particle: { type: "circle", hardness: 1 },
          dynamics: {
            spacing: 0.1,
            density: 5,
            particleSize: 2,
            particleSizeJitter: 0.5,
            sizeJitterMode: "unknown",
            opacityJitter: 0.2,
            flow: 0.35,
            radialDistribution: DEFAULT_RADIAL_DISTRIBUTION,
          },
          pressureDynamics: { size: 0.2, flow: 1, density: 0.5 },
        },
      },
      smoothing: {
        enabled: true,
        windowSize: 5,
      },
      expand: {
        levels: [
          { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
        ],
      },
    };

    expect(importPaintSettings(snapshot)).toBeNull();
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
    const layer = createLayer(8, 8, {
      name: "Layer 1",
      visible: true,
      alphaLocked: true,
    });
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
    expect(imported?.layers[0]?.meta.alphaLocked).toBe(true);

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
