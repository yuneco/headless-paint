import {
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_PRESSURE_CURVE,
  ROUND_PEN,
  createLayer,
} from "@headless-paint/engine";
import type { ExpandConfig, Layer, StrokeStyle } from "@headless-paint/engine";
import type { FilterPipelineConfig, InputPoint } from "@headless-paint/input";
import { describe, expect, it } from "vitest";
import { createStrokeRuntime } from "./stroke-runtime";
import type { StrokeRuntime, StrokeRuntimeDeps } from "./stroke-runtime";
import type { StrokeCommand } from "./types";

class ManualClock {
  nowMs = 0;
  private nextId = 1;
  private readonly timers = new Map<
    number,
    { readonly due: number; readonly fn: () => void }
  >();

  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { due: this.nowMs + ms, fn });
    return id;
  };

  clearTimeout = (id: unknown): void => {
    if (typeof id === "number") {
      this.timers.delete(id);
    }
  };

  now = (): number => this.nowMs;

  advance(ms: number): void {
    const target = this.nowMs + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort(([, a], [, b]) => a.due - b.due)[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.nowMs = timer.due;
      timer.fn();
    }
    this.nowMs = target;
  }
}

const expand: ExpandConfig = {
  levels: [
    {
      mode: "none",
      offset: { x: 0, y: 0 },
      angle: 0,
      divisions: 1,
    },
  ],
};

const filterPipeline: FilterPipelineConfig = { filters: [] };

function point(x: number, y: number, timestamp: number): InputPoint {
  return { x, y, pressure: 0.5, timestamp };
}

function roundStyle(): StrokeStyle {
  return {
    color: { r: 0, g: 0, b: 0, a: 255 },
    lineWidth: 4,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush: ROUND_PEN,
  };
}

function stampStyle(emissionsPerSecond = 10): StrokeStyle {
  return {
    color: { r: 0, g: 0, b: 0, a: 255 },
    lineWidth: 8,
    pressureCurve: DEFAULT_PRESSURE_CURVE,
    compositeOperation: "source-over",
    brush: {
      type: "stamp",
      tip: { type: "circle", hardness: 1 },
      dynamics: {
        ...DEFAULT_BRUSH_DYNAMICS,
        spacing: 0.25,
        flow: 0.5,
        emissionsPerSecond,
      },
      pressureDynamics: { size: 0, flow: 0 },
    },
  };
}

function makeRuntime(options?: {
  readonly clock?: ManualClock;
  readonly onCommit?: (command: StrokeCommand) => void;
  readonly onDrawingChanged?: (isDrawing: boolean) => void;
  readonly randomSeed?: () => number;
}): {
  readonly runtime: StrokeRuntime;
  readonly layer: Layer;
  readonly pendingLayer: Layer;
  readonly clock: ManualClock;
  readonly commits: StrokeCommand[];
  readonly renderRequests: { count: number };
  readonly drawingChanges: boolean[];
} {
  const clock = options?.clock ?? new ManualClock();
  const commits: StrokeCommand[] = [];
  const renderRequests = { count: 0 };
  const drawingChanges: boolean[] = [];
  const deps: StrokeRuntimeDeps = {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    requestRender: () => {
      renderRequests.count += 1;
    },
    onCommit: (command) => {
      commits.push(command);
      options?.onCommit?.(command);
    },
    onDrawingChanged: (isDrawing) => {
      drawingChanges.push(isDrawing);
      options?.onDrawingChanged?.(isDrawing);
    },
    randomSeed: options?.randomSeed ?? (() => 0x1234),
  };
  return {
    runtime: createStrokeRuntime(deps),
    layer: createLayer(64, 64),
    pendingLayer: createLayer(64, 64),
    clock,
    commits,
    renderRequests,
    drawingChanges,
  };
}

function startConfig(
  layer: Layer,
  pendingLayer: Layer,
  style: StrokeStyle,
  options?: {
    readonly brushSeed?: number;
    readonly alphaLocked?: boolean;
    readonly pendingOnly?: boolean;
  },
) {
  return {
    layer,
    pendingLayer,
    style,
    filterPipeline,
    expand,
    alphaLocked: options?.alphaLocked ?? false,
    brushSeed: options?.brushSeed,
    pendingOnly: options?.pendingOnly,
  };
}

describe("stroke-runtime", () => {
  describe("emission", () => {
    it("does not fire while input arrives faster than the interval", () => {
      const { runtime, layer, pendingLayer, clock, commits } = makeRuntime();
      runtime.start(
        point(10, 10, 0),
        startConfig(layer, pendingLayer, stampStyle(10)),
      );

      clock.advance(50);
      runtime.move(point(11, 10, 50));
      clock.advance(99);
      runtime.end();

      expect(commits).toHaveLength(1);
      expect(commits[0].inputPoints.map((p) => p.timestamp)).toEqual([0, 50]);
    });

    it("keeps firing while the pointer is stationary and records synthetic points", () => {
      const { runtime, layer, pendingLayer, clock, commits } = makeRuntime();
      runtime.start(
        point(10, 10, 0),
        startConfig(layer, pendingLayer, stampStyle(10)),
      );

      clock.advance(100);
      clock.advance(100);
      runtime.end();

      expect(commits).toHaveLength(1);
      expect(commits[0].inputPoints).toEqual([
        point(10, 10, 0),
        point(10, 10, 100),
        point(10, 10, 200),
      ]);
    });

    it("does not fire after end, cancel, or dispose", () => {
      const ended = makeRuntime();
      ended.runtime.start(
        point(10, 10, 0),
        startConfig(ended.layer, ended.pendingLayer, stampStyle(10)),
      );
      ended.runtime.end();
      ended.clock.advance(100);
      expect(ended.commits[0].inputPoints).toHaveLength(1);

      const canceled = makeRuntime();
      canceled.runtime.start(
        point(10, 10, 0),
        startConfig(canceled.layer, canceled.pendingLayer, stampStyle(10)),
      );
      canceled.runtime.cancel();
      canceled.clock.advance(100);
      expect(canceled.commits).toHaveLength(0);

      const disposed = makeRuntime();
      disposed.runtime.start(
        point(10, 10, 0),
        startConfig(disposed.layer, disposed.pendingLayer, stampStyle(10)),
      );
      disposed.runtime.dispose();
      disposed.clock.advance(100);
      expect(disposed.commits).toHaveLength(0);
    });
  });

  describe("lifecycle", () => {
    it("does not fire timers after dispose", () => {
      const { runtime, layer, pendingLayer, clock, commits } = makeRuntime();
      runtime.start(
        point(10, 10, 0),
        startConfig(layer, pendingLayer, stampStyle(10)),
      );
      runtime.dispose();
      runtime.dispose();

      clock.advance(500);

      expect(commits).toHaveLength(0);
      expect(runtime.isDrawing).toBe(false);
    });

    it("keeps two runtime instances isolated", () => {
      const clock = new ManualClock();
      const first = makeRuntime({ clock });
      const second = makeRuntime({ clock });

      first.runtime.start(
        point(10, 10, 0),
        startConfig(first.layer, first.pendingLayer, stampStyle(10)),
      );
      second.runtime.start(
        point(20, 20, 0),
        startConfig(second.layer, second.pendingLayer, stampStyle(10)),
      );

      clock.advance(50);
      first.runtime.move(point(11, 10, 50));
      clock.advance(50);
      clock.advance(50);
      first.runtime.end();
      second.runtime.end();

      expect(first.commits[0].inputPoints.map((p) => p.timestamp)).toEqual([
        0, 50, 150,
      ]);
      expect(second.commits[0].inputPoints.map((p) => p.timestamp)).toEqual([
        0, 100,
      ]);
      expect(first.commits[0].inputPoints[0].x).toBe(10);
      expect(second.commits[0].inputPoints[0].x).toBe(20);
    });

    it("restores the previous snapshot when start is called while active", () => {
      const { runtime, layer, pendingLayer } = makeRuntime();
      runtime.start(
        point(10, 10, 0),
        startConfig(layer, pendingLayer, roundStyle()),
      );
      expect(layer.ctx.getImageData(10, 10, 1, 1).data[3]).toBeGreaterThan(0);

      runtime.start(
        point(40, 40, 1),
        startConfig(layer, pendingLayer, roundStyle()),
      );

      expect(layer.ctx.getImageData(10, 10, 1, 1).data[3]).toBe(0);
      expect(layer.ctx.getImageData(40, 40, 1, 1).data[3]).toBeGreaterThan(0);
    });
  });

  describe("commit", () => {
    it("passes inputPoints, brushSeed, and alphaLocked to onCommit", () => {
      const { runtime, layer, pendingLayer, commits } = makeRuntime({
        randomSeed: () => 0xabcd,
      });

      runtime.start(
        point(10, 10, 0),
        startConfig(layer, pendingLayer, stampStyle(20), {
          brushSeed: 123,
          alphaLocked: true,
        }),
      );
      runtime.move(point(20, 20, 10));
      runtime.end();

      expect(commits).toHaveLength(1);
      expect(commits[0].inputPoints).toEqual([
        point(10, 10, 0),
        point(20, 20, 10),
      ]);
      expect(commits[0].brushSeed).toBe(123);
      expect(commits[0].alphaLocked).toBe(true);
    });
  });
});
