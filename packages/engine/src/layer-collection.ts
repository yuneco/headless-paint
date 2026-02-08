import { createLayer } from "./layer";
import type { Layer, LayerMeta } from "./types";

/**
 * レイヤーを追加する
 * @returns [更新後のレイヤー配列, 新しいレイヤー]
 */
export function addLayer(
  layers: readonly Layer[],
  width: number,
  height: number,
  meta?: Partial<LayerMeta>,
  insertIndex?: number,
): [readonly Layer[], Layer] {
  const newLayer = createLayer(width, height, meta);
  const index = insertIndex ?? layers.length;
  const clampedIndex = Math.max(0, Math.min(index, layers.length));
  const updatedLayers = [
    ...layers.slice(0, clampedIndex),
    newLayer,
    ...layers.slice(clampedIndex),
  ];
  return [updatedLayers, newLayer];
}

/**
 * IDでレイヤーを削除する
 */
export function removeLayer(
  layers: readonly Layer[],
  layerId: string,
): readonly Layer[] {
  const filtered = layers.filter((l) => l.id !== layerId);
  if (filtered.length === layers.length) {
    return layers;
  }
  return filtered;
}

/**
 * IDでレイヤーを検索する
 */
export function findLayerById(
  layers: readonly Layer[],
  layerId: string,
): Layer | undefined {
  return layers.find((l) => l.id === layerId);
}

/**
 * IDでレイヤーのインデックスを取得する
 */
export function getLayerIndex(
  layers: readonly Layer[],
  layerId: string,
): number {
  return layers.findIndex((l) => l.id === layerId);
}

/**
 * レイヤーの並べ替え
 */
export function moveLayer(
  layers: readonly Layer[],
  fromIndex: number,
  toIndex: number,
): readonly Layer[] {
  if (fromIndex === toIndex) {
    return layers;
  }
  if (
    fromIndex < 0 ||
    fromIndex >= layers.length ||
    toIndex < 0 ||
    toIndex >= layers.length
  ) {
    return layers;
  }
  const result = [...layers];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

/**
 * レイヤーのメタデータを更新する（新配列を返す）
 */
export function updateLayerMeta(
  layers: readonly Layer[],
  layerId: string,
  metaUpdate: Partial<LayerMeta>,
): readonly Layer[] {
  return layers.map((l) => {
    if (l.id !== layerId) {
      return l;
    }
    return {
      ...l,
      meta: { ...l.meta, ...metaUpdate },
    };
  });
}
