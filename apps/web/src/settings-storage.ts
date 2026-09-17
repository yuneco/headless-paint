import {
  type BackgroundSettings,
  DEFAULT_BACKGROUND_COLOR,
} from "@headless-paint/engine";
import { createViewTransform } from "@headless-paint/input";
import {
  type PaintSettingsSnapshot,
  type ToolType,
  type UseExpandResult,
  type UsePenSettingsResult,
  type UseSmoothingResult,
  type ViewTransform,
  exportPaintSettings,
  importPaintSettings,
} from "@headless-paint/react";
import { useCallback, useEffect, useState } from "react";

const SETTINGS_STORAGE_KEY = "headless-paint:settings";

export type EngineBackendSetting = "auto" | "webgl2" | "cpu";
export type GpuCommitMode = "bitmap" | "direct";

export interface PersistedAppSettings {
  readonly paint: PaintSettingsSnapshot;
  readonly engineBackend: EngineBackendSetting;
}

export function isEngineBackendSetting(
  value: unknown,
): value is EngineBackendSetting {
  return value === "auto" || value === "webgl2" || value === "cpu";
}

export function getGpuBackendUrlOverride(): EngineBackendSetting | null {
  const value = new URLSearchParams(window.location.search).get("gpuBackend");
  return isEngineBackendSetting(value) ? value : null;
}

export function getGpuCommitModeUrlOverride(): GpuCommitMode | null {
  const value = new URLSearchParams(window.location.search).get("gpuCommit");
  return value === "direct" || value === "bitmap" ? value : null;
}

export function saveSettingsSnapshot(
  snapshot: PaintSettingsSnapshot,
  engineBackend: EngineBackendSetting,
): void {
  try {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...snapshot, engineBackend }),
    );
  } catch {
    // noop: localStorage の容量超過時もアプリは継続
  }
}

export function loadSettingsSnapshot(): PersistedAppSettings | null {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const paint = importPaintSettings(parsed);
    if (!paint) return null;
    const engineBackend =
      typeof parsed === "object" &&
      parsed !== null &&
      "engineBackend" in parsed &&
      isEngineBackendSetting(parsed.engineBackend)
        ? parsed.engineBackend
        : "auto";
    return { paint, engineBackend };
  } catch {
    return null;
  }
}

export function clearSettingsSnapshot(): void {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
}

interface SettingsStorageOptions {
  readonly restoredSettings: PaintSettingsSnapshot | null;
  readonly persistedGpuBackend: EngineBackendSetting;
  readonly gpuBackendUrlOverride: EngineBackendSetting | null;
  readonly tool: ToolType;
  readonly setTool: (tool: ToolType) => void;
  readonly transform: ViewTransform;
  readonly handleSetTransform: (transform: ViewTransform) => void;
  readonly penSettings: UsePenSettingsResult;
  readonly smoothing: UseSmoothingResult;
  readonly expand: UseExpandResult;
}

export function useSettingsStorage(options: SettingsStorageOptions): {
  readonly background: BackgroundSettings;
  readonly handleToggleBackground: () => void;
  readonly handleGpuBackendChange: (backend: EngineBackendSetting) => void;
} {
  const [background, setBackground] = useState<BackgroundSettings>({
    color:
      options.restoredSettings?.background.color ?? DEFAULT_BACKGROUND_COLOR,
    visible: options.restoredSettings?.background.visible ?? true,
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const restored = options.restoredSettings;
    if (!restored) {
      setHydrated(true);
      return;
    }
    const restoredTransform = createViewTransform();
    for (let index = 0; index < 9; index++) {
      restoredTransform[index] = restored.transform[index];
    }
    options.handleSetTransform(restoredTransform);

    const root = restored.expand.levels[0];
    if (root) {
      options.expand.setMode(root.mode);
      options.expand.setDivisions(root.divisions);
      options.expand.setAngle(root.angle);
    }
    const sub = restored.expand.levels[1];
    if (sub) {
      options.expand.setSubEnabled(true);
      options.expand.setSubMode(sub.mode);
      options.expand.setSubDivisions(sub.divisions);
      options.expand.setSubAngle(sub.angle);
      options.expand.setSubOffset(sub.offset);
    } else {
      options.expand.setSubEnabled(false);
    }
    options.setTool(restored.tool);
    setHydrated(true);
  }, [
    options.expand.setAngle,
    options.expand.setDivisions,
    options.expand.setMode,
    options.expand.setSubAngle,
    options.expand.setSubDivisions,
    options.expand.setSubEnabled,
    options.expand.setSubMode,
    options.expand.setSubOffset,
    options.handleSetTransform,
    options.restoredSettings,
    options.setTool,
  ]);

  const createSnapshot = useCallback(
    () =>
      exportPaintSettings({
        tool: options.tool,
        transform: options.transform,
        background,
        pen: {
          color: options.penSettings.color,
          lineWidth: options.penSettings.lineWidth,
          pressureCurve: options.penSettings.pressureCurve,
          eraser: options.penSettings.eraser,
          brush: options.penSettings.brush,
        },
        smoothing: {
          enabled: options.smoothing.enabled,
          windowSize: options.smoothing.windowSize,
        },
        expand: options.expand.config,
      }),
    [
      background,
      options.expand.config,
      options.penSettings.brush,
      options.penSettings.color,
      options.penSettings.eraser,
      options.penSettings.lineWidth,
      options.penSettings.pressureCurve,
      options.smoothing.enabled,
      options.smoothing.windowSize,
      options.tool,
      options.transform,
    ],
  );

  useEffect(() => {
    if (!hydrated) return;
    const timerId = window.setTimeout(() => {
      saveSettingsSnapshot(createSnapshot(), options.persistedGpuBackend);
    }, 300);
    return () => window.clearTimeout(timerId);
  }, [createSnapshot, hydrated, options.persistedGpuBackend]);

  const handleToggleBackground = useCallback(() => {
    setBackground((previous) => ({
      ...previous,
      visible: !previous.visible,
    }));
  }, []);

  const handleGpuBackendChange = useCallback(
    (nextBackend: EngineBackendSetting) => {
      saveSettingsSnapshot(createSnapshot(), nextBackend);
      if (options.gpuBackendUrlOverride !== null) {
        const url = new URL(window.location.href);
        url.searchParams.set("gpuBackend", nextBackend);
        window.history.replaceState(null, "", url);
      }
      window.location.reload();
    },
    [createSnapshot, options.gpuBackendUrlOverride],
  );

  return { background, handleToggleBackground, handleGpuBackendChange };
}
