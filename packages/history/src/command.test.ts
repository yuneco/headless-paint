import { describe, expect, it } from "vitest";
import {
  createClearCommand,
  createDrawCircleCommand,
  createDrawLineCommand,
  createDrawPathCommand,
  getCommandLabel,
} from "./command";

describe("createDrawPathCommand", () => {
  it("should create a DrawPathCommand with correct properties", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    const color = { r: 255, g: 0, b: 0, a: 255 };
    const command = createDrawPathCommand(points, color, 5);

    expect(command.type).toBe("drawPath");
    expect(command.points).toEqual(points);
    expect(command.color).toEqual(color);
    expect(command.lineWidth).toBe(5);
    expect(command.timestamp).toBeTypeOf("number");
  });
});

describe("createDrawLineCommand", () => {
  it("should create a DrawLineCommand with correct properties", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 100 };
    const color = { r: 0, g: 255, b: 0, a: 255 };
    const command = createDrawLineCommand(start, end, color, 3);

    expect(command.type).toBe("drawLine");
    expect(command.start).toEqual(start);
    expect(command.end).toEqual(end);
    expect(command.color).toEqual(color);
    expect(command.lineWidth).toBe(3);
    expect(command.timestamp).toBeTypeOf("number");
  });
});

describe("createDrawCircleCommand", () => {
  it("should create a DrawCircleCommand with correct properties", () => {
    const center = { x: 50, y: 50 };
    const color = { r: 0, g: 0, b: 255, a: 255 };
    const command = createDrawCircleCommand(center, 25, color, 2);

    expect(command.type).toBe("drawCircle");
    expect(command.center).toEqual(center);
    expect(command.radius).toBe(25);
    expect(command.color).toEqual(color);
    expect(command.lineWidth).toBe(2);
    expect(command.timestamp).toBeTypeOf("number");
  });
});

describe("createClearCommand", () => {
  it("should create a ClearCommand with timestamp", () => {
    const command = createClearCommand();

    expect(command.type).toBe("clear");
    expect(command.timestamp).toBeTypeOf("number");
  });
});

describe("getCommandLabel", () => {
  it("should return correct label for drawPath", () => {
    const command = createDrawPathCommand(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
      { r: 0, g: 0, b: 0, a: 255 },
      1,
    );
    expect(getCommandLabel(command)).toBe("drawPath (3 points)");
  });

  it("should return correct label for drawLine", () => {
    const command = createDrawLineCommand(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { r: 0, g: 0, b: 0, a: 255 },
      1,
    );
    expect(getCommandLabel(command)).toBe("drawLine");
  });

  it("should return correct label for drawCircle", () => {
    const command = createDrawCircleCommand(
      { x: 50, y: 50 },
      25.7,
      { r: 0, g: 0, b: 0, a: 255 },
      1,
    );
    expect(getCommandLabel(command)).toBe("drawCircle (r=26)");
  });

  it("should return correct label for clear", () => {
    const command = createClearCommand();
    expect(getCommandLabel(command)).toBe("clear");
  });
});
