import { describe, expect, it } from "vitest";
import { computeMinimapProjection, normalizeXZ, worldToMinimapPx } from "./minimapProjection";

describe("computeMinimapProjection", () => {
  const squareBounds = { minX: 0, maxX: 400, minZ: 0, maxZ: 400, minY: -20, maxY: 260 };

  it("scales a square room to fill a square canvas minus padding", () => {
    const projection = computeMinimapProjection(squareBounds, 160, 160, 10);
    // 140px available on each axis for a 400cm room -> 0.35 px/cm.
    expect(projection.scale).toBeCloseTo(0.35);
  });

  it("preserves aspect ratio for a non-square room (uses the more constraining axis)", () => {
    const wideBounds = { minX: 0, maxX: 800, minZ: 0, maxZ: 400, minY: -20, maxY: 260 };
    const projection = computeMinimapProjection(wideBounds, 160, 160, 10);
    // Width is the constraining axis: 140px / 800cm = 0.175 px/cm, not the
    // 0.35 px/cm the depth axis alone would allow.
    expect(projection.scale).toBeCloseTo(0.175);
  });

  it("centers the room's min corner with padding applied", () => {
    const projection = computeMinimapProjection(squareBounds, 160, 160, 10);
    const [x, y] = worldToMinimapPx(0, 0, projection);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(10);
  });

  it("maps the room's max corner to the opposite padded edge", () => {
    const projection = computeMinimapProjection(squareBounds, 160, 160, 10);
    const [x, y] = worldToMinimapPx(400, 400, projection);
    expect(x).toBeCloseTo(150);
    expect(y).toBeCloseTo(150);
  });

  it("centers a non-square room's leftover space on the shorter axis", () => {
    const wideBounds = { minX: 0, maxX: 800, minZ: 0, maxZ: 200, minY: -20, maxY: 260 };
    const projection = computeMinimapProjection(wideBounds, 160, 160, 10);
    // Depth (200cm) projects to 200 * scale; the leftover vertical space
    // should be split evenly above/below rather than pinned to one edge.
    const [, yMin] = worldToMinimapPx(0, 0, projection);
    const [, yMax] = worldToMinimapPx(0, 200, projection);
    const topGap = yMin;
    const bottomGap = 160 - yMax;
    expect(topGap).toBeCloseTo(bottomGap);
  });

  it("degenerates to a centered scale=1 projection for a zero-sized room", () => {
    const zeroBounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, minY: -20, maxY: 260 };
    const projection = computeMinimapProjection(zeroBounds, 160, 160, 10);
    expect(projection).toEqual({ scale: 1, offsetXPx: 80, offsetYPx: 80 });
  });
});

describe("worldToMinimapPx", () => {
  it("applies scale and offset linearly", () => {
    const projection = { scale: 2, offsetXPx: 5, offsetYPx: -3 };
    expect(worldToMinimapPx(10, 20, projection)).toEqual([25, 37]);
  });
});

describe("normalizeXZ", () => {
  it("normalizes a non-unit vector to length 1", () => {
    const [dx, dz] = normalizeXZ(3, 4);
    expect(Math.hypot(dx, dz)).toBeCloseTo(1);
    expect(dx).toBeCloseTo(0.6);
    expect(dz).toBeCloseTo(0.8);
  });

  it("passes an already-unit vector through unchanged", () => {
    expect(normalizeXZ(0, -1)).toEqual([0, -1]);
    expect(normalizeXZ(1, 0)).toEqual([1, 0]);
  });

  it("falls back to a fixed default direction for a near-zero vector", () => {
    expect(normalizeXZ(0, 0)).toEqual([0, -1]);
    expect(normalizeXZ(1e-9, -1e-9)).toEqual([0, -1]);
  });
});
