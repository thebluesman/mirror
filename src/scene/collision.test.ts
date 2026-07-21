import { describe, expect, it } from "vitest";
import { aabbOverlap, checkCollisions, itemFootprintAABB, wallFootprintAABBs } from "./collision";
import type { FurnitureItem, Room } from "./types";

const box = (id: string, w: number, d: number, h = 50): FurnitureItem => ({
  id,
  name: id,
  shape: "box",
  dimsCm: { w, d, h },
});

const sofa: FurnitureItem = {
  id: "sofa",
  name: "sofa",
  shape: "compound-sofa",
  main: { w: 200, d: 90 },
  chaise: { w: 90, d: 150 },
};

describe("itemFootprintAABB", () => {
  it("centers a plain box at its position when unrotated", () => {
    const aabb = itemFootprintAABB(box("a", 100, 60), [500, 0, 300], 0);
    expect(aabb).toEqual({ minX: 450, maxX: 550, minZ: 270, maxZ: 330 });
  });

  it("swaps w/d extents under a 90deg rotation", () => {
    const aabb = itemFootprintAABB(box("a", 100, 60), [0, 0, 0], 90);
    expect(aabb.maxX - aabb.minX).toBeCloseTo(60, 5);
    expect(aabb.maxZ - aabb.minZ).toBeCloseTo(100, 5);
  });

  it("is exact for 0/90/180/270 and only ever expands (never shrinks) off-axis", () => {
    const axisAligned = itemFootprintAABB(box("a", 100, 60), [0, 0, 0], 0);
    const axisArea = (axisAligned.maxX - axisAligned.minX) * (axisAligned.maxZ - axisAligned.minZ);
    const offAxis = itemFootprintAABB(box("a", 100, 60), [0, 0, 0], 15);
    const offArea = (offAxis.maxX - offAxis.minX) * (offAxis.maxZ - offAxis.minZ);
    expect(offArea).toBeGreaterThanOrEqual(axisArea);
  });

  it("unions a compound sofa's main+chaise sub-footprints", () => {
    const aabb = itemFootprintAABB(sofa, [0, 0, 0], 0);
    // main spans x[-100,100]; chaise offsetX = (90-200)/2 = -55, spans x[-100,-10]
    expect(aabb.minX).toBeCloseTo(-100, 5);
    expect(aabb.maxX).toBeCloseTo(100, 5);
  });
});

describe("wallFootprintAABBs", () => {
  it("produces a thin AABB along a horizontal wall run", () => {
    const room: Pick<Room, "walls"> = { walls: [{ name: "north", from: [0, 0], to: [400, 0] }] };
    const [aabb] = wallFootprintAABBs(room);
    expect(aabb.minX).toBe(0);
    expect(aabb.maxX).toBe(400);
    expect(aabb.maxZ - aabb.minZ).toBe(10);
  });

  it("produces a thin AABB along a vertical wall run", () => {
    const room: Pick<Room, "walls"> = { walls: [{ name: "west", from: [0, 0], to: [0, 400] }] };
    const [aabb] = wallFootprintAABBs(room);
    expect(aabb.minZ).toBe(0);
    expect(aabb.maxZ).toBe(400);
    expect(aabb.maxX - aabb.minX).toBe(10);
  });
});

describe("aabbOverlap / checkCollisions", () => {
  it("does not flag two items that are clearly apart", () => {
    const a = itemFootprintAABB(box("a", 100, 100), [0, 0, 0], 0);
    const b = itemFootprintAABB(box("b", 100, 100), [500, 0, 0], 0);
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it("flags two items that interpenetrate", () => {
    const a = itemFootprintAABB(box("a", 100, 100), [0, 0, 0], 0);
    const b = itemFootprintAABB(box("b", 100, 100), [80, 0, 0], 0);
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it("treats an exactly-flush placement as touching, not colliding (snap-friendly epsilon)", () => {
    const a = itemFootprintAABB(box("a", 100, 100), [0, 0, 0], 0); // x[-50,50]
    const b = itemFootprintAABB(box("b", 100, 100), [100, 0, 0], 0); // x[50,150]
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it("checkCollisions reports both an overlapping item and a wall", () => {
    const moving = itemFootprintAABB(box("moving", 100, 100), [5, 0, 5], 0);
    const other = { itemId: "other", aabb: itemFootprintAABB(box("other", 100, 100), [5, 0, 5], 0) };
    const room: Pick<Room, "walls"> = { walls: [{ name: "north", from: [-200, 0], to: [200, 0] }] };
    const walls = wallFootprintAABBs(room);
    const result = checkCollisions(moving, [other], walls);
    expect(result.itemIds).toEqual(["other"]);
    expect(result.wall).toBe(true);
  });

  it("checkCollisions reports neither when the moving item is clear", () => {
    const moving = itemFootprintAABB(box("moving", 50, 50), [1000, 0, 1000], 0);
    const other = { itemId: "other", aabb: itemFootprintAABB(box("other", 50, 50), [0, 0, 0], 0) };
    const room: Pick<Room, "walls"> = { walls: [{ name: "north", from: [-200, 0], to: [200, 0] }] };
    const walls = wallFootprintAABBs(room);
    const result = checkCollisions(moving, [other], walls);
    expect(result.itemIds).toEqual([]);
    expect(result.wall).toBe(false);
  });
});
