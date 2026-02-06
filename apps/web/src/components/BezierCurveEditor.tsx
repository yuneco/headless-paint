import type { PressureCurve } from "@headless-paint/engine";
import { useCallback, useRef } from "react";

interface BezierCurveEditorProps {
  value: PressureCurve;
  onChange: (curve: PressureCurve) => void;
}

const SIZE = 150;
const PAD = 16;
const INNER = SIZE - PAD * 2;

function toSvgX(normalized: number): number {
  return PAD + normalized * INNER;
}

function toSvgY(normalized: number): number {
  return PAD + (1 - normalized) * INNER;
}

function fromSvgY(svgY: number): number {
  return Math.max(0, Math.min(1, 1 - (svgY - PAD) / INNER));
}

function buildCurvePath(y1: number, y2: number): string {
  const x0 = toSvgX(0);
  const yy0 = toSvgY(0);
  const cx1 = toSvgX(1 / 3);
  const cy1 = toSvgY(y1);
  const cx2 = toSvgX(2 / 3);
  const cy2 = toSvgY(y2);
  const x1 = toSvgX(1);
  const yy1 = toSvgY(1);
  return `M ${x0} ${yy0} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x1} ${yy1}`;
}

export function BezierCurveEditor({ value, onChange }: BezierCurveEditorProps) {
  const draggingRef = useRef<"y1" | "y2" | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handlePointerDown = useCallback(
    (point: "y1" | "y2") => (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = point;
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const svgY = e.clientY - rect.top;
      const newVal = fromSvgY(svgY);

      if (draggingRef.current === "y1") {
        onChange({ y1: newVal, y2: value.y2 });
      } else {
        onChange({ y1: value.y1, y2: newVal });
      }
    },
    [onChange, value],
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const cp1x = toSvgX(1 / 3);
  const cp1y = toSvgY(value.y1);
  const cp2x = toSvgX(2 / 3);
  const cp2y = toSvgY(value.y2);

  return (
    <svg
      ref={svgRef}
      width={SIZE}
      height={SIZE}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ display: "block", cursor: "default", background: "#1a1a2e" }}
    >
      <title>Pressure Curve Editor</title>
      {/* Grid area background */}
      <rect
        x={PAD}
        y={PAD}
        width={INNER}
        height={INNER}
        fill="#16213e"
        stroke="#0f3460"
        strokeWidth={1}
      />

      {/* Linear reference line */}
      <line
        x1={toSvgX(0)}
        y1={toSvgY(0)}
        x2={toSvgX(1)}
        y2={toSvgY(1)}
        stroke="#0f3460"
        strokeWidth={1}
        strokeDasharray="4 4"
      />

      {/* Bezier curve */}
      <path
        d={buildCurvePath(value.y1, value.y2)}
        fill="none"
        stroke="#e94560"
        strokeWidth={2}
      />

      {/* Control point handles (lines from endpoints to control points) */}
      <line
        x1={toSvgX(0)}
        y1={toSvgY(0)}
        x2={cp1x}
        y2={cp1y}
        stroke="#533483"
        strokeWidth={1}
      />
      <line
        x1={toSvgX(1)}
        y1={toSvgY(1)}
        x2={cp2x}
        y2={cp2y}
        stroke="#533483"
        strokeWidth={1}
      />

      {/* Control point 1 */}
      <circle
        cx={cp1x}
        cy={cp1y}
        r={6}
        fill="#e94560"
        stroke="#fff"
        strokeWidth={1.5}
        cursor="ns-resize"
        onPointerDown={handlePointerDown("y1")}
      />

      {/* Control point 2 */}
      <circle
        cx={cp2x}
        cy={cp2y}
        r={6}
        fill="#e94560"
        stroke="#fff"
        strokeWidth={1.5}
        cursor="ns-resize"
        onPointerDown={handlePointerDown("y2")}
      />

      {/* Axis labels */}
      <text x={PAD} y={SIZE - 2} fill="#8899aa" fontSize={9}>
        Input
      </text>
      <text
        x={2}
        y={PAD}
        fill="#8899aa"
        fontSize={9}
        transform={`rotate(-90, 8, ${PAD + INNER / 2})`}
      >
        Output
      </text>
    </svg>
  );
}
