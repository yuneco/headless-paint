import type { Layer } from "@headless-paint/engine";
import {
  ROUND_PEN,
  clearLayer,
  createLayer,
  getImageData,
  getPixel,
  setPixel,
} from "@headless-paint/engine";
import { describe, expect, it } from "vitest";
import { createCheckpoint } from "./checkpoint";
import { executeHistoryOp } from "./command-executor";
import { createHistoryState } from "./history";
import { rebuildLayerFromHistory, replayCommand } from "./replay";
import {
  createClearCommand,
  createDuplicateLayerCommand,
  createMergeLayerDownCommand,
  createStrokeCommand,
  createTransformLayerCommand,
  createWrapShiftCommand,
} from "./session";
import type { Command, HistoryState, LayerDrawCommand } from "./types";

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };
const EMPTY = { r: 0, g: 0, b: 0, a: 0 };

function history(
  layers: readonly Layer[],
  commands: readonly Command[],
): HistoryState {
  return {
    ...createHistoryState(16, 16, { layerCount: layers.length }),
    commands,
    currentIndex: commands.length - 1,
    checkpoints: layers.map((layer) => createCheckpoint(layer, -1)),
  };
}

function drawCommand(type: string, layerId: string): LayerDrawCommand {
  if (type === "clear") return createClearCommand(layerId);
  if (type === "transform") {
    return createTransformLayerCommand(
      layerId,
      new Float32Array([1, 0, 0, 0, 1, 0, 3, 0, 1]),
    );
  }
  return createStrokeCommand(
    layerId,
    [
      { x: 8, y: 8, pressure: 1, timestamp: 0 },
      { x: 12, y: 8, pressure: 1, timestamp: 10 },
    ],
    { filters: [] },
    {
      levels: [
        { mode: "none", offset: { x: 0, y: 0 }, angle: 0, divisions: 1 },
      ],
    },
    {
      color: BLUE,
      lineWidth: 3,
      compositeOperation: "source-over",
      pressureCurve: { y1: 1 / 3, y2: 2 / 3 },
      brush: ROUND_PEN,
    },
  );
}

describe("history replay layer isolation", () => {
  it.each(["clear", "stroke", "transform"])(
    "replays only the target layer's %s command",
    (type) => {
      const a = createLayer(16, 16);
      const b = createLayer(16, 16);
      setPixel(a, 1, 1, RED);
      setPixel(b, 1, 1, RED);
      const commands = [drawCommand(type, b.id)];
      const state = history([a, b], commands);
      const before = getImageData(a).data.slice();
      const expectedB = createLayer(16, 16);
      expectedB.ctx.putImageData(getImageData(b), 0, 0);
      replayCommand(expectedB, commands[0]);
      expect(getImageData(expectedB).data).not.toEqual(before);

      expect(rebuildLayerFromHistory(a, state).ok).toBe(true);
      expect(getImageData(a).data).toEqual(before);
      expect(rebuildLayerFromHistory(b, state).ok).toBe(true);
      expect(getImageData(b).data).toEqual(getImageData(expectedB).data);
    },
  );

  it("undoes and redoes A clear without replaying B clear onto A", () => {
    const a = createLayer(16, 16);
    const b = createLayer(16, 16);
    setPixel(a, 1, 1, RED);
    setPixel(b, 2, 2, BLUE);
    const state = history(
      [a, b],
      [createClearCommand(b.id), createClearCommand(a.id)],
    );
    clearLayer(a);
    clearLayer(b);

    const undone = executeHistoryOp("undo", state, { layers: [a, b] });
    expect(undone.ok).toBe(true);
    expect(getPixel(a, 1, 1)).toEqual(RED);
    expect(getPixel(b, 2, 2)).toEqual(EMPTY);
    const redone = executeHistoryOp("redo", undone.next, { layers: [a, b] });
    expect(redone.ok).toBe(true);
    expect(getPixel(a, 1, 1)).toEqual(EMPTY);
    expect(getPixel(b, 2, 2)).toEqual(EMPTY);
  });

  it("keeps wrap-shift global when mixed with a layer-local clear", () => {
    const a = createLayer(16, 16);
    const b = createLayer(16, 16);
    setPixel(a, 15, 1, RED);
    setPixel(b, 15, 2, BLUE);
    const state = history(
      [a, b],
      [createClearCommand(b.id), createWrapShiftCommand(2, 0)],
    );
    expect(rebuildLayerFromHistory(a, state).ok).toBe(true);
    expect(rebuildLayerFromHistory(b, state).ok).toBe(true);
    expect(getPixel(a, 1, 1)).toEqual(RED);
    expect(getPixel(a, 15, 1)).toEqual(EMPTY);
    expect(getPixel(b, 1, 2)).toEqual(EMPTY);
  });

  it("isolates the recursively rebuilt source of a duplicate", () => {
    const source = createLayer(16, 16);
    const other = createLayer(16, 16);
    const copy = createLayer(16, 16);
    setPixel(source, 1, 1, RED);
    const state = history(
      [source, other],
      [
        createClearCommand(other.id),
        createDuplicateLayerCommand(source.id, copy.id, 1, 16, 16, source.meta),
      ],
    );
    expect(rebuildLayerFromHistory(copy, state).ok).toBe(true);
    expect(getPixel(copy, 1, 1)).toEqual(RED);
  });

  it("isolates both the target and recursively rebuilt source of a merge", () => {
    const target = createLayer(16, 16);
    const source = createLayer(16, 16);
    const other = createLayer(16, 16);
    setPixel(target, 1, 1, RED);
    setPixel(source, 2, 2, BLUE);
    const state = history(
      [target, source, other],
      [
        createClearCommand(other.id),
        createMergeLayerDownCommand(
          source.id,
          target.id,
          1,
          0,
          source.meta,
          target.meta,
          target.meta,
        ),
      ],
    );
    expect(rebuildLayerFromHistory(target, state).ok).toBe(true);
    expect(getPixel(target, 1, 1)).toEqual(RED);
    expect(getPixel(target, 2, 2)).toEqual(BLUE);
  });
});
