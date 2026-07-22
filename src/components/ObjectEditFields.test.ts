import { describe, expect, it } from "vitest";
import { dimsAreValid } from "./ObjectEditFields";

describe("dimsAreValid", () => {
  it("is valid when every axis is a finite positive number", () => {
    expect(dimsAreValid({ w: 10, d: 20, h: 30 })).toBe(true);
  });

  it("is invalid when any of the default (all three) axes is 0/negative/non-finite", () => {
    expect(dimsAreValid({ w: 0, d: 20, h: 30 })).toBe(false);
    expect(dimsAreValid({ w: 10, d: -1, h: 30 })).toBe(false);
    expect(dimsAreValid({ w: 10, d: 20, h: NaN })).toBe(false);
  });

  // Code-review fix (improvements-v2.2 §6): ObjectInspector restricts a
  // compound-sofa to `["h"]` (its only real, honored dim override — see
  // buildScene.ts's furnitureFootprint) — a garbage W/D that the user can't
  // even see/edit in that context must not block committing a valid H.
  it("only checks the given subset of axes, ignoring the others entirely", () => {
    expect(dimsAreValid({ w: 0, d: -5, h: 30 }, ["h"])).toBe(true);
    expect(dimsAreValid({ w: 10, d: 20, h: 0 }, ["h"])).toBe(false);
  });
});
