import {
  type BristleHeightMap,
  type HeightMapFromImageOptions,
  createBrushAssetRegistry,
  createHeightMapFromImageData,
} from "@yuneco/headless-paint";
import {
  type BristleHeightMap as CoreHeightMap,
  type HeightMapFromImageOptions as CoreOptions,
  createHeightMapFromImageData as createCoreHeightMap,
  createBrushAssetRegistry as createCoreRegistry,
} from "@yuneco/headless-paint/core";

// Checked against built declarations via package exports, without paths aliases.
export function registerPaper(image: ImageData): void {
  const options: HeightMapFromImageOptions = {
    invert: false,
    normalize: true,
    contrast: 1,
  };
  const map: BristleHeightMap = createHeightMapFromImageData(image, options);
  createBrushAssetRegistry().setHeightMap("paper", map);

  const coreOptions: CoreOptions = options;
  const coreMap: CoreHeightMap = createCoreHeightMap(image, coreOptions);
  createCoreRegistry().setHeightMap("paper", coreMap);
}
