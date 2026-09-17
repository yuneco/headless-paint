import {
  DEFAULT_BRUSH_MIXING,
  DEFAULT_PRESSURE_CURVE,
  ROUGH_BRISTLE,
  compileExpand,
  compileFilterPipeline,
  createBrushAccelerator,
  createLayer,
  rebuildLayerFromHistory,
} from "@headless-paint/core";
import type {
  BrushAccelerator,
  ExpandConfig,
  Layer,
  StrokeStyle,
} from "@headless-paint/core";
import { StrictMode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBrushAccelerator } from "./paint-engine/useBrushAccelerator";
import { type PaintEngineResult, usePaintEngine } from "./usePaintEngine";

// Inject a real GPU instance so its internal cache results can be observed.
// Stroke runtime, React callbacks, history push and executor remain unmocked.
vi.mock("./paint-engine/useBrushAccelerator", () => ({
  useBrushAccelerator: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

const expand: ExpandConfig = {
  levels: [{ mode: "none", offset: { x: 64, y: 64 }, angle: 0, divisions: 1 }],
};
const style: StrokeStyle = {
  color: { r: 220, g: 60, b: 20, a: 255 },
  lineWidth: 34,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  compositeOperation: "source-over",
  brush: {
    ...ROUGH_BRISTLE,
    mixing: {
      ...DEFAULT_BRUSH_MIXING,
      enabled: true,
      updateDistancePx: 4,
      checkpointDistancePx: 8,
    },
  },
};

interface GpuUndoRuntime {
  retainUndoSnapshot(layer: Layer, token: object): boolean;
  bindUndoSnapshot(token: object, index: number, branch: object): void;
  restoreUndoSnapshot(layer: Layer, index: number, branch: object): boolean;
}

function createGpu(commitMode: "bitmap" | "direct"): BrushAccelerator {
  const accelerator = createBrushAccelerator({ backend: "webgl2", commitMode });
  if (!accelerator) throw new Error("WebGL2 accelerator is unavailable");
  return accelerator;
}

describe("usePaintEngine GPU undo-1 integration", () => {
  it.each(["bitmap", "direct"] as const)(
    "%s: preserves runtime command identity and hits undo through the React hook",
    async (commitMode) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const accelerator = createGpu(commitMode);
      const reference = createGpu(commitMode);
      const runtime = accelerator as BrushAccelerator & GpuUndoRuntime;
      const retain = vi.spyOn(runtime, "retainUndoSnapshot");
      const bind = vi.spyOn(runtime, "bindUndoSnapshot");
      const restore = vi.spyOn(runtime, "restoreUndoSnapshot");
      vi.mocked(useBrushAccelerator).mockReturnValue({
        accelerator,
        gpuBackend: "webgl2",
        gpuBackendReason: "test",
      });
      let engine: PaintEngineResult | undefined;
      function Harness() {
        engine = usePaintEngine({
          layerWidth: 128,
          layerHeight: 128,
          strokeStyle: style,
          compiledFilterPipeline: compileFilterPipeline({
            filters: [{ type: "causal-adaptive", config: {} }],
          }),
          expandConfig: expand,
          compiledExpand: compileExpand(expand),
          historyConfig: {
            checkpointInterval: 10,
            maxCheckpoints: 10,
            checkpointCompression: "none",
          },
          gpuBackend: "webgl2",
          gpuCommitMode: commitMode,
        });
        return null;
      }
      const current = () => {
        if (!engine) throw new Error("Hook is not mounted");
        return engine;
      };
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () =>
          root.render(createElement(StrictMode, null, createElement(Harness))),
        );
        for (let index = 0; index < 3; index++) {
          await act(async () => {
            current().onStrokeStart(
              {
                x: 20,
                y: 30 + index * 12,
                pressure: 0.8,
                timestamp: 1000 + index * 100,
              },
              { brushSeed: 1234 + index },
            );
            current().onStrokeMoves([
              {
                x: 50,
                y: 45 + index * 12,
                pressure: 1,
                timestamp: 1016 + index * 100,
              },
              {
                x: 90,
                y: 60 + index * 12,
                pressure: 0.6,
                timestamp: 1032 + index * 100,
              },
            ]);
            current().onStrokeEnd();
          });
          const history = current().historyState;
          const command = history.commands[index];
          expect(retain).toHaveLastReturnedWith(true);
          expect(retain.mock.calls.at(-1)?.[1]).toBe(command);
          expect(bind).toHaveBeenLastCalledWith(
            command,
            index,
            history.commands,
          );
        }
        expect(current().canUndo).toBe(true);
        await act(async () => current().undo());
        expect(restore).toHaveBeenCalledTimes(1);
        expect(restore).toHaveLastReturnedWith(true);
        expect(current().historyState.currentIndex).toBe(1);
        const actual = current().activeEntry?.committedLayer;
        if (!actual) throw new Error("Missing active layer");
        const expected = createLayer(128, 128);
        (expected as { id: string }).id = actual.id;
        expect(
          rebuildLayerFromHistory(expected, current().historyState, undefined, {
            accelerator: reference,
          }).ok,
        ).toBe(true);
        const pixels = actual.ctx.getImageData(0, 0, 128, 128).data;
        expect(pixels.some((value) => value !== 0)).toBe(true);
        expect(pixels).toEqual(expected.ctx.getImageData(0, 0, 128, 128).data);
      } finally {
        await act(async () => root.unmount());
        container.remove();
        accelerator.dispose();
        reference.dispose();
        vi.unstubAllGlobals();
      }
    },
  );
});
