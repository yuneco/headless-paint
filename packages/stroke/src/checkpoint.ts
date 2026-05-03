import type { Layer } from "@headless-paint/engine";
import { clearLayer, getImageData } from "@headless-paint/engine";
import { decompressSync, deflateSync } from "fflate";
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
    layerId: layer.id,
    commandIndex,
    createdAt: Date.now(),
    payload: { type: "raw", imageData },
  };
}

export function compressCheckpoint(checkpoint: Checkpoint): Checkpoint {
  if (checkpoint.payload.type !== "raw") return checkpoint;
  const { imageData } = checkpoint.payload;
  const rawBytes = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
  const bytes = deflateSync(rawBytes);
  return {
    ...checkpoint,
    payload: {
      type: "encoded",
      width: imageData.width,
      height: imageData.height,
      codec: "fflate",
      bytes,
    },
  };
}

export function getCheckpointImageData(checkpoint: Checkpoint): ImageData {
  switch (checkpoint.payload.type) {
    case "raw":
      return checkpoint.payload.imageData;
    case "encoded": {
      const data = decompressSync(checkpoint.payload.bytes);
      return new ImageData(
        new Uint8ClampedArray(data),
        checkpoint.payload.width,
        checkpoint.payload.height,
      );
    }
    case "empty":
      return new ImageData(1, 1);
  }
}

/**
 * チェックポイントからレイヤーを復元
 */
export function restoreFromCheckpoint(
  layer: Layer,
  checkpoint: Checkpoint,
): void {
  if (checkpoint.payload.type === "empty") {
    clearLayer(layer);
    return;
  }
  layer.ctx.putImageData(getCheckpointImageData(checkpoint), 0, 0);
}
