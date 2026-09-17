import { describe, expect, it } from "vitest";
import { createLayer } from "../../layer";
import type { Layer } from "../../types";
import { createGpuStrokeSurface } from "./gpu-stroke-surface";

function fixture() {
  const layer = createLayer(96, 64);
  layer.ctx.fillStyle = "rgba(35, 65, 120, 0.5)";
  layer.ctx.fillRect(0, 0, 96, 64);
  layer.ctx.clearRect(32, 16, 32, 32);
  const surface = createGpuStrokeSurface(96, 64);
  expect(surface).not.toBeNull();
  if (!surface) throw new Error("WebGL2 unavailable");
  surface.beginStroke(layer.canvas);
  const tip = new OffscreenCanvas(16, 16);
  const ctx = tip.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 16, 16);
  surface.setTip(tip);
  const field = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < field.length; i += 4) field.set([210, 70, 40, 255], i);
  surface.updateField(field, 4, 4);
  const dab = (x: number) =>
    surface.pushDab({ x, y: 32, size: 20, rotation: 0, alpha: 0.7 });
  return { layer, surface, dab };
}

function pixels(layer: Layer) {
  return layer.ctx.getImageData(0, 0, layer.width, layer.height).data;
}

describe("deferred bitmap commit pixel contract", () => {
  it.each(["endStroke", "drainPendingCommit", "dispose"] as const)(
    "pending → %s is byte-identical to synchronous bitmap commit",
    (action) => {
      const sync = fixture();
      const deferred = fixture();
      try {
        for (const f of [sync, deferred]) {
          f.dab(24);
          f.dab(48);
        }
        sync.surface.commitToLayer(sync.layer);
        const before = pixels(deferred.layer);
        expect(deferred.surface.commitToLayer(deferred.layer, true)).toBe(true);
        expect(pixels(deferred.layer)).toEqual(before);
        deferred.surface[action]();
        expect(pixels(deferred.layer)).toEqual(pixels(sync.layer));
        expect(deferred.surface.pollPendingCommit()).toBe(true);
      } finally {
        sync.surface.dispose();
        deferred.surface.dispose();
      }
    },
  );

  it("poll completion (or bounded drain) is byte-identical to synchronous commit", async () => {
    const sync = fixture();
    const deferred = fixture();
    try {
      for (const f of [sync, deferred]) {
        f.dab(24);
        f.dab(48);
      }
      sync.surface.commitToLayer(sync.layer);
      expect(deferred.surface.commitToLayer(deferred.layer, true)).toBe(true);
      let done = deferred.surface.pollPendingCommit();
      for (let i = 0; !done && i < 8; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        done = deferred.surface.pollPendingCommit();
      }
      if (!done) deferred.surface.drainPendingCommit();
      expect(pixels(deferred.layer)).toEqual(pixels(sync.layer));
    } finally {
      sync.surface.dispose();
      deferred.surface.dispose();
    }
  });

  it("next flush drains the old canvas and preserves both commits byte-for-byte", () => {
    const sync = fixture();
    const deferred = fixture();
    try {
      for (const x of [20, 48, 76]) {
        sync.dab(x);
        deferred.dab(x);
        sync.surface.commitToLayer(sync.layer);
        expect(deferred.surface.commitToLayer(deferred.layer, true)).toBe(true);
      }
      deferred.surface.endStroke();
      expect(pixels(deferred.layer)).toEqual(pixels(sync.layer));
    } finally {
      sync.surface.dispose();
      deferred.surface.dispose();
    }
  });

  it("cancel clears pending and restores the pre-stroke bytes including uncommitted dabs", () => {
    const f = fixture();
    try {
      const before = pixels(f.layer);
      f.dab(20);
      f.surface.commitToLayer(f.layer);
      f.dab(48);
      expect(f.surface.commitToLayer(f.layer, true)).toBe(true);
      f.dab(76);
      f.surface.flush();
      f.surface.cancelStroke();
      expect(pixels(f.layer)).toEqual(before);
      expect(f.surface.pollPendingCommit()).toBe(true);
      f.surface.endStroke();
      expect(pixels(f.layer)).toEqual(before);
    } finally {
      f.surface.dispose();
    }
  });

  it("retained undo after draining pending restores the pre-stroke bytes synchronously", () => {
    const f = fixture();
    try {
      const before = pixels(f.layer);
      f.dab(48);
      expect(f.surface.commitToLayer(f.layer, true)).toBe(true);
      f.surface.endStroke(true);
      expect(pixels(f.layer)).not.toEqual(before);
      expect(f.surface.restoreUndoToLayer(f.layer)).toBe(true);
      expect(pixels(f.layer)).toEqual(before);
      expect(f.surface.pollPendingCommit()).toBe(true);
    } finally {
      f.surface.dispose();
    }
  });
});
