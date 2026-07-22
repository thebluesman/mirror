import { describe, expect, it } from "vitest";
import type { AABB } from "./collision";
import {
  computeWalkStep,
  deriveSyntheticLookAt,
  walkCameraFootprintAABB,
  walkStepCollides,
  type WalkInput,
} from "./walkCamera";

const NONE: WalkInput = { forward: false, back: false, left: false, right: false };

describe("computeWalkStep", () => {
  it("returns zero movement when no key is held", () => {
    expect(computeWalkStep(NONE, 150, 1 / 60)).toEqual({ forward: 0, right: 0 });
  });

  it("moves forward-only at full speed*delta when only W is held", () => {
    const step = computeWalkStep({ ...NONE, forward: true }, 150, 1);
    expect(step.forward).toBeCloseTo(150, 5);
    expect(step.right).toBeCloseTo(0, 5);
  });

  it("moves backward as negative forward when only S is held", () => {
    const step = computeWalkStep({ ...NONE, back: true }, 150, 1);
    expect(step.forward).toBeCloseTo(-150, 5);
    expect(step.right).toBeCloseTo(0, 5);
  });

  it("strafes right as positive right when only D is held", () => {
    const step = computeWalkStep({ ...NONE, right: true }, 150, 1);
    expect(step.forward).toBeCloseTo(0, 5);
    expect(step.right).toBeCloseTo(150, 5);
  });

  it("strafes left as negative right when only A is held", () => {
    const step = computeWalkStep({ ...NONE, left: true }, 150, 1);
    expect(step.forward).toBeCloseTo(0, 5);
    expect(step.right).toBeCloseTo(-150, 5);
  });

  it("cancels out opposite keys held together (W+S, A+D)", () => {
    expect(computeWalkStep({ forward: true, back: true, left: true, right: true }, 150, 1)).toEqual({
      forward: 0,
      right: 0,
    });
  });

  it("normalizes diagonal movement (W+D) to the same total speed as a single key", () => {
    const straight = computeWalkStep({ ...NONE, forward: true }, 150, 1);
    const diagonal = computeWalkStep({ ...NONE, forward: true, right: true }, 150, 1);
    const straightMag = Math.hypot(straight.forward, straight.right);
    const diagonalMag = Math.hypot(diagonal.forward, diagonal.right);
    expect(diagonalMag).toBeCloseTo(straightMag, 5);
    // Equal components split the speed evenly between the two axes.
    expect(diagonal.forward).toBeCloseTo(diagonal.right, 5);
  });

  it("scales linearly with elapsed time (frame-rate independence)", () => {
    const oneSecond = computeWalkStep({ ...NONE, forward: true }, 150, 1);
    const halfSecond = computeWalkStep({ ...NONE, forward: true }, 150, 0.5);
    expect(halfSecond.forward).toBeCloseTo(oneSecond.forward / 2, 5);
  });

  it("scales linearly with the speed constant", () => {
    const slow = computeWalkStep({ ...NONE, forward: true }, 100, 1);
    const fast = computeWalkStep({ ...NONE, forward: true }, 200, 1);
    expect(fast.forward).toBeCloseTo(slow.forward * 2, 5);
  });
});

describe("deriveSyntheticLookAt", () => {
  it("walks straight out from eye along the forward direction", () => {
    const lookAt = deriveSyntheticLookAt([0, 160, 0], [0, 0, -1], 200);
    expect(lookAt).toEqual([0, 160, -200]);
  });

  it("scales by distance", () => {
    const lookAt = deriveSyntheticLookAt([0, 0, 0], [1, 0, 0], 50);
    expect(lookAt).toEqual([50, 0, 0]);
  });

  it("offsets from a non-origin eye position", () => {
    const lookAt = deriveSyntheticLookAt([10, 20, 30], [0, 1, 0], 5);
    expect(lookAt).toEqual([10, 25, 30]);
  });

  it("is a no-op displacement when distance is zero", () => {
    const eye: [number, number, number] = [3, 4, 5];
    expect(deriveSyntheticLookAt(eye, [1, 0, 0], 0)).toEqual(eye);
  });
});

describe("walkCameraFootprintAABB", () => {
  it("centers a radius-sized square on the given XZ position", () => {
    expect(walkCameraFootprintAABB(100, -50, 30)).toEqual({
      minX: 70,
      maxX: 130,
      minZ: -80,
      maxZ: -20,
    });
  });
});

describe("walkStepCollides", () => {
  const wall: AABB = { minX: -5, maxX: 5, minZ: -500, maxZ: 500 };
  const item: AABB = { minX: 90, maxX: 110, minZ: 90, maxZ: 110 };

  it("is false in open space with no items or walls", () => {
    expect(walkStepCollides(0, 0, 30, [], [])).toBe(false);
  });

  it("is true when the eye footprint overlaps a wall AABB", () => {
    expect(walkStepCollides(0, 0, 30, [], [wall])).toBe(true);
  });

  it("is false when the eye footprint is clear of a nearby wall", () => {
    expect(walkStepCollides(100, 0, 30, [], [wall])).toBe(false);
  });

  it("is true when the eye footprint overlaps an item AABB", () => {
    expect(walkStepCollides(100, 100, 30, [item], [])).toBe(true);
  });

  it("is false when the eye footprint is clear of a nearby item", () => {
    expect(walkStepCollides(0, 0, 30, [item], [])).toBe(false);
  });

  it("grows with a larger radius, catching a collision a smaller radius would miss", () => {
    expect(walkStepCollides(120, 100, 5, [item], [])).toBe(false);
    expect(walkStepCollides(120, 100, 30, [item], [])).toBe(true);
  });
});
