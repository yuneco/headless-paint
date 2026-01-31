import type { Color, Point } from "@headless-paint/engine";
import type {
  ClearCommand,
  Command,
  DrawCircleCommand,
  DrawLineCommand,
  DrawPathCommand,
} from "./types";

/**
 * DrawPathCommand を作成
 */
export function createDrawPathCommand(
  points: readonly Point[],
  color: Color,
  lineWidth: number,
): DrawPathCommand {
  return {
    type: "drawPath",
    points,
    color,
    lineWidth,
    timestamp: Date.now(),
  };
}

/**
 * DrawLineCommand を作成
 */
export function createDrawLineCommand(
  start: Point,
  end: Point,
  color: Color,
  lineWidth: number,
): DrawLineCommand {
  return {
    type: "drawLine",
    start,
    end,
    color,
    lineWidth,
    timestamp: Date.now(),
  };
}

/**
 * DrawCircleCommand を作成
 */
export function createDrawCircleCommand(
  center: Point,
  radius: number,
  color: Color,
  lineWidth: number,
): DrawCircleCommand {
  return {
    type: "drawCircle",
    center,
    radius,
    color,
    lineWidth,
    timestamp: Date.now(),
  };
}

/**
 * ClearCommand を作成
 */
export function createClearCommand(): ClearCommand {
  return {
    type: "clear",
    timestamp: Date.now(),
  };
}

/**
 * コマンドの表示ラベルを取得
 */
export function getCommandLabel(command: Command): string {
  switch (command.type) {
    case "drawPath":
      return `drawPath (${command.points.length} points)`;
    case "drawLine":
      return "drawLine";
    case "drawCircle":
      return `drawCircle (r=${command.radius.toFixed(0)})`;
    case "clear":
      return "clear";
  }
}
