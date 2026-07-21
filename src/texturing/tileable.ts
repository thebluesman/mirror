// Tileable-texture algorithm (Phase 3 reimplementation of
// spike/textures/make-tileable.mjs). The spike is built on sharp, a native
// Node image library that cannot run in a browser — this module reimplements
// the same algorithm as pure functions over plain RGBA pixel buffers
// (ImageData-shaped: {width, height, data: Uint8ClampedArray}), with zero
// DOM/Canvas/three.js dependency, so it runs and is unit-tested under Node
// (see tileable.test.ts) exactly like the spike's own synthetic-gradient
// self-test. The browser-only glue that gets a photo into/out of this shape
// (Canvas/OffscreenCanvas crop+resize, blob encode) lives in ./pipeline.ts.
//
// Algorithm (same three steps as make-tileable.mjs's header comment):
//   1. (caller's job — see pipeline.ts) center-crop to a square, resize to a
//      working size.
//   2. Quadrant-swap: offset the image by (size/2, size/2) with wraparound.
//      This is a circular roll — new(x, y) = old((x + w/2) % w, (y + h/2) % h)
//      — which is algebraically the same TL<->BR / TR<->BL diagonal swap the
//      spike does via four explicit quadrant extracts+composites, just
//      expressed as one pass. It makes the new left/right and top/bottom
//      EDGES match automatically (they become adjacent original pixels), at
//      the cost of moving the original seam to a cross through the CENTER.
//   3. Cross-fade the center seam: blend in a mirrored copy of the swapped
//      image (horizontally mirrored/"flopped" for the vertical seam,
//      vertically mirrored/"flipped" for the horizontal seam) inside a soft
//      smoothstep-falloff band around the center lines. Mirrored content is
//      continuous with itself at the fold, so this hides the hard jump
//      without any content-aware inpainting — same trick as the spike's
//      `bandMaskBuffer` + `blendWithMask`.

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes/pixel, row-major — same layout as ImageData.data. */
  data: Uint8ClampedArray;
}

export function makeRgbaImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function pixelIndex(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

/** Wraparound offset by (width/2, height/2) — the quadrant swap. Requires
 *  even width/height (guaranteed by pipeline.ts's fixed working size). */
export function quadrantSwap(img: RgbaImage): RgbaImage {
  const { width: w, height: h, data } = img;
  const halfW = Math.floor(w / 2);
  const halfH = Math.floor(h / 2);
  const out = makeRgbaImage(w, h);
  for (let y = 0; y < h; y++) {
    const sy = (y + halfH) % h;
    for (let x = 0; x < w; x++) {
      const sx = (x + halfW) % w;
      const si = pixelIndex(w, sx, sy);
      const di = pixelIndex(w, x, y);
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return out;
}

/** Horizontal mirror ("flop") — out(x, y) = in(w-1-x, y). */
export function mirrorHorizontal(img: RgbaImage): RgbaImage {
  const { width: w, height: h, data } = img;
  const out = makeRgbaImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = pixelIndex(w, w - 1 - x, y);
      const di = pixelIndex(w, x, y);
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return out;
}

/** Vertical mirror ("flip") — out(x, y) = in(x, h-1-y). */
export function mirrorVertical(img: RgbaImage): RgbaImage {
  const { width: w, height: h, data } = img;
  const out = makeRgbaImage(w, h);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const si = pixelIndex(w, x, sy);
      const di = pixelIndex(w, x, y);
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return out;
}

/** Smoothstep-falloff alpha band: 1.0 at `center`, fading to 0 by
 *  `center ± halfWidth`, varying along `axis` ('x' or 'y'), constant along
 *  the other axis. Mirrors the spike's `bandMaskBuffer`, minus the detour
 *  through an RGBA mask buffer + sharp composite — this returns alpha
 *  (0..1) directly for blendWithMask to consume. */
export function bandMaskAlpha(size: number, axis: "x" | "y", center: number, halfWidth: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coord = axis === "x" ? x : y;
      const d = Math.abs(coord - center);
      const t = Math.max(0, Math.min(1, 1 - d / halfWidth));
      out[y * size + x] = t * t * (3 - 2 * t); // smoothstep
    }
  }
  return out;
}

/** Alpha-composite `top` over `base`, per-pixel, using `alpha` (0..1,
 *  base.width*base.height entries, row-major). Output is fully opaque
 *  (alpha channel 255) — these are opaque photo textures, same as the
 *  spike's `.removeAlpha()` step. */
export function blendWithMask(base: RgbaImage, top: RgbaImage, alpha: Float32Array): RgbaImage {
  const { width: w, height: h } = base;
  const out = makeRgbaImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = pixelIndex(w, x, y);
      const a = alpha[y * w + x];
      out.data[i] = base.data[i] * (1 - a) + top.data[i] * a;
      out.data[i + 1] = base.data[i + 1] * (1 - a) + top.data[i + 1] * a;
      out.data[i + 2] = base.data[i + 2] * (1 - a) + top.data[i + 2] * a;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Full tileable pipeline over an already-square RGBA image: quadrant swap,
 * then cross-fade the vertical seam (mirrorH), then the horizontal seam
 * (mirrorV), matching make-tileable.mjs's `makeTileable` step order exactly.
 *
 * @param square a square RgbaImage (width === height)
 * @param blendPx half-width of the cross-fade band in pixels (spike default 96 @ 1024 working size)
 */
export function makeTileable(square: RgbaImage, blendPx = 96): RgbaImage {
  if (square.width !== square.height) {
    throw new Error("makeTileable: input must be square — crop/resize before calling (see pipeline.ts)");
  }
  const size = square.width;
  const swapped = quadrantSwap(square);

  const mirrorH = mirrorHorizontal(swapped);
  const maskV = bandMaskAlpha(size, "x", size / 2, blendPx);
  const afterVertical = blendWithMask(swapped, mirrorH, maskV);

  const mirrorV = mirrorVertical(afterVertical);
  const maskH = bandMaskAlpha(size, "y", size / 2, blendPx);
  const final = blendWithMask(afterVertical, mirrorV, maskH);

  return final;
}
