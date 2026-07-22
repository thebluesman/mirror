import { describe, expect, it } from "vitest";
import { CAMERA_OVERSHOOT_CM, computeRoomBoundsCm, softClampCameraPosition } from "./cameraBounds";

describe("computeRoomBoundsCm", () => {
  it("derives bounds from a single rectangular floor rect", () => {
    const bounds = computeRoomBoundsCm({
      floor: [{ name: "main", x: 0, z: 0, w: 500, d: 400 }],
      ceilingHeightCm: 260,
    });
    expect(bounds).toEqual({ minX: 0, maxX: 500, minZ: 0, maxZ: 400, minY: -20, maxY: 260 });
  });

  it("unions multiple floor rects (an L-shaped room)", () => {
    const bounds = computeRoomBoundsCm({
      floor: [
        { name: "living-room", x: 0, z: 0, w: 500, d: 400 },
        { name: "entrance-hallway", x: 500, z: 100, w: 150, d: 200 },
      ],
      ceilingHeightCm: 260,
    });
    expect(bounds.minX).toBe(0);
    expect(bounds.maxX).toBe(650);
    expect(bounds.minZ).toBe(0);
    expect(bounds.maxZ).toBe(400);
  });

  it("degenerates to a zero-sized box when there's no floor data", () => {
    const bounds = computeRoomBoundsCm({ floor: [], ceilingHeightCm: 260 });
    expect(bounds).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0, minY: -20, maxY: 260 });
  });
});

describe("softClampCameraPosition", () => {
  const bounds = { minX: 0, maxX: 500, minZ: 0, maxZ: 400, minY: -20, maxY: 260 };

  it("passes a position inside the bounds through unchanged", () => {
    expect(softClampCameraPosition([250, 150, 200], bounds)).toEqual([250, 150, 200]);
  });

  it("passes a position exactly on the boundary through unchanged", () => {
    expect(softClampCameraPosition([500, 150, 400], bounds)).toEqual([500, 150, 400]);
  });

  it("barely resists a small overshoot (near 1:1 close to the boundary)", () => {
    const [x] = softClampCameraPosition([510, 150, 200], bounds);
    // 10cm overshoot against a 150cm soft margin should land close to +10,
    // not be crushed down to near-zero this early in the rubber-band curve.
    expect(x).toBeGreaterThan(505);
    expect(x).toBeLessThan(510);
  });

  it("increasingly resists a large overshoot, saturating toward bound + softMarginCm", () => {
    const [xModerate] = softClampCameraPosition([700, 150, 200], bounds);
    const [xExtreme] = softClampCameraPosition([50000, 150, 200], bounds);
    expect(xModerate).toBeLessThan(500 + CAMERA_OVERSHOOT_CM);
    expect(xExtreme).toBeLessThan(500 + CAMERA_OVERSHOOT_CM);
    // Monotonic: pushing further still moves the clamped result further, just
    // by ever-smaller increments — never a rigid wall, per the resolved scope.
    expect(xExtreme).toBeGreaterThan(xModerate);
    // But it never actually reaches the asymptote.
    expect(xExtreme).toBeLessThan(500 + CAMERA_OVERSHOOT_CM);
  });

  it("clamps symmetrically on the low side (min bounds)", () => {
    const [x] = softClampCameraPosition([-510, 150, 200], bounds);
    expect(x).toBeGreaterThan(-(0 + CAMERA_OVERSHOOT_CM));
    expect(x).toBeLessThan(0);
  });

  it("clamps the Y axis against the ceiling/floor bounds independently of X/Z", () => {
    const [, y] = softClampCameraPosition([250, 10000, 200], bounds);
    expect(y).toBeLessThan(260 + CAMERA_OVERSHOOT_CM);
    expect(y).toBeGreaterThan(260);
  });
});
