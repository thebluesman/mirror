// v2 spike (W-A, D2 — see spike-v2/OUTCOME.md, v2-spike-plan.md §2): footprint
// collision flagging for item-vs-item and item-vs-wall. Plain functions over
// numbers (no THREE dependency), same "pure algorithm, framework-free" shape
// as src/texturing/tileable.ts, so Viewport.tsx's live drag/rotate handlers
// can call these every pointermove without any THREE.Vector/Box3 overhead.
//
// Deliberately axis-aligned bounding boxes, not true oriented rectangles
// (SAT): "footprint-rectangle detection is enough ... this is decision
// support, not physics" per v2-spike-plan.md §2. An AABB is exact for the
// 0/90/180/270deg placements the seed and Figma conversion actually use, and
// only over-estimates (never under-estimates) at the in-between 15deg steps
// W-A's rotate control allows — conservative, not wrong.
import { furnitureFootprint } from "./buildScene";
import type { FurnitureItem, Room } from "./types";

// Mirrors buildScene.ts's WALL_THICKNESS — collision needs the same wall
// geometry the renderer draws, not a re-derived guess.
const WALL_THICKNESS = 10;

// Below this, two edges/rects are treated as touching rather than
// overlapping/colliding — without it, an item nudged to exactly flush
// against a wall or a neighbor (e.g. via snapPosition) would immediately
// re-flag as a collision against the very thing it just snapped to.
const EPSILON = 0.05;

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** World-space footprint AABB for a placed item — unions every sub-footprint
 *  part (plain box: one; compound sofa: main + chaise) after rotating each
 *  part's corners by the item's own placement rotation. */
export function itemFootprintAABB(
  item: FurnitureItem,
  position: readonly [number, number, number],
  rotationDeg: number,
): AABB {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  furnitureFootprint(item).forEach((part) => {
    const hw = part.w / 2;
    const hd = part.d / 2;
    const corners: Array<[number, number]> = [
      [part.offsetX - hw, part.offsetZ - hd],
      [part.offsetX + hw, part.offsetZ - hd],
      [part.offsetX + hw, part.offsetZ + hd],
      [part.offsetX - hw, part.offsetZ + hd],
    ];
    corners.forEach(([x, z]) => {
      const rx = x * cos - z * sin;
      const rz = x * sin + z * cos;
      const wx = position[0] + rx;
      const wz = position[2] + rz;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    });
  });
  return { minX, maxX, minZ, maxZ };
}

/** One solid AABB per wall run, at buildScene.ts's WALL_THICKNESS. Door/
 *  window openings are NOT cut out — a furniture item positioned inside a
 *  doorway's clear width will read as a wall collision here even though the
 *  render shows an open gap there. Re-deriving addWall's segment-cutting
 *  just for this check risks drifting from the renderer's own geometry, and
 *  no current seed placement puts an item in a doorway — flagged as a known
 *  simplification rather than built out speculatively. */
export function wallFootprintAABBs(room: Pick<Room, "walls">): AABB[] {
  return room.walls.map((wall) => {
    const [x0, z0] = wall.from;
    const [x1, z1] = wall.to;
    const horizontal = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
    if (horizontal) {
      return {
        minX: Math.min(x0, x1),
        maxX: Math.max(x0, x1),
        minZ: z0 - WALL_THICKNESS / 2,
        maxZ: z0 + WALL_THICKNESS / 2,
      };
    }
    return {
      minX: x0 - WALL_THICKNESS / 2,
      maxX: x0 + WALL_THICKNESS / 2,
      minZ: Math.min(z0, z1),
      maxZ: Math.max(z0, z1),
    };
  });
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX - EPSILON && a.maxX > b.minX + EPSILON && a.minZ < b.maxZ - EPSILON && a.maxZ > b.minZ + EPSILON
  );
}

export interface CollisionResult {
  /** ids of other placed items whose footprint overlaps the moving one */
  itemIds: string[];
  /** whether the moving item's footprint overlaps any wall run */
  wall: boolean;
}

export function checkCollisions(
  movingAABB: AABB,
  others: Array<{ itemId: string; aabb: AABB }>,
  walls: AABB[],
): CollisionResult {
  const itemIds = others.filter(({ aabb }) => aabbOverlap(movingAABB, aabb)).map(({ itemId }) => itemId);
  const wall = walls.some((w) => aabbOverlap(movingAABB, w));
  return { itemIds, wall };
}
