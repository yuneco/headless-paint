import type { FilterPlugin } from "../types";
import { smoothingPlugin } from "./smoothing-plugin";

/**
 * フィルタプラグインレジストリ
 */
const filterPluginRegistry = new Map<string, FilterPlugin>([
  [smoothingPlugin.type, smoothingPlugin],
]);

/**
 * フィルタタイプに対応するプラグインを取得
 * @throws 未登録のタイプの場合
 */
export function getFilterPlugin(type: string): FilterPlugin {
  const plugin = filterPluginRegistry.get(type);
  if (!plugin) {
    throw new Error(`Unknown filter type: ${type}`);
  }
  return plugin;
}

/**
 * フィルタプラグインを登録（将来の拡張用）
 */
export function registerFilterPlugin(plugin: FilterPlugin): void {
  filterPluginRegistry.set(plugin.type, plugin);
}
