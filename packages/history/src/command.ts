import type { Color, Point } from "@headless-paint/engine";
import type { PipelineConfig } from "@headless-paint/input";
import { compilePipeline } from "@headless-paint/input";
import type {
  BatchCommand,
  ClearCommand,
  Command,
  DrawCircleCommand,
  DrawLineCommand,
  DrawPathCommand,
  StrokeCommand,
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
 * BatchCommand を作成（対称描画などで複数コマンドをまとめる）
 * @deprecated StrokeCommand に置き換えられます。新規コードでは createStrokeCommand を使用してください。
 */
export function createBatchCommand(
  commands: readonly Command[],
): BatchCommand {
  return {
    type: "batch",
    commands,
    timestamp: Date.now(),
  };
}

/**
 * StrokeCommand を作成
 * パイプラインAPIと組み合わせて使用
 */
export function createStrokeCommand(
  inputPoints: readonly Point[],
  pipeline: PipelineConfig,
  color: Color,
  lineWidth: number,
): StrokeCommand {
  return {
    type: "stroke",
    inputPoints,
    pipeline,
    color,
    lineWidth,
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
    case "batch":
      return `batch (${command.commands.length} commands)`;
    case "stroke": {
      const compiled = compilePipeline(command.pipeline);
      return `stroke (${command.inputPoints.length} points, ${compiled.outputCount} strokes)`;
    }
  }
}
