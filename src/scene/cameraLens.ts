// Proposal: docs/proposals/camera-lens-picker.md (improvements-minor-fixes.md
// §17, approved 2026-07-22 with a scope correction — presets are labeled and
// specified by 35mm-equivalent focal length, never a raw FOV degree value:
// Wide 24mm / Normal 35mm / Tele 85mm). Plain data + pure math module, no
// React/Three import — same "importable from both Viewport.tsx and
// App.tsx/ViewportChrome.tsx without pulling either into the other's
// dependency graph" shape as elevation.ts/rotateHandle.ts/walkCamera.ts.
//
// HUMAN_FOV lives here (not in Viewport.tsx, where it was originally
// declared) so there's exactly one source of truth for "the app's default
// vertical FOV" — Viewport.tsx now imports it instead of redeclaring it, per
// the proposal's own recommendation ("Normal should just BE HUMAN_FOV").

/** Vertical extent (mm) of a standard full-frame 36x24mm sensor — the
 *  convention this file derives every preset's `fov` (THREE.PerspectiveCamera's
 *  vertical field-of-view-in-degrees) from. Confirmed against precedent
 *  rather than picked fresh: `2 * atan(SENSOR_HEIGHT_MM / (2 * 35)) ≈ 37.85°`,
 *  which lands almost exactly on the pre-existing `HUMAN_FOV = 38` this app
 *  already shipped with a "~35mm-equivalent" comment and no cited derivation
 *  — so a 36x24mm full-frame sensor is the basis that was already implied,
 *  just never spelled out. Using the same basis for the three new lens
 *  presets keeps all four FOV values (including this default) on one
 *  consistent footing instead of the existing one being ad hoc and the new
 *  three being a different, incompatible one. */
export const SENSOR_HEIGHT_MM = 24;

/** Vertical FOV (degrees) for a lens of the given 35mm-equivalent focal
 *  length, using the full-frame sensor convention above. Pure trig —
 *  `2 * atan(sensorHeight / (2 * focalLength))` in radians, converted to
 *  degrees — matching `THREE.PerspectiveCamera.fov`'s own contract (vertical
 *  FOV in degrees). */
export function fovDegFromFocalLengthMm(focalLengthMm: number, sensorHeightMm: number = SENSOR_HEIGHT_MM): number {
  return 2 * Math.atan(sensorHeightMm / (2 * focalLengthMm)) * (180 / Math.PI);
}

/** ~35mm-equivalent, per spike 2's C2 feedback. The app's default live camera
 *  FOV, and the "Normal" lens preset below — imported, not recomputed, so
 *  switching back to Normal is bit-identical to today's baseline rather than
 *  a close-but-not-quite value from re-deriving it via
 *  `fovDegFromFocalLengthMm(35)` (~37.85°, close but not equal to 38). */
export const HUMAN_FOV = 38;

export const WIDE_FOCAL_LENGTH_MM = 24;
export const NORMAL_FOCAL_LENGTH_MM = 35;
export const TELE_FOCAL_LENGTH_MM = 85;

export type LensPresetId = "wide" | "normal" | "tele";

export interface LensPreset {
  id: LensPresetId;
  /** User-facing name — the HUD picker's button label. */
  label: string;
  /** User-facing 35mm-equivalent focal length, e.g. "24mm" — the ONLY unit
   *  ever shown to the user (see the proposal's correction: no degree value
   *  anywhere in the UI). */
  focalLengthLabel: string;
  /** The derived `camera.fov` this preset actually applies. Never rendered
   *  directly in the UI. */
  fovDeg: number;
}

export const LENS_PRESETS: LensPreset[] = [
  { id: "wide", label: "Wide", focalLengthLabel: "24mm", fovDeg: fovDegFromFocalLengthMm(WIDE_FOCAL_LENGTH_MM) },
  { id: "normal", label: "Normal", focalLengthLabel: "35mm", fovDeg: HUMAN_FOV },
  { id: "tele", label: "Tele", focalLengthLabel: "85mm", fovDeg: fovDegFromFocalLengthMm(TELE_FOCAL_LENGTH_MM) },
];

// Recall-sync (proposal §3): half the smallest gap between adjacent presets'
// fovDeg (Tele=16.07°, Normal=38°, Wide=53.13° — smallest gap is Tele-Normal
// at ~21.8°) would be the "no ambiguity" ceiling, but that's a needlessly
// generous tolerance for what this is actually for: absorbing float noise
// and legacy saved viewpoints captured through this exact picker (so they
// should re-highlight their preset exactly), while still treating a
// genuinely different framing — e.g. a saved viewpoint from mid-zoom, or a
// future continuous-slider value per the proposal's §1 alternative — as
// "Custom" (no highlight) rather than falsely claiming it's one of the three
// named lenses. 3° comfortably absorbs rounding noise (the presets themselves
// are irrational-trig results, not round numbers) while still calling
// anything a real photographer would consider "a different lens" Custom.
const SNAP_TOLERANCE_DEG = 3;

/** Nearest lens preset to a live `fovDeg` reading, or `null` ("Custom") if
 *  nothing is within `SNAP_TOLERANCE_DEG`. Used to sync the HUD picker's
 *  active-pill highlight after a saved-viewpoint recall sets `camera.fov`
 *  directly (proposal §3) — recall doesn't go through the picker, so the
 *  picker has to reverse-derive which preset (if any) the recalled value
 *  matches. */
export function nearestLensPresetId(fovDeg: number): LensPresetId | null {
  let best: LensPreset | null = null;
  let bestDelta = Infinity;
  for (const preset of LENS_PRESETS) {
    const delta = Math.abs(preset.fovDeg - fovDeg);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = preset;
    }
  }
  if (!best || bestDelta > SNAP_TOLERANCE_DEG) return null;
  return best.id;
}
