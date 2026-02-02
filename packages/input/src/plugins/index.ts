import type { TransformPlugin } from "../types";
import { symmetryPlugin } from "./symmetry-plugin";

/**
 * プラグインレジストリ
 * eslint-disable-next-line のための型キャスト
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pluginRegistry = new Map<string, TransformPlugin<any, any>>([
  [symmetryPlugin.type, symmetryPlugin],
]);

/**
 * 変換タイプに対応するプラグインを取得
 * @throws 未登録のタイプの場合
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPlugin(type: string): TransformPlugin<any, any> {
  const plugin = pluginRegistry.get(type);
  if (!plugin) {
    throw new Error(`Unknown transform type: ${type}`);
  }
  return plugin;
}

/**
 * プラグインを登録（将来の拡張用）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerPlugin(plugin: TransformPlugin<any, any>): void {
  pluginRegistry.set(plugin.type, plugin);
}
