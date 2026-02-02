import { describe, expect, it } from "vitest";
import { compilePipeline, expandPoint, expandStroke } from "./pipeline";
import {
  startStrokeSession,
  addPointToSession,
  endStrokeSession,
} from "./session";
import type { PipelineConfig, SymmetryConfig } from "./types";

const CENTER = { x: 100, y: 100 };

describe("compilePipeline", () => {
  it("should compile identity pipeline (no transforms)", () => {
    const config: PipelineConfig = { transforms: [] };
    const compiled = compilePipeline(config);

    expect(compiled.config).toBe(config);
    expect(compiled.outputCount).toBe(1);
    expect(compiled._transforms).toHaveLength(0);
  });

  it("should compile pipeline with symmetry transform", () => {
    const symmetryConfig: SymmetryConfig = {
      mode: "radial",
      origin: CENTER,
      angle: 0,
      divisions: 6,
    };
    const config: PipelineConfig = {
      transforms: [{ type: "symmetry", config: symmetryConfig }],
    };
    const compiled = compilePipeline(config);

    expect(compiled.config).toBe(config);
    expect(compiled.outputCount).toBe(6);
    expect(compiled._transforms).toHaveLength(1);
    expect(compiled._transforms[0].type).toBe("symmetry");
    expect(compiled._transforms[0].outputCount).toBe(6);
  });
});

describe("expandPoint", () => {
  it("should return single point for identity pipeline", () => {
    const config: PipelineConfig = { transforms: [] };
    const compiled = compilePipeline(config);
    const point = { x: 150, y: 120 };

    const result = expandPoint(point, compiled);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(point);
  });

  it("should expand point with symmetry transform", () => {
    const symmetryConfig: SymmetryConfig = {
      mode: "axial",
      origin: CENTER,
      angle: 0,
      divisions: 6,
    };
    const config: PipelineConfig = {
      transforms: [{ type: "symmetry", config: symmetryConfig }],
    };
    const compiled = compilePipeline(config);
    const point = { x: 130, y: 100 };

    const result = expandPoint(point, compiled);

    expect(result).toHaveLength(2);
    expect(result[0].x).toBeCloseTo(130);
    expect(result[0].y).toBeCloseTo(100);
    expect(result[1].x).toBeCloseTo(70);
    expect(result[1].y).toBeCloseTo(100);
  });
});

describe("expandStroke", () => {
  it("should return empty array for empty input", () => {
    const config: PipelineConfig = { transforms: [] };
    const compiled = compilePipeline(config);

    const result = expandStroke([], compiled);

    expect(result).toEqual([]);
  });

  it("should expand stroke with identity pipeline", () => {
    const config: PipelineConfig = { transforms: [] };
    const compiled = compilePipeline(config);
    const inputPoints = [
      { x: 100, y: 100 },
      { x: 110, y: 110 },
      { x: 120, y: 120 },
    ];

    const result = expandStroke(inputPoints, compiled);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(inputPoints);
  });

  it("should expand stroke with symmetry transform", () => {
    const symmetryConfig: SymmetryConfig = {
      mode: "axial",
      origin: CENTER,
      angle: 0,
      divisions: 6,
    };
    const config: PipelineConfig = {
      transforms: [{ type: "symmetry", config: symmetryConfig }],
    };
    const compiled = compilePipeline(config);
    const inputPoints = [
      { x: 130, y: 100 },
      { x: 140, y: 100 },
    ];

    const result = expandStroke(inputPoints, compiled);

    expect(result).toHaveLength(2);
    // Original stroke
    expect(result[0][0].x).toBeCloseTo(130);
    expect(result[0][1].x).toBeCloseTo(140);
    // Mirrored stroke
    expect(result[1][0].x).toBeCloseTo(70);
    expect(result[1][1].x).toBeCloseTo(60);
  });
});

describe("Stroke Session", () => {
  describe("startStrokeSession", () => {
    it("should initialize session with first point", () => {
      const config: PipelineConfig = { transforms: [] };
      const compiled = compilePipeline(config);
      const point = { x: 100, y: 100 };

      const result = startStrokeSession(point, compiled);

      expect(result.state.inputPoints).toEqual([point]);
      expect(result.state.expandedStrokes).toHaveLength(1);
      expect(result.state.expandedStrokes[0]).toEqual([point]);
      expect(result.expandedStrokes).toHaveLength(1);
    });

    it("should expand first point with symmetry", () => {
      const symmetryConfig: SymmetryConfig = {
        mode: "axial",
        origin: CENTER,
        angle: 0,
        divisions: 6,
      };
      const config: PipelineConfig = {
        transforms: [{ type: "symmetry", config: symmetryConfig }],
      };
      const compiled = compilePipeline(config);
      const point = { x: 130, y: 100 };

      const result = startStrokeSession(point, compiled);

      expect(result.state.inputPoints).toEqual([point]);
      expect(result.state.expandedStrokes).toHaveLength(2);
      expect(result.expandedStrokes).toHaveLength(2);
    });
  });

  describe("addPointToSession", () => {
    it("should add point to session", () => {
      const config: PipelineConfig = { transforms: [] };
      const compiled = compilePipeline(config);
      const point1 = { x: 100, y: 100 };
      const point2 = { x: 110, y: 110 };

      const session1 = startStrokeSession(point1, compiled);
      const session2 = addPointToSession(session1.state, point2, compiled);

      expect(session2.state.inputPoints).toEqual([point1, point2]);
      expect(session2.state.expandedStrokes[0]).toEqual([point1, point2]);
    });

    it("should expand added point with symmetry", () => {
      const symmetryConfig: SymmetryConfig = {
        mode: "axial",
        origin: CENTER,
        angle: 0,
        divisions: 6,
      };
      const config: PipelineConfig = {
        transforms: [{ type: "symmetry", config: symmetryConfig }],
      };
      const compiled = compilePipeline(config);
      const point1 = { x: 130, y: 100 };
      const point2 = { x: 140, y: 100 };

      const session1 = startStrokeSession(point1, compiled);
      const session2 = addPointToSession(session1.state, point2, compiled);

      expect(session2.state.inputPoints).toHaveLength(2);
      expect(session2.state.expandedStrokes).toHaveLength(2);
      expect(session2.state.expandedStrokes[0]).toHaveLength(2);
      expect(session2.state.expandedStrokes[1]).toHaveLength(2);
    });
  });

  describe("endStrokeSession", () => {
    it("should return valid strokes (2+ points)", () => {
      const config: PipelineConfig = { transforms: [] };
      const compiled = compilePipeline(config);
      const point1 = { x: 100, y: 100 };
      const point2 = { x: 110, y: 110 };

      let session = startStrokeSession(point1, compiled);
      session = addPointToSession(session.state, point2, compiled);
      const result = endStrokeSession(session.state);

      expect(result.inputPoints).toEqual([point1, point2]);
      expect(result.validStrokes).toHaveLength(1);
      expect(result.pipelineConfig).toBe(config);
    });

    it("should filter out single-point strokes", () => {
      const config: PipelineConfig = { transforms: [] };
      const compiled = compilePipeline(config);
      const point = { x: 100, y: 100 };

      const session = startStrokeSession(point, compiled);
      const result = endStrokeSession(session.state);

      expect(result.inputPoints).toEqual([point]);
      expect(result.validStrokes).toHaveLength(0);
    });

    it("should return multiple valid strokes with symmetry", () => {
      const symmetryConfig: SymmetryConfig = {
        mode: "radial",
        origin: CENTER,
        angle: 0,
        divisions: 4,
      };
      const config: PipelineConfig = {
        transforms: [{ type: "symmetry", config: symmetryConfig }],
      };
      const compiled = compilePipeline(config);
      const point1 = { x: 150, y: 100 };
      const point2 = { x: 160, y: 100 };

      let session = startStrokeSession(point1, compiled);
      session = addPointToSession(session.state, point2, compiled);
      const result = endStrokeSession(session.state);

      expect(result.inputPoints).toHaveLength(2);
      expect(result.validStrokes).toHaveLength(4);
      expect(result.pipelineConfig).toBe(config);
    });
  });
});
