import { describe, expect, it } from "vitest";
import {
  fovDegFromFocalLengthMm,
  HUMAN_FOV,
  LENS_PRESETS,
  nearestLensPresetId,
  NORMAL_FOCAL_LENGTH_MM,
  SENSOR_HEIGHT_MM,
  TELE_FOCAL_LENGTH_MM,
  WIDE_FOCAL_LENGTH_MM,
} from "./cameraLens";

describe("fovDegFromFocalLengthMm", () => {
  it("derives ~37.85° for a 35mm-equivalent lens, close to the existing HUMAN_FOV=38 default", () => {
    // This is the sanity check the proposal asked for: the sensor-height
    // convention this file picked should land close to the pre-existing,
    // ad-hoc HUMAN_FOV constant when fed the same 35mm focal length.
    const fov = fovDegFromFocalLengthMm(NORMAL_FOCAL_LENGTH_MM);
    expect(fov).toBeGreaterThan(37);
    expect(fov).toBeLessThan(39);
    expect(Math.abs(fov - HUMAN_FOV)).toBeLessThan(1);
  });

  it("derives a wider (larger) FOV for a shorter focal length", () => {
    const wide = fovDegFromFocalLengthMm(WIDE_FOCAL_LENGTH_MM);
    const normal = fovDegFromFocalLengthMm(NORMAL_FOCAL_LENGTH_MM);
    expect(wide).toBeGreaterThan(normal);
  });

  it("derives a narrower (smaller) FOV for a longer focal length", () => {
    const normal = fovDegFromFocalLengthMm(NORMAL_FOCAL_LENGTH_MM);
    const tele = fovDegFromFocalLengthMm(TELE_FOCAL_LENGTH_MM);
    expect(tele).toBeLessThan(normal);
  });

  it("matches the standard full-frame formula exactly at a known sensor height", () => {
    // 2 * atan(24 / (2*24)) = 2 * atan(0.5) = 2 * 26.565... = 53.130...
    expect(fovDegFromFocalLengthMm(24, 24)).toBeCloseTo(53.13010235415598, 6);
  });

  it("accepts an explicit sensor height override, defaulting to SENSOR_HEIGHT_MM", () => {
    expect(fovDegFromFocalLengthMm(50, SENSOR_HEIGHT_MM)).toBe(fovDegFromFocalLengthMm(50));
  });
});

describe("LENS_PRESETS", () => {
  it("has exactly Wide/Normal/Tele, in that order", () => {
    expect(LENS_PRESETS.map((p) => p.id)).toEqual(["wide", "normal", "tele"]);
  });

  it("never exposes a degree value in its user-facing labels", () => {
    for (const preset of LENS_PRESETS) {
      expect(preset.label).not.toMatch(/°|deg/i);
      expect(preset.focalLengthLabel).toMatch(/^\d+mm$/);
    }
  });

  it("pins Normal to HUMAN_FOV exactly (imported, not re-derived)", () => {
    const normal = LENS_PRESETS.find((p) => p.id === "normal");
    expect(normal?.fovDeg).toBe(HUMAN_FOV);
  });

  it("orders fovDeg wide > normal > tele (wider lens = larger vertical FOV)", () => {
    const [wide, normal, tele] = LENS_PRESETS;
    expect(wide.fovDeg).toBeGreaterThan(normal.fovDeg);
    expect(normal.fovDeg).toBeGreaterThan(tele.fovDeg);
  });
});

describe("nearestLensPresetId", () => {
  it("matches a preset's own fovDeg exactly", () => {
    for (const preset of LENS_PRESETS) {
      expect(nearestLensPresetId(preset.fovDeg)).toBe(preset.id);
    }
  });

  it("snaps a value within the tolerance band to the nearest preset", () => {
    expect(nearestLensPresetId(HUMAN_FOV + 1)).toBe("normal");
    expect(nearestLensPresetId(HUMAN_FOV - 1)).toBe("normal");
  });

  it("returns null (Custom) for a value meaningfully off every preset", () => {
    expect(nearestLensPresetId(45)).toBeNull();
  });

  it("returns null for a value far outside any preset's range", () => {
    expect(nearestLensPresetId(90)).toBeNull();
    expect(nearestLensPresetId(1)).toBeNull();
  });
});
