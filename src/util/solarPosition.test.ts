import { describe, expect, it } from "vitest";
import {
  deriveTimezoneOffsetHours,
  sceneAzimuthFromSolar,
  sceneSunAnglesFromLocation,
  solarPosition,
} from "./solarPosition";
import type { Location } from "../schema/scene";

// improvements-minor-fixes §9 / docs/proposals/location-lighting.md §1.2.
// Sanity checks are against closed-form solar-noon facts (not a fixed
// external oracle, since none is vendored) rather than exact NOAA-calculator
// reference numbers: at true solar noon, elevation = 90 - |lat - declination|
// and azimuth = 180 (north hemisphere) / 0 (south hemisphere, or when the
// observer is between the sun and the pole). Obliquity ~23.44deg gives
// declination ~+23.44deg at the June solstice and ~-23.44deg at the December
// solstice, which is what the expected-value math below uses. These were
// cross-checked by hand against the implementation during development (see
// the proposal's §1.3 note on pinning the math down empirically).

const NYC = { latitudeDeg: 40.7128, longitudeDeg: -74.006 };
const SYDNEY = { latitudeDeg: -33.8688, longitudeDeg: 151.2093 };
const OBLIQUITY_APPROX_DEG = 23.44;

describe("solarPosition — solar noon sanity", () => {
  it("NYC, June solstice, ~solar noon: azimuth near 180° (due south), elevation near the day's maximum", () => {
    const tz = deriveTimezoneOffsetHours(NYC.longitudeDeg);
    const { azimuthDeg, elevationDeg } = solarPosition({
      ...NYC,
      year: 2023,
      month: 6,
      day: 21,
      hour: 12,
      tzOffsetHours: tz,
    });

    // Clock noon isn't exactly solar noon (that's ~11:57 for this date/
    // longitude/derived-tz) so allow a couple of degrees rather than pinning
    // azimuth to 180.0 exactly.
    expect(Math.abs(azimuthDeg - 180)).toBeLessThan(2);
    const expectedMaxElevation = 90 - Math.abs(NYC.latitudeDeg - OBLIQUITY_APPROX_DEG);
    expect(elevationDeg).toBeCloseTo(expectedMaxElevation, 1);
  });

  it("NYC, December solstice, ~solar noon: sun is much lower (winter), still ~due south", () => {
    const tz = deriveTimezoneOffsetHours(NYC.longitudeDeg);
    const { azimuthDeg, elevationDeg } = solarPosition({
      ...NYC,
      year: 2023,
      month: 12,
      day: 21,
      hour: 12,
      tzOffsetHours: tz,
    });

    expect(Math.abs(azimuthDeg - 180)).toBeLessThan(2);
    const expectedMaxElevation = 90 - (NYC.latitudeDeg + OBLIQUITY_APPROX_DEG);
    expect(elevationDeg).toBeCloseTo(expectedMaxElevation, 1);
    // Sanity: winter noon sun sits far lower than summer noon sun at the
    // same location — the entire reason improvements-minor-fixes §9 wants
    // hour+date, not hour-only (proposal §2).
    expect(elevationDeg).toBeLessThan(30);
  });

  it("Sydney (southern hemisphere), June (its winter): midday sun sits toward the north, elevation still positive", () => {
    const tz = deriveTimezoneOffsetHours(SYDNEY.longitudeDeg);
    const { azimuthDeg, elevationDeg } = solarPosition({
      ...SYDNEY,
      year: 2023,
      month: 6,
      day: 21,
      hour: 12,
      tzOffsetHours: tz,
    });

    // Azimuth wraps through 0/360 (north) rather than 180 for a southern-
    // hemisphere winter noon — assert it's within ~1deg of due north.
    const distanceFromNorth = Math.min(azimuthDeg, 360 - azimuthDeg);
    expect(distanceFromNorth).toBeLessThan(1);
    const expectedMaxElevation = 90 - Math.abs(SYDNEY.latitudeDeg - OBLIQUITY_APPROX_DEG);
    expect(elevationDeg).toBeCloseTo(expectedMaxElevation, 1);
  });
});

describe("solarPosition — sunrise/sunset sanity", () => {
  it("NYC, June solstice: elevation is negative well before sunrise and well after sunset, positive at midday", () => {
    const tz = deriveTimezoneOffsetHours(NYC.longitudeDeg);
    const at = (hour: number) =>
      solarPosition({ ...NYC, year: 2023, month: 6, day: 21, hour, tzOffsetHours: tz }).elevationDeg;

    expect(at(3)).toBeLessThan(0); // well before sunrise (~05:25 local for this date)
    expect(at(12)).toBeGreaterThan(0); // midday
    expect(at(21)).toBeLessThan(0); // well after sunset (~20:31 local)
  });

  it("elevation crosses zero near astronomically-expected sunrise/sunset hours", () => {
    const tz = deriveTimezoneOffsetHours(NYC.longitudeDeg);
    const at = (hour: number) =>
      solarPosition({ ...NYC, year: 2023, month: 6, day: 21, hour, tzOffsetHours: tz }).elevationDeg;

    // Sunrise/sunset for NYC on the June solstice (using the derived,
    // DST-ignorant timezone) works out to roughly 04:30/19:30 local. Assert
    // the sign flips inside a bracket around each, rather than pinning an
    // exact minute (that's the full NOAA SPA's job, not this low-precision
    // calc's — proposal §1.1).
    expect(at(4.3)).toBeLessThan(0);
    expect(at(4.7)).toBeGreaterThan(0);
    expect(at(19.2)).toBeGreaterThan(0);
    expect(at(19.6)).toBeLessThan(0);
  });
});

describe("deriveTimezoneOffsetHours", () => {
  it("rounds longitude/15 to the nearest hour", () => {
    expect(deriveTimezoneOffsetHours(NYC.longitudeDeg)).toBe(-5);
    expect(deriveTimezoneOffsetHours(SYDNEY.longitudeDeg)).toBe(10);
    expect(deriveTimezoneOffsetHours(0)).toBe(0);
  });
});

// Proposal §1.3's explicit "sign caveat the implementer must pin down
// empirically." Pinned here: orientationDeg is the compass bearing the
// scene's +Z axis faces; sunPositionFromAngles places the sun along +Z at
// sceneAzimuthDeg = 0 (buildScene.ts:425's atan2(x, z) convention). So if
// +Z is told to face south (orientationDeg = 180) and the sun is actually
// due south (solarAzimuthDeg = 180, solar noon), the sun must land at
// sceneAzimuthDeg = 0 (on the room's +Z side) — confirming plain subtraction
// (solarAzimuthDeg - orientationDeg), NOT the flipped alternative.
describe("sceneAzimuthFromSolar — orientation sign (proposal §1.3)", () => {
  it("+Z facing south, sun due south (solar noon) -> sun lands on the scene's +Z side (sceneAzimuthDeg = 0)", () => {
    expect(sceneAzimuthFromSolar(180, 180)).toBeCloseTo(0, 10);
  });

  it("+Z facing north, sun due south (solar noon) -> sun lands on the scene's -Z side (sceneAzimuthDeg = 180)", () => {
    expect(sceneAzimuthFromSolar(180, 0)).toBeCloseTo(180, 10);
  });

  it("+Z facing east, sun due south -> sun lands on the scene's +X side (sceneAzimuthDeg = 90), consistent with a 90° clockwise turn from east to south", () => {
    expect(sceneAzimuthFromSolar(180, 90)).toBeCloseTo(90, 10);
  });

  it("wraps into [0, 360)", () => {
    expect(sceneAzimuthFromSolar(10, 350)).toBeCloseTo(20, 10);
    expect(sceneAzimuthFromSolar(350, 10)).toBeCloseTo(340, 10);
  });
});

describe("sceneSunAnglesFromLocation", () => {
  const baseLocation: Location = {
    latitudeDeg: NYC.latitudeDeg,
    longitudeDeg: NYC.longitudeDeg,
    orientationDeg: 180, // +Z faces south
    timeOfDayHour: 12,
    date: "2023-06-21",
  };

  it("derives timezone from longitude and maps solar noon onto sceneAzimuthDeg ~= 0 for a south-facing +Z", () => {
    const angles = sceneSunAnglesFromLocation(baseLocation);
    expect(Math.abs(angles.solarAzimuthDeg - 180)).toBeLessThan(2);
    expect(Math.abs(angles.sceneAzimuthDeg)).toBeLessThan(2);
    expect(angles.sceneElevationDeg).toBe(angles.solarElevationDeg); // pass-through, unchanged by orientation
  });

  it("respects an explicit timezoneOffsetHours override instead of deriving one", () => {
    const derived = sceneSunAnglesFromLocation(baseLocation);
    const overridden = sceneSunAnglesFromLocation({ ...baseLocation, timezoneOffsetHours: -8 });
    expect(overridden.solarAzimuthDeg).not.toBeCloseTo(derived.solarAzimuthDeg, 0);
  });

  it("falls back to referenceDate's (UTC) calendar date when location.date is absent", () => {
    const { date: _drop, ...withoutDate } = baseLocation;
    const explicit = sceneSunAnglesFromLocation(baseLocation); // date: "2023-06-21"
    const viaFallback = sceneSunAnglesFromLocation(withoutDate, new Date("2023-06-21T00:00:00Z"));
    expect(viaFallback.solarAzimuthDeg).toBeCloseTo(explicit.solarAzimuthDeg, 3);
    expect(viaFallback.solarElevationDeg).toBeCloseTo(explicit.solarElevationDeg, 3);
  });
});
