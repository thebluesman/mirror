// v2 Phase 3 (PRD-v2 §7.8 / §11.1, decided 2026-07-22): the elevation
// control's pure step math, factored out the same way rotateHandle.ts
// factors out its trig — no THREE dependency, unit-testable, callable from
// Viewport.tsx's keydown handler with no per-keystroke overhead.
//
// There's no snapping/wrapping analog to snapYawDeg here (an elevation has no
// natural period to wrap around), so this is smaller than rotateHandle.ts's
// helpers — just "add a step, don't go through the floor." A PlaceCommand's
// position[1] IS an item's elevation (see buildScene.ts's addFurnitureBoxMeshes
// comment: elevation is baked into position[1], not re-added from
// item.elevationCm at render time) — so stepping it is exactly stepping the
// Y component of the item's live position, the same vector move/rotate
// already commit through onCommitPlacement. No new command type, no second
// source of truth.

/** Minimum elevation (cm) — an item can't be stepped below the floor plane.
 *  No max clamp: "lift it higher" has no natural ceiling short of the room's
 *  own ceiling height, which isn't this helper's concern (PRD-v2 §7.8: one
 *  scalar, no stacking physics, nothing fancier). */
export const MIN_ELEVATION_CM = 0;

/** Fixed step size (cm) for one keypress — the elevation analog of
 *  ROTATE_STEP_DEG's 15deg (Viewport.tsx). */
export const ELEVATION_STEP_CM = 5;

/** Applies one elevation step (+1 or -1 direction, scaled by `stepCm`) to a
 *  current Y position, clamped so it never goes below `MIN_ELEVATION_CM`.
 *  Pure — the same "small pure helper the keydown handler calls" shape as
 *  rotateHandle.ts's snapYawDeg. */
export function stepElevationCm(
  currentY: number,
  direction: 1 | -1,
  stepCm: number = ELEVATION_STEP_CM,
): number {
  const next = currentY + direction * stepCm;
  return Math.max(MIN_ELEVATION_CM, next);
}
