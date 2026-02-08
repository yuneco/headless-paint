import { describe, expect, it } from "vitest";
import { isDrawCommand, isStructuralCommand } from "./types";
import type { Command } from "./types";

describe("isDrawCommand", () => {
  it("should return true for stroke", () => {
    const cmd = { type: "stroke" } as Command;
    expect(isDrawCommand(cmd)).toBe(true);
  });

  it("should return true for clear", () => {
    const cmd = { type: "clear" } as Command;
    expect(isDrawCommand(cmd)).toBe(true);
  });

  it("should return true for wrap-shift", () => {
    const cmd = { type: "wrap-shift" } as Command;
    expect(isDrawCommand(cmd)).toBe(true);
  });

  it("should return false for add-layer", () => {
    const cmd = { type: "add-layer" } as Command;
    expect(isDrawCommand(cmd)).toBe(false);
  });

  it("should return false for remove-layer", () => {
    const cmd = { type: "remove-layer" } as Command;
    expect(isDrawCommand(cmd)).toBe(false);
  });

  it("should return false for reorder-layer", () => {
    const cmd = { type: "reorder-layer" } as Command;
    expect(isDrawCommand(cmd)).toBe(false);
  });
});

describe("isStructuralCommand", () => {
  it("should return true for add-layer", () => {
    const cmd = { type: "add-layer" } as Command;
    expect(isStructuralCommand(cmd)).toBe(true);
  });

  it("should return true for remove-layer", () => {
    const cmd = { type: "remove-layer" } as Command;
    expect(isStructuralCommand(cmd)).toBe(true);
  });

  it("should return true for reorder-layer", () => {
    const cmd = { type: "reorder-layer" } as Command;
    expect(isStructuralCommand(cmd)).toBe(true);
  });

  it("should return false for stroke", () => {
    const cmd = { type: "stroke" } as Command;
    expect(isStructuralCommand(cmd)).toBe(false);
  });

  it("should return false for clear", () => {
    const cmd = { type: "clear" } as Command;
    expect(isStructuralCommand(cmd)).toBe(false);
  });

  it("should return false for wrap-shift", () => {
    const cmd = { type: "wrap-shift" } as Command;
    expect(isStructuralCommand(cmd)).toBe(false);
  });
});
