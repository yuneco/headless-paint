import type { ExpandConfig } from "@headless-paint/engine";
import type { Point, ViewTransform } from "@headless-paint/input";
import { layerToScreen, screenToLayer } from "@headless-paint/input";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { UI_SYMMETRY_GUIDE_COLOR } from "../config";

interface GuideStyle {
  readonly rootColor: string;
  readonly subColor: string;
}

const DEFAULT_GUIDE_STYLE: GuideStyle = {
  rootColor: UI_SYMMETRY_GUIDE_COLOR,
  subColor: "rgba(201, 140, 119, 0.6)",
};

interface SymmetryOverlayProps {
  config: ExpandConfig;
  transform: ViewTransform;
  width: number;
  height: number;
  guideStyle?: GuideStyle;
  onSubOffsetChange?: (offset: Point) => void;
}

const GUIDE_DASH = [8, 4];
const ORIGIN_RADIUS = 8;
const CHILD_ORIGIN_RADIUS = 10;
const CHILD_HIT_RADIUS = 16;

export function SymmetryOverlay({
  config,
  transform,
  width,
  height,
  guideStyle,
  onSubOffsetChange,
}: SymmetryOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartScreenRef = useRef<Point | null>(null);
  const dragStartOffsetRef = useRef<Point | null>(null);
  const onSubOffsetChangeRef = useRef(onSubOffsetChange);
  onSubOffsetChangeRef.current = onSubOffsetChange;

  const style = guideStyle ?? DEFAULT_GUIDE_STYLE;
  const hasChild = config.levels.length >= 2;
  const root = config.levels[0] as (typeof config.levels)[0] | undefined;

  // Compute child screen position for drag handle placement
  const childScreenPos = useMemo(() => {
    if (!hasChild || !root) return null;
    const child = config.levels[1];
    const childLayerPos = computeChildLayerPos(
      root.offset,
      child.offset,
      root.angle,
    );
    return layerToScreen(childLayerPos, transform);
  }, [hasChild, root, config.levels, transform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (!root || root.mode === "none") return;

    const originScreen = layerToScreen(root.offset, transform);

    // -- Draw root guides --
    ctx.strokeStyle = style.rootColor;
    ctx.fillStyle = style.rootColor;
    ctx.lineWidth = 1;

    if (root.mode !== "axial") {
      ctx.beginPath();
      ctx.arc(originScreen.x, originScreen.y, ORIGIN_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // ガイド角度にビュー回転を加算（レイヤー空間→スクリーン空間）
    const viewRotation = Math.atan2(transform[1], transform[0]);
    const screenAngle = root.angle + viewRotation;

    if (root.mode === "axial") {
      ctx.setLineDash(GUIDE_DASH);
      drawAxisLine(ctx, originScreen, screenAngle, width, height);
    } else if (root.mode === "radial") {
      ctx.setLineDash([]);
      for (let i = 0; i < root.divisions; i++) {
        const angle = (Math.PI * 2 * i) / root.divisions + screenAngle;
        drawRayLine(ctx, originScreen, angle, width, height);
      }
    } else if (root.mode === "kaleidoscope") {
      const totalRays = root.divisions * 2;
      for (let i = 0; i < totalRays; i++) {
        const angle = (Math.PI * i) / root.divisions + screenAngle;
        ctx.setLineDash(i % 2 === 0 ? [] : GUIDE_DASH);
        drawRayLine(ctx, originScreen, angle, width, height);
      }
    }

    ctx.setLineDash([]);

    // -- Draw child guides --
    if (hasChild && childScreenPos) {
      const child = config.levels[1];

      const childEffectiveAngle =
        root.angle +
        Math.atan2(child.offset.y, child.offset.x) +
        child.angle +
        viewRotation;

      ctx.strokeStyle = style.subColor;
      ctx.fillStyle = style.subColor;
      ctx.lineWidth = 1;

      // Draw child origin circle
      ctx.beginPath();
      ctx.arc(
        childScreenPos.x,
        childScreenPos.y,
        CHILD_ORIGIN_RADIUS,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      // Draw child guide lines (half length)
      if (child.mode === "axial") {
        ctx.setLineDash(GUIDE_DASH);
        drawAxisLine(
          ctx,
          childScreenPos,
          childEffectiveAngle,
          width / 2,
          height / 2,
        );
      } else if (child.mode === "radial") {
        ctx.setLineDash([]);
        for (let i = 0; i < child.divisions; i++) {
          const angle =
            (Math.PI * 2 * i) / child.divisions + childEffectiveAngle;
          drawRayLine(ctx, childScreenPos, angle, width / 2, height / 2);
        }
      } else if (child.mode === "kaleidoscope") {
        const totalRays = child.divisions * 2;
        for (let i = 0; i < totalRays; i++) {
          const angle = (Math.PI * i) / child.divisions + childEffectiveAngle;
          ctx.setLineDash(i % 2 === 0 ? [] : GUIDE_DASH);
          drawRayLine(ctx, childScreenPos, angle, width / 2, height / 2);
        }
      }

      ctx.setLineDash([]);
    }
  }, [config, transform, width, height, root, hasChild, style, childScreenPos]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!root || !onSubOffsetChangeRef.current) return;

      const child = config.levels[1];
      e.stopPropagation();
      e.preventDefault();
      isDraggingRef.current = true;
      dragStartScreenRef.current = {
        x: e.nativeEvent.offsetX + e.currentTarget.offsetLeft,
        y: e.nativeEvent.offsetY + e.currentTarget.offsetTop,
      };
      dragStartOffsetRef.current = { x: child.offset.x, y: child.offset.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [root, config.levels],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        !isDraggingRef.current ||
        !root ||
        !dragStartScreenRef.current ||
        !dragStartOffsetRef.current
      )
        return;

      e.stopPropagation();
      e.preventDefault();

      const currentScreen: Point = {
        x: e.nativeEvent.offsetX + e.currentTarget.offsetLeft,
        y: e.nativeEvent.offsetY + e.currentTarget.offsetTop,
      };

      // Convert start and current screen positions to layer coords
      const startLayer = screenToLayer(dragStartScreenRef.current, transform);
      const currentLayer = screenToLayer(currentScreen, transform);
      if (!startLayer || !currentLayer) return;

      // Delta in layer coords
      const deltaLayerX = currentLayer.x - startLayer.x;
      const deltaLayerY = currentLayer.y - startLayer.y;

      // Apply inverse root rotation to get delta in child's local frame
      const cosA = Math.cos(-root.angle);
      const sinA = Math.sin(-root.angle);
      const localDeltaX = deltaLayerX * cosA - deltaLayerY * sinA;
      const localDeltaY = deltaLayerX * sinA + deltaLayerY * cosA;

      const newOffset: Point = {
        x: dragStartOffsetRef.current.x + localDeltaX,
        y: dragStartOffsetRef.current.y + localDeltaY,
      };

      onSubOffsetChangeRef.current?.(newOffset);
    },
    [root, transform],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      isDraggingRef.current = false;
      dragStartScreenRef.current = null;
      dragStartOffsetRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [],
  );

  if (!root || root.mode === "none") {
    return null;
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
        }}
      />
      {hasChild && childScreenPos && onSubOffsetChange && (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            position: "absolute",
            left: childScreenPos.x - CHILD_HIT_RADIUS,
            top: childScreenPos.y - CHILD_HIT_RADIUS,
            width: CHILD_HIT_RADIUS * 2,
            height: CHILD_HIT_RADIUS * 2,
            borderRadius: "50%",
            cursor: "grab",
            pointerEvents: "auto",
          }}
        />
      )}
    </>
  );
}

function computeChildLayerPos(
  rootOffset: Point,
  childOffset: Point,
  rootAngle: number,
): Point {
  const cosA = Math.cos(rootAngle);
  const sinA = Math.sin(rootAngle);
  return {
    x: rootOffset.x + childOffset.x * cosA - childOffset.y * sinA,
    y: rootOffset.y + childOffset.x * sinA + childOffset.y * cosA,
  };
}

function drawAxisLine(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  angle: number,
  width: number,
  height: number,
) {
  const length = Math.sqrt(width * width + height * height);

  const dx = Math.sin(angle) * length;
  const dy = -Math.cos(angle) * length;

  ctx.beginPath();
  ctx.moveTo(origin.x - dx, origin.y - dy);
  ctx.lineTo(origin.x + dx, origin.y + dy);
  ctx.stroke();
}

function drawRayLine(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  angle: number,
  width: number,
  height: number,
) {
  const length = Math.sqrt(width * width + height * height);

  const dx = Math.sin(angle) * length;
  const dy = -Math.cos(angle) * length;

  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(origin.x + dx, origin.y + dy);
  ctx.stroke();
}
