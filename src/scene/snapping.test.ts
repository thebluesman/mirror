import { describe, expect, it } from "vitest";
import { itemFootprintAABB, wallFootprintAABBs } from "./collision";
import { snapPosition, SNAP_THRESHOLD_CM } from "./snapping";
import type { FurnitureItem, Room } from "./types";

const box = (id: string, w: number, d: number): FurnitureItem => ({
  id,
  name: id,
  shape: "box",
  dimsCm: { w, d, h: 50 },
});

describe("snapPosition", () => {
  it("pulls an item flush against a wall when within threshold", () => {
    const room: Pick<Room, "walls"> = { walls: [{ name: "west", from: [0, 0], to: [0, 400] }] };
    const walls = wallFootprintAABBs(room);
    // Wall AABB spans x[-5,5]. Item is 100 wide, centered at x=60 -> minX=10,
    // 5cm short of the wall's far face (maxX=5) -- within the default threshold.
    const position: [number, number, number] = [60, 0, 100];
    const item = box("a", 100, 60);
    const aabb = itemFootprintAABB(item, position, 0);
    const result = snapPosition(aabb, position, walls, [], SNAP_THRESHOLD_CM);
    expect(result.snappedX).toBe(true);
    const snappedAABB = itemFootprintAABB(item, result.position, 0);
    expect(snappedAABB.minX).toBeCloseTo(5, 5); // flush against the wall's inner face
  });

  it("does not snap when nothing is within threshold", () => {
    const room: Pick<Room, "walls"> = { walls: [{ name: "west", from: [0, 0], to: [0, 400] }] };
    const walls = wallFootprintAABBs(room);
    const position: [number, number, number] = [500, 0, 100];
    const item = box("a", 100, 60);
    const aabb = itemFootprintAABB(item, position, 0);
    const result = snapPosition(aabb, position, walls, [], SNAP_THRESHOLD_CM);
    expect(result.snappedX).toBe(false);
    expect(result.position).toEqual(position);
  });

  it("aligns edge-to-edge against a nearby item", () => {
    const neighbor = box("neighbor", 100, 100);
    const neighborAABB = itemFootprintAABB(neighbor, [0, 0, 0], 0); // x[-50,50]
    const moving = box("moving", 100, 100);
    // Moving item nearly abuts the neighbor's east edge (x=50): centered at
    // x=103 puts its west edge at 53, 3cm short of flush.
    const position: [number, number, number] = [103, 0, 0];
    const movingAABB = itemFootprintAABB(moving, position, 0);
    const result = snapPosition(movingAABB, position, [], [neighborAABB], SNAP_THRESHOLD_CM);
    expect(result.snappedX).toBe(true);
    expect(result.position[0]).toBeCloseTo(100, 5); // west edge flush at x=50
  });

  it("snaps x and z independently", () => {
    const room: Pick<Room, "walls"> = {
      walls: [
        { name: "west", from: [0, 0], to: [0, 400] },
        { name: "north", from: [0, 0], to: [400, 0] },
      ],
    };
    const walls = wallFootprintAABBs(room);
    const item = box("a", 100, 100);
    const position: [number, number, number] = [55, 0, 55];
    const aabb = itemFootprintAABB(item, position, 0);
    const result = snapPosition(aabb, position, walls, [], SNAP_THRESHOLD_CM);
    expect(result.snappedX).toBe(true);
    expect(result.snappedZ).toBe(true);
  });

  it("does not snap X to a horizontal wall's run endpoint (code-review finding)", () => {
    // A horizontal wall (long in X, thin in Z) — its AABB is x:[0,400],
    // z:[-5,5]. x=0 is just where the wall run happens to end, not a face
    // perpendicular to X; only its z:[-5,5] band is a real face. An item
    // dragged near x=0 (far from any actual X-facing wall) must not snap
    // its X to the wall's endpoint.
    const room: Pick<Room, "walls"> = { walls: [{ name: "north", from: [0, 0], to: [400, 0] }] };
    const walls = wallFootprintAABBs(room);
    const item = box("a", 100, 60);
    // Centered so its west edge (minX) sits 3cm from x=0 -- well within
    // SNAP_THRESHOLD_CM if the endpoint were (wrongly) treated as a target
    // -- but far from the wall's actual z:[-5,5] face (z=500).
    const position: [number, number, number] = [53, 0, 500];
    const aabb = itemFootprintAABB(item, position, 0);
    const result = snapPosition(aabb, position, walls, [], SNAP_THRESHOLD_CM);
    expect(result.snappedX).toBe(false);
    expect(result.position[0]).toBe(53);
  });

  it("does not snap Z to a vertical wall's run endpoint (code-review finding)", () => {
    // A vertical wall (long in Z, thin in X) — its AABB is x:[-5,5],
    // z:[0,400]. z=0 is just where the run ends, not a real Z-facing face.
    const room: Pick<Room, "walls"> = { walls: [{ name: "west", from: [0, 0], to: [0, 400] }] };
    const walls = wallFootprintAABBs(room);
    const item = box("a", 60, 100);
    const position: [number, number, number] = [500, 0, 53];
    const aabb = itemFootprintAABB(item, position, 0);
    const result = snapPosition(aabb, position, walls, [], SNAP_THRESHOLD_CM);
    expect(result.snappedZ).toBe(false);
    expect(result.position[2]).toBe(53);
  });
});
