import { describe, expect, it } from "vitest";
import type { FurnitureItem } from "../schema/scene";
import { aabbOverlap, itemFootprintAABB, type AABB } from "./collision";
import { findClearDefaultPosition, largestFloorRect, type PlanRect } from "./defaultPlacement";

function box(id: string, w: number, d: number): FurnitureItem {
  return { id, name: id, shape: "box", dimsCm: { w, d, h: 100 } };
}

describe("largestFloorRect", () => {
  it("picks the largest-area rect, not the first", () => {
    // hallway-shaped rect first, bigger living-room second — by area, not order
    const rects: PlanRect[] = [
      { x: 1130, z: 274, w: 369, d: 428 }, // 157932
      { x: 474, z: 324, w: 656, d: 378 }, // 247968
    ];
    expect(largestFloorRect(rects)).toEqual(rects[1]);
  });

  it("returns null for an empty floor", () => {
    expect(largestFloorRect([])).toBeNull();
  });
});

describe("findClearDefaultPosition", () => {
  const room: PlanRect = { x: 0, z: 0, w: 1000, d: 1000 };
  const center: [number, number, number] = [500, 0, 500];

  it("returns the room center when it's clear", () => {
    expect(findClearDefaultPosition(box("new", 100, 100), 0, room, [], [])).toEqual(center);
  });

  it("rests the item on the floor (y = 0)", () => {
    const [, y] = findClearDefaultPosition(box("new", 100, 100), 0, room, [], []);
    expect(y).toBe(0);
  });

  it("nudges off an item covering the center, into a non-overlapping spot inside the room", () => {
    const blockerAABB: AABB = { minX: 400, maxX: 600, minZ: 400, maxZ: 600 };
    const item = box("new", 100, 100);
    const pos = findClearDefaultPosition(item, 0, room, [{ itemId: "blocker", aabb: blockerAABB }], []);

    expect(pos).not.toEqual(center);
    // inside the room rect
    expect(pos[0]).toBeGreaterThanOrEqual(room.x);
    expect(pos[0]).toBeLessThanOrEqual(room.x + room.w);
    expect(pos[2]).toBeGreaterThanOrEqual(room.z);
    expect(pos[2]).toBeLessThanOrEqual(room.z + room.d);
    // and genuinely clear of the blocker
    expect(aabbOverlap(itemFootprintAABB(item, pos, 0), blockerAABB)).toBe(false);
  });

  it("stays clear of walls too", () => {
    // a wall slab across the north half of the room — the nudge must land south
    const wall: AABB = { minX: 0, maxX: 1000, minZ: 0, maxZ: 520 };
    const item = box("new", 100, 100);
    const pos = findClearDefaultPosition(item, 0, room, [], [wall]);
    expect(aabbOverlap(itemFootprintAABB(item, pos, 0), wall)).toBe(false);
  });

  it("falls back to the room center when every candidate is blocked", () => {
    // a wall covering the entire room leaves no clear spot — return center, not
    // an infinite loop or throw (PRD-v2 §7.4 edge case).
    const wholeRoom: AABB = { minX: -100, maxX: 1100, minZ: -100, maxZ: 1100 };
    const pos = findClearDefaultPosition(box("new", 100, 100), 0, room, [], [wholeRoom]);
    expect(pos).toEqual(center);
  });
});
