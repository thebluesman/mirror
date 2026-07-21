import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  computeCoverUV,
  computeFlatTextureFit,
  flatTextureBoxDims,
  FULL_CONTENT_BOX,
  needsOrientationRotation,
  type ContentBox,
  type FlatTextureFit,
} from "./flatItemTexture";

// Applies a computeFlatTextureFit result to a REAL THREE.Texture (matching
// buildScene/Viewport's actual usage: texture.repeat/offset/rotation set,
// texture.center left at THREE.Texture's default (0, 0)) and multiplies a
// geometry UV through texture.matrix, exactly the way three's renderer
// samples the bitmap. This is the same numerical check the D4 crop-fix used
// to verify the UV composition against a real Texture rather than by hand —
// see spike-v2/OUTCOME.md's D4 crop-fix addendum.
function sampleUV(fit: FlatTextureFit, uv: [number, number]): [number, number] {
  const texture = new THREE.Texture();
  texture.repeat.set(fit.repeat[0], fit.repeat[1]);
  texture.offset.set(fit.offset[0], fit.offset[1]);
  texture.rotation = fit.rotation;
  texture.updateMatrix();
  const vec = new THREE.Vector3(uv[0], uv[1], 1).applyMatrix3(texture.matrix);
  return [vec.x, vec.y];
}

// A geometry UV's four corners plus center — the plane's corners are what
// must land inside the content box's texture-space sub-rectangle for the
// padding to actually be cropped out.
const UNIT_SQUARE_SAMPLE_POINTS: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [0.5, 0.5],
];

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

describe("computeFlatTextureFit", () => {
  // D4 crop-fix (spike-v2/OUTCOME.md's D4 crop-fix addendum): round 2 fixed
  // the SONDEROD rug's orientation but only used its content bounding box to
  // *decide* whether to rotate, discarding the box's own coordinates — the
  // white product-photo padding stayed visible in the render. This function
  // folds crop + rotate + cover-fit into one repeat/offset/rotation; these
  // tests check the fold against a real THREE.Texture's matrix, not by hand.

  it("full content box + no rotation needed reduces to a plain computeCoverUV crop", () => {
    // Non-square, no-padding photo (content == whole bitmap) shot in the
    // same orientation class as the target: rotation should stay 0, and the
    // crop should exactly match computeCoverUV's un-nested result (content
    // box == whole bitmap, so nesting is an identity operation).
    const rawImageAspect = 1.2; // landscape photo, content fills entire frame
    const targetAspect = 240 / 170; // landscape footprint
    const fit = computeFlatTextureFit(FULL_CONTENT_BOX, rawImageAspect, targetAspect);
    const expected = computeCoverUV(rawImageAspect, targetAspect);
    expect(fit.rotation).toBe(0);
    expect(fit.repeat[0]).toBeCloseTo(expected.repeat[0]);
    expect(fit.repeat[1]).toBeCloseTo(expected.repeat[1]);
    expect(fit.offset[0]).toBeCloseTo(expected.offset[0]);
    expect(fit.offset[1]).toBeCloseTo(expected.offset[1]);
  });

  it("full content box + rotation needed reproduces the round-2 rotate formula (no regression)", () => {
    // Round 2's formula (validated correct by Shyam): texture.rotation =
    // +90deg about center (0.5, 0.5), repeat/offset = computeCoverUV fed the
    // RECIPROCAL raw aspect. Verify the new, crop-capable function's output
    // samples identically when there's no actual crop (full box) — i.e. the
    // crop-composition didn't silently change the already-correct rotation.
    const rawImageAspect = 0.5; // portrait photo, content fills entire frame
    const targetAspect = 240 / 170; // landscape footprint -> needs rotation

    const oldTexture = new THREE.Texture();
    const oldCover = computeCoverUV(1 / rawImageAspect, targetAspect);
    oldTexture.repeat.set(oldCover.repeat[0], oldCover.repeat[1]);
    oldTexture.offset.set(oldCover.offset[0], oldCover.offset[1]);
    oldTexture.rotation = Math.PI / 2;
    oldTexture.center.set(0.5, 0.5);
    oldTexture.updateMatrix();

    const fit = computeFlatTextureFit(FULL_CONTENT_BOX, rawImageAspect, targetAspect);
    expect(fit.rotation).toBe(Math.PI / 2);

    for (const uv of UNIT_SQUARE_SAMPLE_POINTS) {
      const oldVec = new THREE.Vector3(uv[0], uv[1], 1).applyMatrix3(oldTexture.matrix);
      const [newU, newV] = sampleUV(fit, uv);
      expect(newU).toBeCloseTo(oldVec.x, 5);
      expect(newV).toBeCloseTo(oldVec.y, 5);
    }
  });

  it("crops a padded photo: every sampled UV lands inside the content box (rotation case)", () => {
    // The actual SONDEROD-shaped scenario: a square, padded canvas whose
    // real rug photo occupies a portrait sub-box, rendered onto a landscape
    // footprint. Every corner of the target plane must sample from inside
    // the content box (in texture V-space, V=0 bottom) — landing outside it
    // means padding (or worse, nothing) is what actually renders.
    const rawImageAspect = 1; // square padded canvas
    const targetAspect = 240 / 170; // landscape footprint
    const contentBox: ContentBox = {
      minXFrac: 400 / 1400,
      maxXFrac: 1000 / 1400,
      minYFrac: 100 / 1400,
      maxYFrac: 1300 / 1400,
    };
    const fit = computeFlatTextureFit(contentBox, rawImageAspect, targetAspect);
    expect(fit.rotation).toBe(Math.PI / 2); // portrait content onto landscape target

    const boxMinU = contentBox.minXFrac;
    const boxMaxU = contentBox.maxXFrac;
    const boxMinV = 1 - contentBox.maxYFrac; // pixel-space Y=0-top -> texture V=0-bottom
    const boxMaxV = 1 - contentBox.minYFrac;

    for (const uv of UNIT_SQUARE_SAMPLE_POINTS) {
      const [u, v] = sampleUV(fit, uv);
      expect(u).toBeGreaterThanOrEqual(boxMinU - 1e-9);
      expect(u).toBeLessThanOrEqual(boxMaxU + 1e-9);
      expect(v).toBeGreaterThanOrEqual(boxMinV - 1e-9);
      expect(v).toBeLessThanOrEqual(boxMaxV + 1e-9);
    }
  });

  it("crops a padded photo: every sampled UV lands inside the content box (no-rotation case)", () => {
    // Same padding scenario, but the content's own orientation already
    // agrees with the target (landscape content in a square pad, landscape
    // target) so no rotation is needed -- the crop-only path.
    const rawImageAspect = 1; // square padded canvas
    const targetAspect = 240 / 170; // landscape footprint
    const contentBox: ContentBox = {
      minXFrac: 100 / 1400,
      maxXFrac: 1300 / 1400,
      minYFrac: 400 / 1400,
      maxYFrac: 1000 / 1400,
    };
    const fit = computeFlatTextureFit(contentBox, rawImageAspect, targetAspect);
    expect(fit.rotation).toBe(0);

    const boxMinU = contentBox.minXFrac;
    const boxMaxU = contentBox.maxXFrac;
    const boxMinV = 1 - contentBox.maxYFrac;
    const boxMaxV = 1 - contentBox.minYFrac;

    for (const uv of UNIT_SQUARE_SAMPLE_POINTS) {
      const [u, v] = sampleUV(fit, uv);
      expect(u).toBeGreaterThanOrEqual(boxMinU - 1e-9);
      expect(u).toBeLessThanOrEqual(boxMaxU + 1e-9);
      expect(v).toBeGreaterThanOrEqual(boxMinV - 1e-9);
      expect(v).toBeLessThanOrEqual(boxMaxV + 1e-9);
    }
  });

  it("throws on a malformed content box (max <= min, or out of [0, 1])", () => {
    expect(() => computeFlatTextureFit({ minXFrac: 0.5, maxXFrac: 0.5, minYFrac: 0, maxYFrac: 1 }, 1, 1)).toThrow();
    expect(() => computeFlatTextureFit({ minXFrac: 0.6, maxXFrac: 0.4, minYFrac: 0, maxYFrac: 1 }, 1, 1)).toThrow();
    expect(() => computeFlatTextureFit({ minXFrac: -0.1, maxXFrac: 1, minYFrac: 0, maxYFrac: 1 }, 1, 1)).toThrow();
    expect(() => computeFlatTextureFit({ minXFrac: 0, maxXFrac: 1.1, minYFrac: 0, maxYFrac: 1 }, 1, 1)).toThrow();
  });

  it("throws on a non-positive or non-finite rawImageAspect", () => {
    expect(() => computeFlatTextureFit(FULL_CONTENT_BOX, 0, 1)).toThrow();
    expect(() => computeFlatTextureFit(FULL_CONTENT_BOX, -1, 1)).toThrow();
    expect(() => computeFlatTextureFit(FULL_CONTENT_BOX, NaN, 1)).toThrow();
  });
});
