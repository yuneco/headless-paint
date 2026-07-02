import type { DensityProfileCurve } from "@headless-paint/engine";
import { useCallback, useRef } from "react";

interface DensityProfileCurveEditorProps {
  value: DensityProfileCurve;
  onChange: (curve: DensityProfileCurve) => void;
}

const SIZE = 170;
const PAD = 20;
const INNER = SIZE - PAD * 2;

type DragTarget = "startY" | "control1" | "control2" | "endY";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toSvgX(normalized: number): number {
  return PAD + clamp01(normalized) * INNER;
}

function toSvgY(normalized: number): number {
  return PAD + (1 - clamp01(normalized)) * INNER;
}

function fromSvgX(svgX: number): number {
  return clamp01((svgX - PAD) / INNER);
}

function fromSvgY(svgY: number): number {
  return clamp01(1 - (svgY - PAD) / INNER);
}

function buildCurvePath(curve: DensityProfileCurve): string {
  const x0 = toSvgX(0);
  const y0 = toSvgY(curve.startY);
  const cx1 = toSvgX(curve.control1.x);
  const cy1 = toSvgY(curve.control1.y);
  const cx2 = toSvgX(curve.control2.x);
  const cy2 = toSvgY(curve.control2.y);
  const x1 = toSvgX(1);
  const y1 = toSvgY(curve.endY);
  return `M ${x0} ${y0} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x1} ${y1}`;
}

export function DensityProfileCurveEditor({
  value,
  onChange,
}: DensityProfileCurveEditorProps) {
  const draggingRef = useRef<DragTarget | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handlePointerDown = useCallback(
    (target: DragTarget) => (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = target;
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const target = draggingRef.current;
      if (!target || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const svgX = e.clientX - rect.left;
      const svgY = e.clientY - rect.top;
      const x = fromSvgX(svgX);
      const y = fromSvgY(svgY);

      if (target === "startY") {
        onChange({ ...value, startY: y });
        return;
      }
      if (target === "endY") {
        onChange({ ...value, endY: y });
        return;
      }
      if (target === "control1") {
        onChange({ ...value, control1: { x, y } });
        return;
      }
      onChange({ ...value, control2: { x, y } });
    },
    [onChange, value],
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const startX = toSvgX(0);
  const startY = toSvgY(value.startY);
  const cp1x = toSvgX(value.control1.x);
  const cp1y = toSvgY(value.control1.y);
  const cp2x = toSvgX(value.control2.x);
  const cp2y = toSvgY(value.control2.y);
  const endX = toSvgX(1);
  const endY = toSvgY(value.endY);

  return (
    <svg
      ref={svgRef}
      width={SIZE}
      height={SIZE}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ display: "block", cursor: "default", background: "#1a1a2e" }}
    >
      <title>Density Profile Curve Editor</title>
      <rect
        x={PAD}
        y={PAD}
        width={INNER}
        height={INNER}
        fill="#16213e"
        stroke="#0f3460"
        strokeWidth={1}
      />
      <line
        x1={toSvgX(0)}
        y1={toSvgY(1)}
        x2={toSvgX(1)}
        y2={toSvgY(1)}
        stroke="#0f3460"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <path
        d={buildCurvePath(value)}
        fill="none"
        stroke="#e94560"
        strokeWidth={2}
      />
      <line
        x1={startX}
        y1={startY}
        x2={cp1x}
        y2={cp1y}
        stroke="#533483"
        strokeWidth={1}
      />
      <line
        x1={endX}
        y1={endY}
        x2={cp2x}
        y2={cp2y}
        stroke="#533483"
        strokeWidth={1}
      />
      <circle
        cx={startX}
        cy={startY}
        r={6}
        fill="#e94560"
        stroke="#fff"
        strokeWidth={1.5}
        cursor="ns-resize"
        onPointerDown={handlePointerDown("startY")}
      />
      <circle
        cx={cp1x}
        cy={cp1y}
        r={6}
        fill="#ffb703"
        stroke="#fff"
        strokeWidth={1.5}
        cursor="move"
        onPointerDown={handlePointerDown("control1")}
      />
      <circle
        cx={cp2x}
        cy={cp2y}
        r={6}
        fill="#ffb703"
        stroke="#fff"
        strokeWidth={1.5}
        cursor="move"
        onPointerDown={handlePointerDown("control2")}
      />
      <circle
        cx={endX}
        cy={endY}
        r={6}
        fill="#e94560"
        stroke="#fff"
        strokeWidth={1.5}
        cursor="ns-resize"
        onPointerDown={handlePointerDown("endY")}
      />
      <text x={PAD} y={SIZE - 4} fill="#8899aa" fontSize={9}>
        中央
      </text>
      <text x={SIZE - PAD - 20} y={SIZE - 4} fill="#8899aa" fontSize={9}>
        辺縁
      </text>
      <text
        x={2}
        y={PAD}
        fill="#8899aa"
        fontSize={9}
        transform={`rotate(-90, 8, ${PAD + INNER / 2})`}
      >
        高密度
      </text>
    </svg>
  );
}
