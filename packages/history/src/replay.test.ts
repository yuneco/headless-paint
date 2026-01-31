import { clearLayer, createLayer, getPixel, setPixel } from "@headless-paint/engine";
import { describe, expect, it } from "vitest";
import { createCheckpoint } from "./checkpoint";
import {
  createHistoryState,
  pushCommand,
  undo,
} from "./history";
import { applyCommand, rebuildLayerState, replayCommands } from "./replay";
import type { DrawPathCommand, HistoryConfig } from "./types";

const testColor = { r: 255, g: 0, b: 0, a: 255 };
const testConfig: HistoryConfig = {
  maxHistorySize: 100,
  checkpointInterval: 3,
  maxCheckpoints: 10,
};

describe("applyCommand", () => {
  it("should apply drawPath command", () => {
    const layer = createLayer(20, 20);
    const command: DrawPathCommand = {
      type: "drawPath",
      points: [
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ],
      color: testColor,
      lineWidth: 1,
      timestamp: Date.now(),
    };

    applyCommand(layer, command);

    // パス上のどこかにピクセルがあるはず
    const pixel = getPixel(layer, 5, 5);
    expect(pixel.a).toBeGreaterThan(0);
  });

  it("should apply clear command", () => {
    const layer = createLayer(10, 10);
    setPixel(layer, 5, 5, testColor);

    applyCommand(layer, { type: "clear", timestamp: Date.now() });

    const pixel = getPixel(layer, 5, 5);
    expect(pixel.a).toBe(0);
  });
});

describe("replayCommands", () => {
  it("should replay multiple commands in order", () => {
    const layer = createLayer(20, 20);
    const commands: DrawPathCommand[] = [
      {
        type: "drawPath",
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        color: testColor,
        lineWidth: 2,
        timestamp: Date.now(),
      },
      {
        type: "drawPath",
        points: [
          { x: 10, y: 10 },
          { x: 15, y: 10 },
        ],
        color: { r: 0, g: 255, b: 0, a: 255 },
        lineWidth: 2,
        timestamp: Date.now(),
      },
    ];

    replayCommands(layer, commands);

    // 両方のパスが描画されているはず
    expect(getPixel(layer, 0, 0).a).toBeGreaterThan(0);
    expect(getPixel(layer, 10, 10).a).toBeGreaterThan(0);
  });
});

describe("rebuildLayerState", () => {
  it("should rebuild layer from empty state", () => {
    const layer = createLayer(10, 10);
    setPixel(layer, 5, 5, testColor);

    const state = createHistoryState(10, 10);
    rebuildLayerState(layer, state);

    const pixel = getPixel(layer, 5, 5);
    expect(pixel.a).toBe(0);
  });

  it("should rebuild layer using checkpoint and replay", () => {
    const layer = createLayer(20, 20);
    let state = createHistoryState(20, 20);

    // 4コマンド追加（3番目でチェックポイント）
    for (let i = 0; i < 4; i++) {
      const command: DrawPathCommand = {
        type: "drawPath",
        points: [
          { x: i * 5, y: 0 },
          { x: i * 5, y: 5 },
        ],
        color: testColor,
        lineWidth: 2,
        timestamp: Date.now(),
      };
      applyCommand(layer, command);
      state = pushCommand(state, command, layer, testConfig);
    }

    expect(state.checkpoints).toHaveLength(1);

    // レイヤーをクリア
    clearLayer(layer);

    // 再構築
    rebuildLayerState(layer, state);

    // 全てのストロークが復元されているはず
    expect(getPixel(layer, 0, 0).a).toBeGreaterThan(0);
    expect(getPixel(layer, 15, 0).a).toBeGreaterThan(0);
  });

  it("should handle undo by rebuilding from checkpoint", () => {
    const layer = createLayer(20, 20);
    let state = createHistoryState(20, 20);

    // 5コマンド追加
    for (let i = 0; i < 5; i++) {
      const command: DrawPathCommand = {
        type: "drawPath",
        points: [
          { x: i * 4, y: i * 4 },
          { x: i * 4 + 3, y: i * 4 + 3 },
        ],
        color: testColor,
        lineWidth: 2,
        timestamp: Date.now(),
      };
      applyCommand(layer, command);
      state = pushCommand(state, command, layer, testConfig);
    }

    // 2回Undo
    state = undo(state);
    state = undo(state);
    expect(state.currentIndex).toBe(2);

    // 再構築
    rebuildLayerState(layer, state);

    // index 0, 1, 2 のコマンドだけ適用されているはず
    expect(getPixel(layer, 0, 0).a).toBeGreaterThan(0);
    expect(getPixel(layer, 8, 8).a).toBeGreaterThan(0);
    // index 3, 4 は適用されていないはず（位置によるが、クリアされている）
  });
});
