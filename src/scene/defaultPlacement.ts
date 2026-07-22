// v2 Phase 4 (PRD-v2 §7.4): where a genuinely-new imported item lands when it
// has no Figma-seeded placement. v1 dropped such an item at [0,0,0] — the
// room's origin corner, buried inside the west/north walls — which is exactly
// what D0 traced the v1 "TV not showing" report to (PRD-v2 §3). This module
// computes a *visible* default instead: the center of the largest floor rect,
// nudged outward to the nearest clear spot when that center is already taken.
//
// Plain numbers over the same footprint AABBs the live drag/snap path uses
// (collision.ts's itemFootprintAABB/checkCollisions), no THREE dependency — the
// same "pure algorithm, framework-free, unit-testable" shape as snapping.ts and
// elevation.ts. The search is deliberately bounded (a fixed grid of candidate
// offsets, not an open-ended loop): an unusually cluttered room falls back to
// the center rather than spinning, since a visible-but-overlapping default is
// still strictly better than the origin-corner bug this replaces.

import { checkCollisions, itemFootprintAABB, type AABB } from "./collision";
import type { FurnitureItem } from "../schema/scene";

/** A floor rect as authored in the seed (`room.floor[]`): `x`/`z` are the
 *  top-left corner, `w`/`d` the extents — NOT a center (buildScene.ts's
 *  addFloor adds `w/2`,`d/2` to reach the mesh center). */
export interface PlanRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** The largest-area floor rect — "the room" a default gets centered in. The
 *  seed's living-room outranks its entrance-hallway on area, but this is
 *  computed, not hardcoded to index 0 or the name "living-room", so it keeps
 *  picking the main room if the seed's floor list changes. null only when
 *  there are no rects at all. */
export function largestFloorRect(rects: readonly PlanRect[]): PlanRect | null {
  let best: PlanRect | null = null;
  for (const rect of rects) {
    if (best === null || rect.w * rect.d > best.w * best.d) best = rect;
  }
  return best;
}

// Grid spacing (cm) between candidate centers in the outward search — roughly a
// small-furniture width: coarse enough that MAX_SEARCH_RINGS still spans a real
// room, fine enough to slip into a gap between already-placed items.
const SEARCH_STEP_CM = 25;

// Bounded ring count: 20 rings * 25cm reaches ~5m from the room center, past
// the far wall of any room this app models, so the search terminates on a clear
// spot (or on leaving the room rect) well before this in practice. This only
// caps the pathological every-candidate-occupied case so it can't loop forever.
const MAX_SEARCH_RINGS = 20;

/** Grid offsets in rings of increasing Chebyshev distance from (0,0), so the
 *  first clear candidate encountered is also (close to) the nearest one. Ring 0
 *  is the center itself; ring k is the square perimeter of cells k steps out. */
function* spiralOffsets(step: number, maxRings: number): Generator<readonly [number, number]> {
  yield [0, 0];
  for (let ring = 1; ring <= maxRings; ring++) {
    const r = ring * step;
    for (let i = -ring; i <= ring; i++) {
      yield [i * step, -r]; // north edge of the ring
      yield [i * step, r]; // south edge
    }
    for (let j = -ring + 1; j <= ring - 1; j++) {
      yield [-r, j * step]; // west edge (corners already emitted above)
      yield [r, j * step]; // east edge
    }
  }
}

/**
 * A visible default position for a brand-new item with no prior placement:
 * `room`'s center if that's clear, else the nearest clear spot found by
 * stepping outward on a bounded grid, else `room`'s center anyway (an
 * unusually cluttered room — a visible overlap beats the origin-corner bug).
 *
 * `others` and `walls` are pre-computed AABBs, the same inputs the live
 * drag/snap path feeds `checkCollisions`/`snapPosition` — this reuses that math
 * rather than reinventing it. Rotation is fixed at the caller's default (0deg
 * for a fresh import); only x/z are searched. The returned y is always 0: a
 * genuinely new item has no established elevation, so it rests on the floor
 * (elevation lives in `position[1]`, not `item.elevationCm` — see
 * elevation.ts / buildScene.ts's addFurnitureBoxMeshes), and there's nothing to
 * carry forward here.
 */
export function findClearDefaultPosition(
  item: FurnitureItem,
  rotationDeg: number,
  room: PlanRect,
  others: ReadonlyArray<{ itemId: string; aabb: AABB }>,
  walls: readonly AABB[],
): [number, number, number] {
  const cx = room.x + room.w / 2;
  const cz = room.z + room.d / 2;
  const othersArr = [...others];
  const wallsArr = [...walls];

  for (const [dx, dz] of spiralOffsets(SEARCH_STEP_CM, MAX_SEARCH_RINGS)) {
    const x = cx + dx;
    const z = cz + dz;
    // Keep the candidate's center inside the room rect — an offset that walks
    // out past the room's own footprint stops being a "default near the room
    // center" (and wall collisions below would reject most such spots anyway,
    // but this bounds the search to the room even in a wall-less test scene).
    if (x < room.x || x > room.x + room.w || z < room.z || z > room.z + room.d) continue;
    const aabb = itemFootprintAABB(item, [x, 0, z], rotationDeg);
    const { itemIds, wall } = checkCollisions(aabb, othersArr, wallsArr);
    if (itemIds.length === 0 && !wall) return [x, 0, z];
  }

  // Nothing clear within the search bound — fall back to the room center. Not
  // an error: the item is at least visible and near where the user expects it,
  // overlap notwithstanding. (PRD-v2 §7.4: "not worth elaborate handling.")
  return [cx, 0, cz];
}
