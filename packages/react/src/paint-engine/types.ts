import type { LayerEntry } from "../useLayers";

export interface CustomCommandHandler<TCustom> {
  readonly apply: (cmd: TCustom, ctx: CustomCommandContext) => void;
  readonly undo: (cmd: TCustom, ctx: CustomCommandContext) => void;
}

export interface CustomCommandContext {
  readonly entries: readonly LayerEntry[];
  readonly findEntry: (layerId: string) => LayerEntry | undefined;
  readonly bumpRenderVersion: () => void;
}
