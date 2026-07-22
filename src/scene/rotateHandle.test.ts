import { describe, expect, it } from "vitest";
import { relativeYawDeg, rotateHandleWorldXZ, snapYawDeg, yawDegFromPointer } from "./rotateHandle";

describe("yawDegFromPointer", () => {
  it("returns 0 when the pointer is straight ahead on +Z (the handle's rest direction)", () => {
    expect(yawDegFromPointer(0, 0, 0, 10)).toBeCloseTo(0, 5);
  });

  it("returns 90 when the pointer is on +X", () => {
    expect(yawDegFromPointer(0, 0, 10, 0)).toBeCloseTo(90, 5);
  });

  it("returns 180 when the pointer is on -Z", () => {
    expect(yawDegFromPointer(0, 0, 0, -10)).toBeCloseTo(180, 5);
  });

  it("returns 270 when the pointer is on -X", () => {
    expect(yawDegFromPointer(0, 0, -10, 0)).toBeCloseTo(270, 5);
  });

  it("is independent of the pointer's distance from center — only direction matters", () => {
    expect(yawDegFromPointer(0, 0, 1, 1)).toBeCloseTo(yawDegFromPointer(0, 0, 50, 50), 5);
  });

  it("is normalized to [0, 360) and works from a non-origin center", () => {
    const yaw = yawDegFromPointer(100, 200, 100, 190); // pointer due -Z of center
    expect(yaw).toBeCloseTo(180, 5);
    expect(yaw).toBeGreaterThanOrEqual(0);
    expect(yaw).toBeLessThan(360);
  });
});

describe("rotateHandleWorldXZ", () => {
  it("sits at +Z offset from center when yaw is 0", () => {
    const [x, z] = rotateHandleWorldXZ(0, 0, 0, 40);
    expect(x).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(40, 5);
  });

  it("sits at +X offset from center when yaw is 90", () => {
    const [x, z] = rotateHandleWorldXZ(0, 0, 90, 40);
    expect(x).toBeCloseTo(40, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it("round-trips through yawDegFromPointer for an arbitrary yaw/center/offset", () => {
    const center: [number, number] = [37, -12];
    const yawDeg = 217;
    const offset = 55;
    const [hx, hz] = rotateHandleWorldXZ(center[0], center[1], yawDeg, offset);
    const recovered = yawDegFromPointer(center[0], center[1], hx, hz);
    expect(recovered).toBeCloseTo(yawDeg, 5);
  });
});

describe("snapYawDeg", () => {
  it("rounds to the nearest 15deg step", () => {
    expect(snapYawDeg(8, 15)).toBe(15);
    expect(snapYawDeg(7.4, 15)).toBe(0);
    expect(snapYawDeg(52, 15)).toBe(45);
    expect(snapYawDeg(53, 15)).toBe(60);
  });

  it("normalizes the wrap at 360 back to 0", () => {
    expect(snapYawDeg(358, 15)).toBe(0); // rounds to 360 -> 0
  });

  it("handles negative yaw by normalizing into [0, 360)", () => {
    expect(snapYawDeg(-15, 15)).toBe(345);
    expect(snapYawDeg(-7, 15)).toBe(0); // rounds to -0/0
  });
});

describe("relativeYawDeg", () => {
  it("leaves yaw unchanged when the pointer hasn't swept from the grab point", () => {
    expect(relativeYawDeg(90, 30, 30)).toBeCloseTo(90, 5);
  });

  it("adds the pointer's sweep to the yaw at grab time", () => {
    // Grabbed at 30deg-around-center, dragged to 75deg: a +45deg sweep.
    expect(relativeYawDeg(90, 30, 75)).toBeCloseTo(135, 5);
  });

  it("applies a negative sweep (dragging the other way)", () => {
    expect(relativeYawDeg(90, 30, 10)).toBeCloseTo(70, 5);
  });

  it("normalizes a result that wraps past 360 back into [0, 360)", () => {
    const yaw = relativeYawDeg(350, 0, 40); // 390 -> 30
    expect(yaw).toBeCloseTo(30, 5);
    expect(yaw).toBeGreaterThanOrEqual(0);
    expect(yaw).toBeLessThan(360);
  });

  it("normalizes a result that wraps below 0 back into [0, 360)", () => {
    expect(relativeYawDeg(10, 0, -40)).toBeCloseTo(330, 5); // -30 -> 330
  });

  it("is grab-point-agnostic: grabbing anywhere and not moving is a no-op", () => {
    // Whatever angle the ring was grabbed at, a zero-sweep drag returns the
    // starting yaw — this is the property that kills the old sphere handle's
    // grab-anywhere jump.
    expect(relativeYawDeg(217, 12, 12)).toBeCloseTo(217, 5);
    expect(relativeYawDeg(217, 200, 200)).toBeCloseTo(217, 5);
  });
});
