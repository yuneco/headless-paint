import { useEffect, useRef } from "react";
import { type ViewTransform, decomposeTransform } from "@headless-paint/input";
import type { GUI } from "lil-gui";

interface DebugPanelProps {
  transform: ViewTransform;
  strokeCount: number;
}

export function DebugPanel({ transform, strokeCount }: DebugPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const guiRef = useRef<GUI | null>(null);
  const dataRef = useRef({
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
    strokeCount: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 既にguiが存在する場合は何もしない（StrictMode対策）
    if (guiRef.current) return;

    let mounted = true;

    import("lil-gui").then(({ GUI: LilGUI }) => {
      if (!mounted) return;

      const gui = new LilGUI({ title: "Debug Info", width: 250, container });

      gui.add(dataRef.current, "scaleX").name("Scale X").listen().disable();
      gui.add(dataRef.current, "scaleY").name("Scale Y").listen().disable();
      gui
        .add(dataRef.current, "rotation")
        .name("Rotation (deg)")
        .listen()
        .disable();
      gui
        .add(dataRef.current, "translateX")
        .name("Translate X")
        .listen()
        .disable();
      gui
        .add(dataRef.current, "translateY")
        .name("Translate Y")
        .listen()
        .disable();
      gui.add(dataRef.current, "strokeCount").name("Strokes").listen().disable();

      guiRef.current = gui;
    });

    return () => {
      mounted = false;
      guiRef.current?.destroy();
      guiRef.current = null;
    };
  }, []);

  // Update values
  useEffect(() => {
    const components = decomposeTransform(transform);
    const rotationDeg = components.rotation * (180 / Math.PI);

    dataRef.current.scaleX = Number(components.scaleX.toFixed(3));
    dataRef.current.scaleY = Number(components.scaleY.toFixed(3));
    dataRef.current.rotation = Number(rotationDeg.toFixed(1));
    dataRef.current.translateX = Number(components.translateX.toFixed(1));
    dataRef.current.translateY = Number(components.translateY.toFixed(1));
    dataRef.current.strokeCount = strokeCount;
  }, [transform, strokeCount]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 180,
        right: 16,
      }}
    />
  );
}
