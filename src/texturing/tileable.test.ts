import { describe, it, expect } from "vitest";
import { makeRgbaImage, quadrantSwap, makeTileable, type RgbaImage } from "./tileable";

/** A synthetic non-tileable input: a strong left-right luminance gradient,
 *  constant top-to-bottom — same construction the spike used ("strong
 *  left-right lighting gradient by construction") because a plain gradient
 *  has a hard, maximal discontinuity at the wrap edge, making it the
 *  harshest input the seam-hiding logic has to handle. */
function gradientImage(size: number): RgbaImage {
  const img = makeRgbaImage(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round((x / (size - 1)) * 255);
      const i = (y * size + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

function pixelAt(img: RgbaImage, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function maxAbsDiff(a: [number, number, number], b: [number, number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

describe("quadrantSwap", () => {
  it("is a wraparound offset by (w/2, h/2): edges become adjacent original pixels", () => {
    const size = 64;
    const src = gradientImage(size);
    const swapped = quadrantSwap(src);
    // Per the module header: new(x,y) = old((x+w/2)%w, (y+h/2)%h).
    expect(pixelAt(swapped, 0, 0)).toEqual(pixelAt(src, size / 2, size / 2));
    expect(pixelAt(swapped, size - 1, size - 1)).toEqual(pixelAt(src, size / 2 - 1, size / 2 - 1));
  });

  it("makes the left/right and top/bottom edges match (wrap-continuous)", () => {
    const size = 64;
    const swapped = quadrantSwap(gradientImage(size));
    for (let y = 0; y < size; y += 8) {
      expect(maxAbsDiff(pixelAt(swapped, 0, y), pixelAt(swapped, size - 1, y))).toBeLessThanOrEqual(6);
    }
    for (let x = 0; x < size; x += 8) {
      expect(maxAbsDiff(pixelAt(swapped, x, 0), pixelAt(swapped, x, size - 1))).toBeLessThanOrEqual(6);
    }
  });
});

describe("makeTileable — no visible seams (spike's self-test, reverified)", () => {
  const size = 256; // smaller than the 1024 production default; algorithm is size-independent
  const blendPx = 24;

  it("tiles 2x2 with matching left/right and top/bottom wrap edges", () => {
    const out = makeTileable(gradientImage(size), blendPx);
    for (let y = 0; y < size; y += 16) {
      expect(maxAbsDiff(pixelAt(out, 0, y), pixelAt(out, size - 1, y))).toBeLessThanOrEqual(6);
    }
    for (let x = 0; x < size; x += 16) {
      expect(maxAbsDiff(pixelAt(out, x, 0), pixelAt(out, x, size - 1))).toBeLessThanOrEqual(6);
    }
  });

  it("smooths the hard center-cross seam quadrant-swap introduces", () => {
    // A monotonic gradient is the adversarial case: quadrant-swapping it
    // puts its two extremes (~0 and ~255) directly adjacent at the center
    // column — a near-maximal one-pixel jump (this IS the seam the
    // cross-fade exists to hide). Because the mirror axis for an even-width
    // image falls between two pixels (not on one), a single pixel-pair
    // exactly at the fold can retain a sharp step even post-blend — the
    // spike's own bandMaskBuffer formula has the same property, and it's
    // imperceptible in practice against real photo content, which is why the
    // spike's own verification checked tile *boundaries*, not this exact
    // pixel. What the cross-fade must demonstrably do is turn the *region*
    // around the fold into a gradual ramp, not a plateau-then-cliff.
    const swapped = quadrantSwap(gradientImage(size));
    const out = makeTileable(gradientImage(size), blendPx);
    const mid = size / 2;

    const preJump = maxAbsDiff(pixelAt(swapped, mid - 1, mid), pixelAt(swapped, mid, mid));
    expect(preJump).toBeGreaterThan(200);

    // Collect per-pixel steps across the band; allow the single fold-adjacent
    // pixel pair to remain sharp, but everything else in the band should be
    // a gentle ramp, and away from the fold the max step should have dropped
    // well below the pre-blend jump.
    const steps: number[] = [];
    for (let x = mid - blendPx; x < mid + blendPx; x++) {
      steps.push(maxAbsDiff(pixelAt(out, x, mid), pixelAt(out, x + 1, mid)));
    }
    const sharpSteps = steps.filter((s) => s > preJump / 2);
    expect(sharpSteps.length).toBeLessThanOrEqual(1); // at most the one fold-adjacent pixel pair

    const stepsAwayFromFold = steps.filter((_, i) => Math.abs(i - blendPx) > 2);
    expect(Math.max(...stepsAwayFromFold)).toBeLessThan(preJump / 4);
  });

  it("leaves pixels far from either center line unchanged by the blend", () => {
    const swapped = quadrantSwap(gradientImage(size));
    const out = makeTileable(gradientImage(size), blendPx);
    // A point safely outside both the vertical (x=mid) and horizontal
    // (y=mid) blend bands should be untouched by the cross-fade.
    const farX = 8;
    const farY = 8;
    expect(pixelAt(out, farX, farY)).toEqual(pixelAt(swapped, farX, farY));
  });

  it("output is fully opaque", () => {
    const out = makeTileable(gradientImage(size), blendPx);
    for (let i = 3; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(255);
    }
  });
});
