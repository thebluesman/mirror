import { describe, it, expect } from "vitest";
import { computeCoverUV, flatTextureBoxDims, needsOrientationRotation } from "./flatItemTexture";

describe("computeCoverUV", () => {
  it("is a no-op (full repeat, zero offset) when image and target aspect match", () => {
    const { repeat, offset } = computeCoverUV(1.41, 1.41);
    expect(repeat).toEqual([1, 1]);
    expect(offset).toEqual([0, 0]);
  });

  it("crops the width (keeps full height) when the image is relatively wider than the target", () => {
    // image 2:1, target 1:1 -> image wider than target
    const { repeat, offset } = computeCoverUV(2, 1);
    expect(repeat[1]).toBe(1); // full height used
    expect(repeat[0]).toBeCloseTo(0.5); // half the width used
    expect(offset[1]).toBe(0);
    expect(offset[0]).toBeCloseTo(0.25); // centered: (1 - 0.5) / 2
  });

  it("crops the height (keeps full width) when the image is relatively taller than the target", () => {
    // image 1:1 (square photo), target 240:170 (~1.41 — a rug wider than tall)
    const targetAspect = 240 / 170;
    const { repeat, offset } = computeCoverUV(1, targetAspect);
    expect(repeat[0]).toBe(1); // full width used
    expect(repeat[1]).toBeCloseTo(1 / targetAspect);
    expect(offset[0]).toBe(0);
    expect(offset[1]).toBeCloseTo((1 - 1 / targetAspect) / 2);
  });

  it("centers the crop: offset + repeat stays symmetric around 0.5 on the cropped axis", () => {
    const { repeat, offset } = computeCoverUV(3, 1);
    expect(offset[0] + repeat[0] / 2).toBeCloseTo(0.5);
  });

  it("the SONDEROD rug's actual case: 1400x1400 square photo onto a 240x170 footprint", () => {
    const imageAspect = 1400 / 1400; // 1
    const targetAspect = 240 / 170; // ~1.41, wider than tall
    const { repeat, offset } = computeCoverUV(imageAspect, targetAspect);
    // Square photo is "taller" relative to the wide rug footprint, so the
    // full width is used and the height gets cropped (top/bottom trimmed).
    expect(repeat[0]).toBe(1);
    expect(repeat[1]).toBeLessThan(1);
    expect(offset[0]).toBe(0);
    expect(offset[1]).toBeGreaterThan(0);
  });

  it("throws on a non-positive or non-finite aspect ratio", () => {
    expect(() => computeCoverUV(0, 1)).toThrow();
    expect(() => computeCoverUV(1, 0)).toThrow();
    expect(() => computeCoverUV(-1, 1)).toThrow();
    expect(() => computeCoverUV(NaN, 1)).toThrow();
    expect(() => computeCoverUV(1, Infinity)).toThrow();
  });
});

describe("flatTextureBoxDims", () => {
  it("restates dimsCm as a named width/height/depth triple", () => {
    expect(flatTextureBoxDims({ w: 240, d: 170, h: 2 })).toEqual({ width: 240, height: 2, depth: 170 });
  });
});

describe("needsOrientationRotation", () => {
  // D4 bug (spike-v2/OUTCOME.md's D4 addendum): the SONDEROD rug's footprint
  // is landscape (w=240 > d=170, targetAspect ~1.41) but the photo Shyam
  // supplied was shot portrait — its actual rug content (ignoring the white
  // padding the raw 1400x1400 canvas was letterboxed onto) runs taller than
  // wide, aspect ~0.72. A straight cover-fit put the pattern on the wrong
  // world axis; this is the check that catches it before that fit runs.
  it("flags a portrait photo onto a landscape target (the SONDEROD case)", () => {
    const imageAspect = 968 / 1343; // real rug photo's content bbox, trimmed of padding
    const targetAspect = 240 / 170; // SONDEROD footprint, w > d
    expect(needsOrientationRotation(imageAspect, targetAspect)).toBe(true);
  });

  it("flags the reverse: a landscape photo onto a portrait target", () => {
    const imageAspect = 1343 / 968; // same photo, hypothetically shot the other way
    const targetAspect = 170 / 240; // same rug, hypothetically footprint-rotated 90deg
    expect(needsOrientationRotation(imageAspect, targetAspect)).toBe(true);
  });

  it("does not flag when photo and target agree on orientation", () => {
    expect(needsOrientationRotation(1.41, 1.2)).toBe(false); // both landscape
    expect(needsOrientationRotation(0.8, 0.6)).toBe(false); // both portrait
  });

  it("does not flag an exactly-square photo either way (ambiguous by aspect alone)", () => {
    expect(needsOrientationRotation(1, 1.41)).toBe(false);
    expect(needsOrientationRotation(1, 0.7)).toBe(false);
  });

  it("throws on a non-positive or non-finite aspect ratio", () => {
    expect(() => needsOrientationRotation(0, 1)).toThrow();
    expect(() => needsOrientationRotation(1, 0)).toThrow();
    expect(() => needsOrientationRotation(-1, 1)).toThrow();
    expect(() => needsOrientationRotation(NaN, 1)).toThrow();
    expect(() => needsOrientationRotation(1, Infinity)).toThrow();
  });
});
