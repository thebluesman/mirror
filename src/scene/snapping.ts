// v2 spike (W-A, D2 — see spike-v2/OUTCOME.md, v2-spike-plan.md §2): wall/
// edge snapping, built directly against collision.ts's AABBs. Independent
// per-axis snapping (x and z each pick their own best target, if any) is
// exact for the axis-aligned walls buildScene.ts draws and correct for the
// 0/90/180/270deg item placements the seed/Figma conversion produce — the
// same "footprint rectangle, not true OBB" simplification collision.ts
// documents applies here too.
import type { AABB } from "./collision";

// Snap engages within this many cm of a candidate alignment — small enough
// not to fight normal dragging, large enough to actually catch a
// close-to-flush placement (v2-spike-plan.md §2: "must be escapable"; the
// escape hatch itself — holding a modifier key — is Viewport.tsx's call,
// not this module's, since it's a DOM/input concern).
export const SNAP_THRESHOLD_CM = 8;

interface Interval {
  min: number;
  max: number;
}

/** Best single-axis delta that brings `moving`'s min or max edge flush
 *  against a target's max or min edge (an abutment) or exactly onto a
 *  target's min or max (an edge-alignment) — whichever candidate is closest,
 *  among every target, within `threshold`. Returns null if nothing is close
 *  enough to snap to. */
function bestSnapDelta(moving: Interval, targets: Interval[], threshold: number): number | null {
  let best: number | null = null;
  targets.forEach((t) => {
    const candidates = [
      t.max - moving.min, // moving's near edge abuts target's far edge
      t.min - moving.max, // moving's far edge abuts target's near edge
      t.min - moving.min, // edges coincide, near side
      t.max - moving.max, // edges coincide, far side
    ];
    candidates.forEach((delta) => {
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best))) {
        best = delta;
      }
    });
  });
  return best;
}

export interface SnapResult {
  position: [number, number, number];
  snappedX: boolean;
  snappedZ: boolean;
}

/** Adjusts a candidate drag position so the moving item's footprint AABB
 *  snaps flush against a nearby wall or another item's footprint, on each
 *  axis independently. `movingAABB` must already be computed at
 *  `position` (same rotation, unsnapped) — this only shifts x/z, it doesn't
 *  touch rotation. */
export function snapPosition(
  movingAABB: AABB,
  position: readonly [number, number, number],
  walls: AABB[],
  others: AABB[],
  threshold: number = SNAP_THRESHOLD_CM,
): SnapResult {
  const targets = [...walls, ...others];
  const targetsX: Interval[] = targets.map((t) => ({ min: t.minX, max: t.maxX }));
  const targetsZ: Interval[] = targets.map((t) => ({ min: t.minZ, max: t.maxZ }));

  const deltaX = bestSnapDelta({ min: movingAABB.minX, max: movingAABB.maxX }, targetsX, threshold);
  const deltaZ = bestSnapDelta({ min: movingAABB.minZ, max: movingAABB.maxZ }, targetsZ, threshold);

  return {
    position: [position[0] + (deltaX ?? 0), position[1], position[2] + (deltaZ ?? 0)],
    snappedX: deltaX !== null,
    snappedZ: deltaZ !== null,
  };
}
