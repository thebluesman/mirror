import { describe, expect, it } from "vitest";
import { ELEVATION_STEP_CM, MIN_ELEVATION_CM, stepElevationCm } from "./elevation";

describe("stepElevationCm", () => {
  it("raises by the step size when direction is +1", () => {
    expect(stepElevationCm(70, 1, 5)).toBe(75);
  });

  it("lowers by the step size when direction is -1", () => {
    expect(stepElevationCm(70, -1, 5)).toBe(65);
  });

  it("defaults to ELEVATION_STEP_CM when no step is given", () => {
    expect(stepElevationCm(0, 1)).toBe(ELEVATION_STEP_CM);
  });

  it("clamps at the floor (MIN_ELEVATION_CM) rather than going negative", () => {
    expect(stepElevationCm(2, -1, 5)).toBe(MIN_ELEVATION_CM);
    expect(stepElevationCm(0, -1, 5)).toBe(MIN_ELEVATION_CM);
  });

  it("has no upper clamp", () => {
    expect(stepElevationCm(1000, 1, 5)).toBe(1005);
  });

  it("is exact at a floor already resting exactly at 0", () => {
    expect(stepElevationCm(0, 1, 5)).toBe(5);
  });
});
