import { afterEach, describe, expect, it } from "vitest";
import { renderBrushStroke } from ".";
import { createLayer } from "../layer";
import type { BrushRenderState, StrokePoint, StrokeStyle } from "../types";
import {
  DEFAULT_BRISTLE_DYNAMICS,
  DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
  DEFAULT_PRESSURE_CURVE,
} from "../types";
import { brushPerfDebug } from "./perf-debug";

const WIDTH = 400;
const HEIGHT = 320;

afterEach(() => {
  brushPerfDebug.enabled = false;
  brushPerfDebug.experiments.fusedInk = false;
  brushPerfDebug.reset();
});

describe("bristle fused ink", () => {
  for (const fixture of [
    { name: "S字", points: sCurve() },
    { name: "反復交差", points: repeatedCrossing() },
  ]) {
    it(`${fixture.name} fixtureがTier B parity閾値内に収まる`, () => {
      const legacy = renderFixture(fixture.points, false);
      const fused = renderFixture(fixture.points, true);
      const metrics = compareAlpha(legacy, fused);
      const details = JSON.stringify(metrics);

      expect(metrics.coverageRelativeDifference, details).toBeLessThanOrEqual(
        0.01,
      );
      expect(metrics.alphaMae, details).toBeLessThanOrEqual(0.015);
      expect(metrics.largeDifferenceRate, details).toBeLessThanOrEqual(0.01);
      expect(metrics.bboxEdgeDifference, details).toBeLessThanOrEqual(1);
    });
  }

  it("fused経路でもmaskRasterとlayerDrawを記録する", () => {
    brushPerfDebug.enabled = true;
    renderFixture(sCurve(), true);
    const snapshot = brushPerfDebug.snapshot();

    expect(snapshot.stages.maskRaster.count).toBeGreaterThan(0);
    expect(snapshot.stages.layerDraw.count).toBeGreaterThan(0);
    expect(snapshot.stages.drawSweep.count).toBe(0);
  });
});

function renderFixture(
  points: readonly StrokePoint[],
  fusedInk: boolean,
): Uint8ClampedArray<ArrayBuffer> {
  brushPerfDebug.experiments.fusedInk = fusedInk;
  const layer = createLayer(WIDTH, HEIGHT);
  renderBrushStroke(layer, points, style(), 0, initialState());
  return layer.ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
}

function style(): StrokeStyle {
  return {
    color: { r: 37, g: 83, b: 104, a: 255 },
    lineWidth: 60,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush: {
      type: "bristle",
      dynamics: DEFAULT_BRISTLE_DYNAMICS,
      pressureDynamics: DEFAULT_BRISTLE_PRESSURE_DYNAMICS,
    },
  };
}

function initialState(): BrushRenderState {
  return {
    tipCanvas: null,
    seed: 31,
    branches: [{ accumulatedDistance: 0, emissionCount: 0 }],
  };
}

function sCurve(): readonly StrokePoint[] {
  return Array.from({ length: 49 }, (_, index) => {
    const t = index / 48;
    return {
      x: 45 + t * 310,
      y: 160 + Math.sin((t - 0.5) * Math.PI * 2) * 92,
      pressure: 0.28 + 0.68 * Math.sin(t * Math.PI) ** 2,
    };
  });
}

function repeatedCrossing(): readonly StrokePoint[] {
  return Array.from({ length: 97 }, (_, index) => {
    const t = (index / 96) * Math.PI * 4;
    return {
      x: 200 + Math.sin(t) * 128,
      y: 160 + Math.sin(t * 2) * 78,
      pressure: 0.42 + 0.5 * Math.sin(t * 0.5) ** 2,
    };
  });
}

interface AlphaMetrics {
  readonly coverageRelativeDifference: number;
  readonly alphaMae: number;
  readonly largeDifferenceRate: number;
  readonly bboxEdgeDifference: number;
}

function compareAlpha(
  legacy: Uint8ClampedArray<ArrayBuffer>,
  fused: Uint8ClampedArray<ArrayBuffer>,
): AlphaMetrics {
  let legacyCoverage = 0;
  let fusedCoverage = 0;
  let unionCoverage = 0;
  let absoluteError = 0;
  let largeDifferences = 0;
  const legacyBounds = emptyBounds();
  const fusedBounds = emptyBounds();

  for (let offset = 3; offset < legacy.length; offset += 4) {
    const legacyAlpha = legacy[offset] ?? 0;
    const fusedAlpha = fused[offset] ?? 0;
    const pixelIndex = (offset - 3) / 4;
    const x = pixelIndex % WIDTH;
    const y = Math.floor(pixelIndex / WIDTH);
    if (legacyAlpha > 0) {
      legacyCoverage += legacyAlpha;
      include(legacyBounds, x, y);
    }
    if (fusedAlpha > 0) {
      fusedCoverage += fusedAlpha;
      include(fusedBounds, x, y);
    }
    if (legacyAlpha === 0 && fusedAlpha === 0) continue;
    unionCoverage++;
    const difference = Math.abs(legacyAlpha - fusedAlpha);
    absoluteError += difference;
    if (difference > 25.5) largeDifferences++;
  }

  return {
    coverageRelativeDifference:
      Math.abs(legacyCoverage - fusedCoverage) / Math.max(1, legacyCoverage),
    alphaMae: absoluteError / Math.max(1, unionCoverage) / 255,
    largeDifferenceRate: largeDifferences / Math.max(1, unionCoverage),
    bboxEdgeDifference: Math.max(
      Math.abs(legacyBounds.minX - fusedBounds.minX),
      Math.abs(legacyBounds.minY - fusedBounds.minY),
      Math.abs(legacyBounds.maxX - fusedBounds.maxX),
      Math.abs(legacyBounds.maxY - fusedBounds.maxY),
    ),
  };
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function emptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function include(bounds: Bounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}
