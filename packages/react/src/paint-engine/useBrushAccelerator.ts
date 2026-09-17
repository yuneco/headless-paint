import {
  createBrushAccelerator,
  resolveBrushAcceleratorBackend,
} from "@headless-paint/core";
import type {
  BrushAccelerator,
  BrushAcceleratorBackend,
} from "@headless-paint/core";
import { useEffect, useState } from "react";

interface BrushAcceleratorState {
  readonly requestedBackend: BrushAcceleratorBackend;
  readonly requestedCommitMode: "bitmap" | "direct";
  readonly accelerator: BrushAccelerator | null;
}

export function useBrushAccelerator(
  requestedBackend: BrushAcceleratorBackend,
  requestedCommitMode: "bitmap" | "direct",
): {
  readonly accelerator: BrushAccelerator | null;
  readonly gpuBackend: "webgl2" | "cpu";
  readonly gpuBackendReason: string;
} {
  const [state, setState] = useState<BrushAcceleratorState>(() => ({
    requestedBackend,
    requestedCommitMode,
    accelerator: null,
  }));
  useEffect(() => {
    const nextAccelerator =
      requestedBackend === "cpu"
        ? null
        : createBrushAccelerator({
            backend: requestedBackend,
            commitMode: requestedCommitMode,
          });
    setState({
      requestedBackend,
      requestedCommitMode,
      accelerator: nextAccelerator,
    });
    return () => nextAccelerator?.dispose();
  }, [requestedBackend, requestedCommitMode]);

  const accelerator =
    state.requestedBackend === requestedBackend &&
    state.requestedCommitMode === requestedCommitMode
      ? state.accelerator
      : null;
  const gpuBackend = accelerator?.backend ?? "cpu";
  const gpuBackendReason = resolveBrushAcceleratorBackend(
    { backend: requestedBackend },
    { webgl2Available: () => accelerator !== null },
  ).reason;
  return { accelerator, gpuBackend, gpuBackendReason };
}
