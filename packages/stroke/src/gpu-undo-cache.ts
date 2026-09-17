import type { BrushAccelerator, Layer } from "@headless-paint/engine";
import type { Command, HistoryState, StrokeCommand } from "./types";

// Structural bridge, like incremental-stroke: never part of the public API.
interface GpuUndoRuntime {
  retainUndoSnapshot(layer: Layer, token: object): boolean;
  bindUndoSnapshot(token: object, index: number, branch: object): void;
  discardUndoSnapshot(token?: object): void;
  restoreUndoSnapshot(layer: Layer, index: number, branch: object): boolean;
}

interface UndoRegistration {
  readonly runtime: GpuUndoRuntime;
  readonly token: object;
}

const pending = new WeakMap<object, UndoRegistration>();
const branches = new WeakMap<object, UndoRegistration>();

export function getGpuUndoRuntime(
  accelerator?: BrushAccelerator | null,
): GpuUndoRuntime | null {
  const runtime = accelerator as
    | (BrushAccelerator & Partial<GpuUndoRuntime>)
    | null
    | undefined;
  return typeof runtime?.retainUndoSnapshot === "function"
    ? (runtime as GpuUndoRuntime)
    : null;
}

export function retainGpuUndo(
  accelerator: BrushAccelerator | null | undefined,
  layer: Layer,
  command: StrokeCommand,
): void {
  const runtime = getGpuUndoRuntime(accelerator);
  if (runtime?.retainUndoSnapshot(layer, command)) {
    pending.set(command, { runtime, token: command });
  }
}

export function bindGpuUndoHistory<TCustom>(
  previous: HistoryState<TCustom>,
  next: HistoryState<TCustom>,
  command: Command<TCustom>,
): HistoryState<TCustom> {
  const old = branches.get(previous.commands);
  // Token-specific disposal cannot discard a newly completed stroke snapshot.
  old?.runtime.discardUndoSnapshot(old.token);
  if (typeof command !== "object" || command === null) return next;
  const registration = pending.get(command);
  pending.delete(command);
  if (!registration) return next;
  if (next.commands[next.currentIndex - next.historyStartIndex] !== command) {
    registration.runtime.discardUndoSnapshot(registration.token);
    return next;
  }
  registration.runtime.bindUndoSnapshot(
    command,
    next.currentIndex,
    next.commands,
  );
  branches.set(next.commands, registration);
  return next;
}
