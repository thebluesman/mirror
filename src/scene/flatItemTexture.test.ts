import { describe, it, expect } from "vitest";
import { computeCoverUV, flatTextureBoxDims } from "./flatItemTexture";

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
