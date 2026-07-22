// improvements-v2.2 §2 (camera containment): the room's own floor extent
// doubles as the camera's soft containment volume — RoomSchema already
// carries everything needed (src/schema/scene.ts's `RoomSchema`), so bounds
// are derived here rather than hardcoded to match today's one seeded room.
//
// "Soft clamp" (resolved scope, improvements-v2.2 §2): the camera can push
// past the room's own footprint/height for a wider framing shot, but
// increasingly resists the further it goes — never a rigid wall it can't
// cross at all, but never truly unbounded either. Implemented as a rubber-
// band-style asymptotic clamp (the same idea as iOS's scroll-view
// overscroll): near the boundary, resistance is negligible (near 1:1 with
// the raw input); far past it, displacement saturates and approaches (never
// quite reaches) `boundary + softMarginCm`. Pure/unit-testable, same shape
// as elevation.ts's stepElevationCm/clampElevationCm.

import type { Room } from "../schema/scene";

export interface RoomBoundsCm {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

/** How far past the room's own footprint/height the camera can push before
 *  the rubber-band resistance becomes dominant — generous enough for a
 *  wider framing shot, not so generous the room reads as unbounded. */
export const CAMERA_OVERSHOOT_CM = 150;

/** The eye is allowed a little below floor level (e.g. framing a low object
 *  from just above it) without resistance kicking in exactly at 0. */
const MIN_EYE_HEIGHT_CM = -20;

/** Union of every floor rect's extent, plus the room's ceiling height for the
 *  vertical bound — an L-shaped room (e.g. the seed's living room + entrance
 *  hallway) unions to its overall bounding box, the same AABB-not-SAT
 *  simplification collision.ts's wallFootprintAABBs already accepts for
 *  exactly this kind of room shape. A room with no floor rects (shouldn't
 *  happen past schema validation, but not this function's job to enforce)
 *  degenerates to a zero-sized box at the origin rather than +/-Infinity
 *  bounds, so a caller can't end up "clamping" against an unbounded box. */
export function computeRoomBoundsCm(room: Pick<Room, "floor" | "ceilingHeightCm">): RoomBoundsCm {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  room.floor.forEach((rect) => {
    minX = Math.min(minX, rect.x);
    maxX = Math.max(maxX, rect.x + rect.w);
    minZ = Math.min(minZ, rect.z);
    maxZ = Math.max(maxZ, rect.z + rect.d);
  });
  if (room.floor.length === 0) {
    minX = maxX = minZ = maxZ = 0;
  }
  return { minX, maxX, minZ, maxZ, minY: MIN_EYE_HEIGHT_CM, maxY: room.ceilingHeightCm };
}

/** Rubber-bands a single axis value against [min, max]: unchanged inside the
 *  bound, asymptotically approaches `bound + softMarginCm` outside it. */
function rubberBandAxis(value: number, min: number, max: number, softMarginCm: number): number {
  if (value > max) {
    const overshoot = value - max;
    return max + (softMarginCm * overshoot) / (overshoot + softMarginCm);
  }
  if (value < min) {
    const overshoot = min - value;
    return min - (softMarginCm * overshoot) / (overshoot + softMarginCm);
  }
  return value;
}

/** Soft-clamps a camera eye position against the room's bounds — see this
 *  file's header comment for the rubber-band shape. Called every frame from
 *  Viewport.tsx's animate() loop (orbit mode only — walk mode has its own
 *  fixed eye height and free WASD roaming, out of this feature's scope), so
 *  it has to be cheap: three scalar rubber-bands, one new tuple, no other
 *  allocation. */
export function softClampCameraPosition(
  position: readonly [number, number, number],
  bounds: RoomBoundsCm,
  softMarginCm: number = CAMERA_OVERSHOOT_CM,
): [number, number, number] {
  return [
    rubberBandAxis(position[0], bounds.minX, bounds.maxX, softMarginCm),
    rubberBandAxis(position[1], bounds.minY, bounds.maxY, softMarginCm),
    rubberBandAxis(position[2], bounds.minZ, bounds.maxZ, softMarginCm),
  ];
}
