import { describe, expect, it } from "vitest";
import { clampElevationCm, ELEVATION_STEP_CM, MIN_ELEVATION_CM, stepElevationCm } from "./elevation";

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

describe("clampElevationCm", () => {
  it("passes through a positive height unchanged", () => {
    expect(clampElevationCm(42.7)).toBe(42.7);
  });

  it("clamps a below-floor (negative) height to MIN_ELEVATION_CM", () => {
    expect(clampElevationCm(-13)).toBe(MIN_ELEVATION_CM);
  });

  it("clamps exactly at the floor rather than just above it", () => {
    expect(clampElevationCm(0)).toBe(MIN_ELEVATION_CM);
  });

  it("agrees with stepElevationCm's floor clamp (shared MIN_ELEVATION_CM)", () => {
    // A continuous drag that resolves below the floor must land at the same
    // place a keyboard step-down that would undershoot the floor does.
    expect(clampElevationCm(-1)).toBe(stepElevationCm(2, -1, 5));
  });
});
