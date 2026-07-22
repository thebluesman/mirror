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

/** Best single-axis delta that brings `moving` flush against a target, among
 *  every target, within `threshold` (closest wins; null if nothing is close
 *  enough). Two candidate families:
 *
 *  - Abutment (always): `moving`'s near edge meets the target's far edge, or
 *    `moving`'s far edge meets the target's near edge — the item sits *beside*
 *    the target on the side it approached from.
 *  - Edge-alignment (`includeEdgeAlign`): the two mins coincide, or the two
 *    maxes coincide — the item's edge lines up *with* the target's same-side
 *    edge (e.g. two cabinets flush along their fronts).
 *
 *  Edge-alignment only makes sense for another item, whose whole footprint is
 *  a thing you might line up against. For a *wall* it's wrong: a wall is a
 *  solid, and lining `moving`'s min onto the wall's min (or max onto max)
 *  places the item's edge on the wall's *outer* skin — snapping it into/through
 *  the wall. So walls pass `includeEdgeAlign: false`, leaving only the two
 *  abutment candidates, which by construction keep the item on its own side of
 *  the wall face. See snapPosition. */
function bestSnapDelta(
  moving: Interval,
  targets: Interval[],
  threshold: number,
  includeEdgeAlign: boolean,
): number | null {
  let best: number | null = null;
  targets.forEach((t) => {
    const candidates = [
      t.max - moving.min, // moving's near edge abuts target's far edge
      t.min - moving.max, // moving's far edge abuts target's near edge
    ];
    if (includeEdgeAlign) {
      candidates.push(
        t.min - moving.min, // edges coincide, near side
        t.max - moving.max, // edges coincide, far side
      );
    }
    candidates.forEach((delta) => {
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best))) {
        best = delta;
      }
    });
  });
  return best;
}

/** Closest (smallest-magnitude) non-null delta among several candidates. */
function closestDelta(deltas: Array<number | null>): number | null {
  let best: number | null = null;
  deltas.forEach((d) => {
    if (d !== null && (best === null || Math.abs(d) < Math.abs(best))) best = d;
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
  // A wall's AABB is thin along the one axis its face actually points on —
  // the other axis is just the wall run's extent (its endpoints/corners),
  // not a real perpendicular face. Code-review finding: feeding a wall's
  // full AABB into both axes' target lists let an item snap its X (say) to
  // a horizontal wall's run endpoint as if that were a wall face there,
  // even with no actual wall along that axis at that point. Restricting
  // each wall to its own thin axis fixes it; item AABBs are unaffected —
  // a placed item genuinely has a real face on every side, so both axes
  // stay valid snap targets for `others`.
  const wallTargetsX: Interval[] = [];
  const wallTargetsZ: Interval[] = [];
  walls.forEach((w) => {
    if (w.maxX - w.minX <= w.maxZ - w.minZ) wallTargetsX.push({ min: w.minX, max: w.maxX });
    else wallTargetsZ.push({ min: w.minZ, max: w.maxZ });
  });
  const itemTargetsX: Interval[] = others.map((t) => ({ min: t.minX, max: t.maxX }));
  const itemTargetsZ: Interval[] = others.map((t) => ({ min: t.minZ, max: t.maxZ }));

  // Walls and items are snapped separately so walls can opt out of the
  // edge-alignment candidates (which would let an item already inside a
  // wall's thickness band snap to the wall's *far* face — deeper through the
  // wall — because that alignment is numerically closer). The nearer of the
  // two per-axis results wins.
  const movingX: Interval = { min: movingAABB.minX, max: movingAABB.maxX };
  const movingZ: Interval = { min: movingAABB.minZ, max: movingAABB.maxZ };
  const deltaX = closestDelta([
    bestSnapDelta(movingX, wallTargetsX, threshold, false),
    bestSnapDelta(movingX, itemTargetsX, threshold, true),
  ]);
  const deltaZ = closestDelta([
    bestSnapDelta(movingZ, wallTargetsZ, threshold, false),
    bestSnapDelta(movingZ, itemTargetsZ, threshold, true),
  ]);

  return {
    position: [position[0] + (deltaX ?? 0), position[1], position[2] + (deltaZ ?? 0)],
    snappedX: deltaX !== null,
    snappedZ: deltaZ !== null,
  };
}
