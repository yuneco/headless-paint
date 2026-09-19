import assert from "node:assert/strict";
import * as root from "@yuneco/headless-paint";
import * as core from "@yuneco/headless-paint/core";

for (const api of [root, core]) {
  const map = api.createHeightMapFromImageData({
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
  });
  const registry = api.createBrushAssetRegistry();
  registry.setHeightMap("paper", map);
  assert.equal(registry.getHeightMap("paper"), map);
  assert.equal(map.width, 2);
  assert.equal(map.height, 1);
  assert.deepEqual(map.heights, new Float32Array([0, 1]));
}
