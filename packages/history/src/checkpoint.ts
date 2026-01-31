import type { Layer } from "@headless-paint/engine";
import { getImageData } from "@headless-paint/engine";
import type { Checkpoint } from "./types";

let checkpointIdCounter = 0;

/**
 * 一意なチェックポイントIDを生成
 */
function generateCheckpointId(): string {
  return `cp_${Date.now()}_${++checkpointIdCounter}`;
}

/**
 * レイヤーの現在状態からチェックポイントを作成
 */
export function createCheckpoint(
  layer: Layer,
  commandIndex: number,
): Checkpoint {
  const imageData = getImageData(layer);

  return {
    id: generateCheckpointId(),
    commandIndex,
    imageData,
    createdAt: Date.now(),
  };
}

/**
 * チェックポイントからレイヤーを復元
 */
export function restoreFromCheckpoint(
  layer: Layer,
  checkpoint: Checkpoint,
): void {
  layer.ctx.putImageData(checkpoint.imageData, 0, 0);
}
