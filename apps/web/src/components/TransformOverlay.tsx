import type { ContentBounds } from "@headless-paint/engine";
import type { Point, ViewTransform } from "@headless-paint/input";
import { layerToScreen, screenToLayer } from "@headless-paint/input";
import type { mat3 } from "gl-matrix";
import { mat3 as m3, vec2 } from "gl-matrix";
import { memo, useCallback, useRef } from "react";
import type { TransformModeState } from "../hooks/useTransformMode";

interface TransformOverlayProps {
  readonly state: TransformModeState;
  readonly transform: ViewTransform;
  readonly width: number;
  readonly height: number;
  readonly onUpdateMatrix: (matrix: mat3) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const HANDLE_SIZE = 8;
const HANDLE_HIT_SIZE = 16;

type DragKind = "move" | "nw" | "ne" | "sw" | "se";

/**
 * ContentBounds の4隅を matrix で変換し、さらにスクリーン座標に変換する
 */
function getTransformedCorners(
  bounds: ContentBounds,
  matrix: mat3,
  viewTransform: ViewTransform,
): [Point, Point, Point, Point] {
  const corners: [Point, Point, Point, Point] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];

  return corners.map((c) => {
    const v = vec2.transformMat3(vec2.create(), [c.x, c.y], matrix);
    return layerToScreen({ x: v[0], y: v[1] }, viewTransform);
  }) as [Point, Point, Point, Point];
}

/**
 * 4隅のスクリーン座標からSVG pathのd属性を構築
 */
function cornersToPath(corners: [Point, Point, Point, Point]): string {
  return `M${corners[0].x},${corners[0].y} L${corners[1].x},${corners[1].y} L${corners[2].x},${corners[2].y} L${corners[3].x},${corners[3].y} Z`;
}

/**
 * ハンドルの対角コーナーをアンカーとして取得
 */
function getAnchorCorner(kind: DragKind, bounds: ContentBounds): Point {
  switch (kind) {
    case "nw":
      return { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
    case "ne":
      return { x: bounds.x, y: bounds.y + bounds.height };
    case "sw":
      return { x: bounds.x + bounds.width, y: bounds.y };
    case "se":
      return { x: bounds.x, y: bounds.y };
    default:
      return { x: 0, y: 0 };
  }
}

function TransformOverlayComponent({
  state,
  transform,
  width,
  height,
  onUpdateMatrix,
  onConfirm,
  onCancel,
}: TransformOverlayProps) {
  const dragRef = useRef<{
    kind: DragKind;
    startLayerPoint: Point;
    startMatrix: mat3;
    anchor?: Point;
  } | null>(null);

  const corners = getTransformedCorners(
    state.initialBounds,
    state.matrix,
    transform,
  );

  const handlePointerDown = useCallback(
    (kind: DragKind, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const screenPoint = { x: e.clientX, y: e.clientY };
      const layerPoint = screenToLayer(screenPoint, transform);
      if (!layerPoint) return;

      const startMatrix = m3.clone(state.matrix);
      let anchor: Point | undefined;
      if (kind !== "move") {
        anchor = getAnchorCorner(kind, state.initialBounds);
      }

      dragRef.current = {
        kind,
        startLayerPoint: layerPoint,
        startMatrix,
        anchor,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [state.matrix, state.initialBounds, transform],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.stopPropagation();
      e.preventDefault();

      const screenPoint = { x: e.clientX, y: e.clientY };
      const layerPoint = screenToLayer(screenPoint, transform);
      if (!layerPoint) return;

      if (drag.kind === "move") {
        const dx = layerPoint.x - drag.startLayerPoint.x;
        const dy = layerPoint.y - drag.startLayerPoint.y;
        const translation = m3.fromTranslation(m3.create(), [dx, dy]);
        const newMatrix = m3.multiply(
          m3.create(),
          translation,
          drag.startMatrix,
        );
        onUpdateMatrix(newMatrix);
      } else {
        // Resize: scale relative to anchor
        const anchor = drag.anchor as Point;

        // Transform anchor through current matrix to get the start distance
        const anchorTransformed = vec2.transformMat3(
          vec2.create(),
          [anchor.x, anchor.y],
          drag.startMatrix,
        );

        // Compute scale based on distance from anchor
        const startDx = drag.startLayerPoint.x - anchorTransformed[0];
        const startDy = drag.startLayerPoint.y - anchorTransformed[1];
        const currentDx = layerPoint.x - anchorTransformed[0];
        const currentDy = layerPoint.y - anchorTransformed[1];

        const sx = Math.abs(startDx) > 1 ? currentDx / startDx : 1;
        const sy = Math.abs(startDy) > 1 ? currentDy / startDy : 1;

        // Scale around anchor: translate(-anchor) * scale * translate(anchor) * startMatrix
        const t1 = m3.fromTranslation(m3.create(), [
          -anchorTransformed[0],
          -anchorTransformed[1],
        ]);
        const s = m3.fromScaling(m3.create(), [sx, sy]);
        const t2 = m3.fromTranslation(m3.create(), [
          anchorTransformed[0],
          anchorTransformed[1],
        ]);

        const newMatrix = m3.create();
        m3.multiply(newMatrix, t2, s);
        m3.multiply(newMatrix, newMatrix, t1);
        m3.multiply(newMatrix, newMatrix, drag.startMatrix);
        onUpdateMatrix(newMatrix);
      }
    },
    [transform, onUpdateMatrix],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }, []);

  // ボタン配置: 矩形の下辺の中央
  const buttonCenter = {
    x: (corners[2].x + corners[3].x) / 2,
    y: (corners[2].y + corners[3].y) / 2 + 28,
  };

  const handleConfirmClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onConfirm();
    },
    [onConfirm],
  );

  const handleCancelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onCancel();
    },
    [onCancel],
  );

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: "none",
      }}
    >
      {/* Dashed rectangle path */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
        role="img"
        aria-label="Transform bounds"
      >
        <path
          d={cornersToPath(corners)}
          fill="none"
          stroke="#007bff"
          strokeWidth={1.5}
          strokeDasharray="6 3"
        />
      </svg>

      {/* Move area (the quad interior) */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0 }}
        role="img"
        aria-label="Transform move area"
      >
        <path
          d={cornersToPath(corners)}
          fill="transparent"
          stroke="none"
          style={{ cursor: "move", pointerEvents: "fill" }}
          onPointerDown={(e) => handlePointerDown("move", e)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </svg>

      {/* Corner resize handles */}
      {(["nw", "ne", "se", "sw"] as const).map((kind, i) => {
        const corner = corners[i];
        const cursorMap = {
          nw: "nwse-resize",
          ne: "nesw-resize",
          se: "nwse-resize",
          sw: "nesw-resize",
        };
        return (
          <div
            key={kind}
            onPointerDown={(e) => handlePointerDown(kind, e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
              position: "absolute",
              left: corner.x - HANDLE_HIT_SIZE / 2,
              top: corner.y - HANDLE_HIT_SIZE / 2,
              width: HANDLE_HIT_SIZE,
              height: HANDLE_HIT_SIZE,
              cursor: cursorMap[kind],
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                backgroundColor: "#fff",
                border: "1.5px solid #007bff",
                borderRadius: 1,
              }}
            />
          </div>
        );
      })}

      {/* Confirm / Cancel buttons */}
      <div
        style={{
          position: "absolute",
          left: buttonCenter.x,
          top: buttonCenter.y,
          transform: "translateX(-50%)",
          display: "flex",
          gap: 4,
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          onClick={handleConfirmClick}
          style={{
            padding: "3px 10px",
            fontSize: 11,
            backgroundColor: "#007bff",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          OK
        </button>
        <button
          type="button"
          onClick={handleCancelClick}
          style={{
            padding: "3px 10px",
            fontSize: 11,
            backgroundColor: "#fff",
            color: "#333",
            border: "1px solid #ccc",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export const TransformOverlay = memo(TransformOverlayComponent);
