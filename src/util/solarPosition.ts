// improvements-minor-fixes §9 (docs/proposals/location-lighting.md §1.2): a
// hand-rolled NOAA low-precision solar-position calculator. Pure, no network,
// no npm dependency — see the proposal's §1.1 survey for why a dependency
// (even a tiny one) isn't worth it for ~40 lines of well-documented trig.
// Accurate to well under a degree for dates near "now," which is orders of
// magnitude more precision than lighting a room needs.
//
// All intermediate math happens in the units NOAA's published steps use
// (mostly degrees, per the proposal's step list); this module converts to/
// from radians only where a `Math.*` trig call requires it.

import type { Location } from "../schema/scene";

export interface SolarPositionInput {
  latitudeDeg: number;
  longitudeDeg: number;
  /** Calendar date, local to the location (NOT UTC) — the date the user's
   *  wall clock would read. */
  year: number;
  month: number; // 1-12
  day: number;
  /** Local wall-clock hour, fractional, 0..24. */
  hour: number;
  /** Hours east of UTC (e.g. UTC-5 -> -5). Used only to convert the local
   *  clock reading into UT for the Julian Day and, separately, into true
   *  solar time (NOAA step 13) — see `sceneSunAnglesFromLocation` for how
   *  callers derive this from longitude when the user hasn't overridden it. */
  tzOffsetHours: number;
}

export interface SolarPosition {
  /** Compass bearing, 0 = due north, increasing clockwise (90 = E, 180 = S,
   *  270 = W). */
  azimuthDeg: number;
  /** Angle above the horizon; negative = sun below the horizon (night). */
  elevationDeg: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Reduces a degree value into [0, 360). */
function mod360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Reduces a degree value into [-180, 180]. */
function wrapPm180(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Julian Day for a UT calendar date/time (Meeus's standard Gregorian-
 *  calendar formula). `hourUt` is fractional and may be negative or >= 24 —
 *  that just shifts the fractional day, which is fine since JD is a
 *  continuous count; no separate day-rollover handling is needed. */
function julianDay(year: number, month: number, day: number, hourUt: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  const jd0 = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
  return jd0 + hourUt / 24;
}

/**
 * NOAA low-precision solar-position algorithm (proposal §1.2's 16 steps,
 * transcribed directly). `input.hour` is the LOCAL wall-clock hour;
 * `tzOffsetHours` converts it to/from UT internally.
 */
export function solarPosition(input: SolarPositionInput): SolarPosition {
  const { latitudeDeg, longitudeDeg, year, month, day, hour, tzOffsetHours } = input;

  // 1. Julian Day, from the calendar date + fractional time, in UT.
  const hourUt = hour - tzOffsetHours;
  const jd = julianDay(year, month, day, hourUt);

  // 2. Julian Century.
  const T = (jd - 2451545.0) / 36525;

  // 3. Geometric mean longitude of the sun (deg).
  const L0 = mod360(280.46646 + T * (36000.76983 + 0.0003032 * T));

  // 4. Geometric mean anomaly of the sun (deg).
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const Mrad = toRad(M);

  // 5. Eccentricity of Earth's orbit.
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  // 6. Sun's equation of center (deg).
  const C =
    Math.sin(Mrad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mrad) * 0.000289;

  // 7. True longitude (deg).
  const Ltrue = L0 + C;

  // 8. Apparent longitude, corrected for nutation/aberration (deg).
  const lambda = Ltrue - 0.00569 - 0.00478 * Math.sin(toRad(125.04 - 1934.136 * T));

  // 9. Mean obliquity of the ecliptic (deg).
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - 0.001813 * T))) / 60) / 60;

  // 10. Obliquity, corrected for nutation (deg).
  const eps = eps0 + 0.00256 * Math.cos(toRad(125.04 - 1934.136 * T));

  // 11. Solar declination (radians — feeds directly into the zenith formula
  //     below, no further conversion needed).
  const decl = Math.asin(Math.sin(toRad(eps)) * Math.sin(toRad(lambda)));

  // 12. Equation of time (minutes).
  const y = Math.tan(toRad(eps / 2)) ** 2;
  const L0rad = toRad(L0);
  const eqTimeRad =
    y * Math.sin(2 * L0rad) -
    2 * e * Math.sin(Mrad) +
    4 * e * y * Math.sin(Mrad) * Math.cos(2 * L0rad) -
    0.5 * y * y * Math.sin(4 * L0rad) -
    1.25 * e * e * Math.sin(2 * Mrad);
  const eqTime = 4 * toDeg(eqTimeRad);

  // 13. True solar time (minutes) — from the LOCAL clock reading (not UT),
  //     per the proposal: localClockMinutes + eqTime + 4*lng - 60*tz.
  const localClockMinutes = hour * 60;
  const trueSolarTime = localClockMinutes + eqTime + 4 * longitudeDeg - 60 * tzOffsetHours;

  // 14. Hour angle (deg), wrapped into -180..180.
  const H = wrapPm180(trueSolarTime / 4 - 180);
  const Hrad = toRad(H);

  // 15. Zenith angle -> elevation.
  const latRad = toRad(latitudeDeg);
  const cosZenith = clamp(
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(Hrad),
    -1,
    1,
  );
  const zenithRad = Math.acos(cosZenith);
  const elevationDeg = 90 - toDeg(zenithRad);

  // 16. Azimuth, from north, clockwise.
  const sinZenith = Math.sin(zenithRad);
  // Degenerate at the poles / sun exactly overhead (sinZenith ~ 0) — cosAz
  // would divide by ~0; clamp handles the NaN-adjacent edge the same way the
  // proposal's formula does (clamp before acos), which is the ceiling of
  // precision this low-precision algorithm promises (§1.1).
  const cosAz = clamp((Math.sin(latRad) * cosZenith - Math.sin(decl)) / (Math.cos(latRad) * sinZenith), -1, 1);
  const azRaw = toDeg(Math.acos(cosAz));
  const azimuthDeg = H > 0 ? mod360(azRaw + 180) : mod360(540 - azRaw);

  return { azimuthDeg, elevationDeg };
}

/** Derives the timezone offset the NOAA calc uses from longitude when the
 *  location doesn't carry an explicit override (proposal §1.2: "recommend
 *  deriving it, not asking for it"). */
export function deriveTimezoneOffsetHours(longitudeDeg: number): number {
  return Math.round(longitudeDeg / 15);
}

/** Result of turning a `Location` into the two numbers the render path
 *  consumes. Keeps both the raw compass-space solar values (for the
 *  LightingPanel hint line) and the scene-space ones (for buildScene). */
export interface SceneSunAngles {
  solarAzimuthDeg: number;
  solarElevationDeg: number;
  sceneAzimuthDeg: number;
  /** Orientation-independent — passes through unchanged from solarElevationDeg. */
  sceneElevationDeg: number;
}

/**
 * Maps a compass-space solar azimuth onto the scene's `atan2(x, z)`
 * convention (0 = +Z, 90 = +X — see buildScene.ts's `sunPositionFromAngles`),
 * given the compass bearing `orientationDeg` that the scene's +Z axis faces.
 *
 * Sign, pinned down empirically (proposal §1.3's explicit caveat — see
 * solarPosition.test.ts for the worked check this documents): take
 * orientationDeg = 180 (+Z faces south) and solar noon in the northern
 * hemisphere (solarAzimuthDeg ~= 180, sun due south). Plain subtraction gives
 * sceneAzimuthDeg = 180 - 180 = 0, which is the scene's +Z direction per
 * `sunPositionFromAngles` — i.e. the sun lands on the room's +Z side, which
 * is exactly the south side the user told the app +Z faces. That is self-
 * consistent under "compass bearing increasing N->E->S->W" and "scene azimuth
 * increasing +Z->+X" being the same rotational sense, which is how
 * `sunPositionFromAngles`'s sin/cos construction treats them. No flip needed.
 */
export function sceneAzimuthFromSolar(solarAzimuthDeg: number, orientationDeg: number): number {
  return mod360(solarAzimuthDeg - orientationDeg);
}

/**
 * Turns a `room.location` into both the raw solar angles and the
 * scene-space angles `sunPositionFromAngles` consumes. Handles the two
 * "derive if absent" fields the proposal calls out: `date` (falls back to
 * `referenceDate`, which the caller defaults to "today" — see §2/§4.3) and
 * `timezoneOffsetHours` (falls back to `deriveTimezoneOffsetHours`, §1.2).
 */
export function sceneSunAnglesFromLocation(location: Location, referenceDate: Date = new Date()): SceneSunAngles {
  const tzOffsetHours = location.timezoneOffsetHours ?? deriveTimezoneOffsetHours(location.longitudeDeg);

  let year: number;
  let month: number;
  let day: number;
  if (location.date) {
    const [y, m, d] = location.date.split("-").map(Number);
    year = y;
    month = m;
    day = d;
  } else {
    // No date on file (§4.3: hour-only fallback) — use referenceDate's
    // calendar date, read in UTC so this stays independent of the runtime's
    // local timezone (pure/testable).
    year = referenceDate.getUTCFullYear();
    month = referenceDate.getUTCMonth() + 1;
    day = referenceDate.getUTCDate();
  }

  const { azimuthDeg: solarAzimuthDeg, elevationDeg: solarElevationDeg } = solarPosition({
    latitudeDeg: location.latitudeDeg,
    longitudeDeg: location.longitudeDeg,
    year,
    month,
    day,
    hour: location.timeOfDayHour,
    tzOffsetHours,
  });

  return {
    solarAzimuthDeg,
    solarElevationDeg,
    sceneAzimuthDeg: sceneAzimuthFromSolar(solarAzimuthDeg, location.orientationDeg),
    sceneElevationDeg: solarElevationDeg,
  };
}
