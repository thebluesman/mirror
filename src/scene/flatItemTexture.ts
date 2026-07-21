// v2 spike D4 (W-B, rug fix ladder lever 2 — see spike-v2/OUTCOME.md and
// v2-spike-plan.md §2's W-B bar): pure math for mapping a photo 1:1 onto a
// flat furniture item's real footprint, instead of tiling it the way
// src/texturing/tileable.ts does for shell surfaces (floor/wall/ceiling,
// which repeat over an arbitrary room size). A rug photo sized to the rug's
// own `dimsCm` doesn't need to tile — it needs to *cover* the footprint's
// aspect ratio without stretching, the same "background-size: cover" idea
// CSS uses for a photo of a different aspect ratio than its box.
//
// Framework-free (no THREE/Canvas/DOM dependency) so it's unit-testable
// under vitest's node environment exactly like tileable.ts — the THREE-side
// glue (applying the result to a THREE.Texture's repeat/offset) lives in
// Viewport.tsx, which isn't unit-tested for the same reason shellMaterials.ts
// isn't (three.js/WebGL-shaped, no meaningful behavior to assert without a
// renderer).

export interface CoverUV {
  repeat: [number, number];
  offset: [number, number];
}

/**
 * Computes THREE.Texture repeat/offset for a "cover" fit: the photo fills
 * the entire target footprint with no letterboxing, centered, cropping
 * whichever axis the photo has "extra" of relative to the target's aspect
 * ratio. Mirrors CSS `background-size: cover; background-position: center`.
 *
 * `imageAspect`/`targetAspect` are both width/height (or width/depth, for a
 * footprint) ratios. Both must be finite and positive.
 */
export function computeCoverUV(imageAspect: number, targetAspect: number): CoverUV {
  if (!(imageAspect > 0) || !Number.isFinite(imageAspect)) {
    throw new Error(`computeCoverUV: imageAspect must be a positive finite number, got ${imageAspect}`);
  }
  if (!(targetAspect > 0) || !Number.isFinite(targetAspect)) {
    throw new Error(`computeCoverUV: targetAspect must be a positive finite number, got ${targetAspect}`);
  }

  if (imageAspect >= targetAspect) {
    // Image is relatively wider than the target: use the full height, crop
    // the width down to match the target's aspect ratio.
    const repeatU = targetAspect / imageAspect;
    return { repeat: [repeatU, 1], offset: [(1 - repeatU) / 2, 0] };
  }
  // Image is relatively taller than the target: use the full width, crop
  // the height down to match.
  const repeatV = imageAspect / targetAspect;
  return { repeat: [1, repeatV], offset: [0, (1 - repeatV) / 2] };
}

/**
 * Decides whether a photo needs a 90° rotation before `computeCoverUV` runs.
 *
 * `computeCoverUV` assumes the image's own horizontal axis already lines up
 * with the target footprint's "width" axis and its vertical axis with the
 * "depth" axis — it has no way to know whether the *source photo* was shot
 * in the same landscape/portrait orientation as the item's real-world
 * footprint. When they disagree (one is wider-than-tall, the other
 * taller-than-wide), a straight cover-fit puts the photo's pattern on the
 * wrong world axis: e.g. a photo shot portrait (rug's long edge running
 * vertically in-frame) cover-fit directly onto a landscape footprint ends up
 * mapping the photo's short axis onto the footprint's long axis instead of
 * the other way around. Found via the SONDEROD rug fix (spike-v2/OUTCOME.md
 * D4 addendum): its footprint is landscape (w=240 > d=170) but the photo was
 * shot portrait.
 *
 * Both `imageAspect` and `targetAspect` are width/height (or width/depth)
 * ratios, same convention as `computeCoverUV`. An exactly-square input
 * (`aspect === 1`) is neither landscape nor portrait, so it never triggers a
 * rotation here — callers that can detect a square-but-padded source photo
 * (e.g. a product photo padded to a square canvas) should feed in the
 * *content* aspect ratio (ignoring background padding), not the raw
 * bitmap's, so the orientation check isn't fooled by that padding.
 */
export function needsOrientationRotation(imageAspect: number, targetAspect: number): boolean {
  if (!(imageAspect > 0) || !Number.isFinite(imageAspect)) {
    throw new Error(`needsOrientationRotation: imageAspect must be a positive finite number, got ${imageAspect}`);
  }
  if (!(targetAspect > 0) || !Number.isFinite(targetAspect)) {
    throw new Error(`needsOrientationRotation: targetAspect must be a positive finite number, got ${targetAspect}`);
  }
  if (imageAspect === 1) return false; // exactly square: neither landscape nor portrait
  return (imageAspect < 1) !== (targetAspect < 1);
}

/**
 * A photo's content bounding box, as fractions (0-1) of the *bitmap's own*
 * width/height, in image/DOM pixel-space convention: `minYFrac`/`maxYFrac`
 * are measured from the *top* edge down (Y=0 top, Y=1 bottom) — the same
 * convention `canvas.getImageData` and `ImageBitmap` pixel rows use. This is
 * deliberately NOT texture UV space (where V=0 is the bottom, see
 * `computeFlatTextureFit`'s doc) — keeping the box in pixel-space matches
 * how a DOM canvas-sampling bounding-box search naturally produces it, and
 * the V-flip is applied once, explicitly, inside `computeFlatTextureFit`.
 */
export interface ContentBox {
  minXFrac: number;
  maxXFrac: number;
  minYFrac: number;
  maxYFrac: number;
}

/** The whole-bitmap box — used as the safe fallback when content-bounding-box
 *  detection can't find any non-background pixels (a detection miss should
 *  degrade to "treat the whole photo as content," not throw or crop to
 *  nothing). */
export const FULL_CONTENT_BOX: ContentBox = { minXFrac: 0, maxXFrac: 1, minYFrac: 0, maxYFrac: 1 };

export interface FlatTextureFit {
  repeat: [number, number];
  offset: [number, number];
  /** Radians, always exactly `0` or `Math.PI / 2`. This scheme always pairs
   *  with `texture.center` left at THREE.Texture's default `(0, 0)` — the
   *  rotation pivot is folded into `offset` instead, so callers don't need
   *  to touch `texture.center` at all. */
  rotation: number;
}

function assertUnitFrac(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`computeFlatTextureFit: ${label} must be a finite number in [0, 1], got ${value}`);
  }
}

/**
 * Composes THREE.Texture repeat/offset/rotation for a photo that needs
 * BOTH (a) cropping out padding around its real content (per `ContentBox`)
 * and (b) the existing rotate + cover-fit treatment (`needsOrientationRotation`
 * / `computeCoverUV`), applied *as if the content box were the whole photo*.
 *
 * Order of operations (logical, not literal steps applied one after
 * another — this function folds all three into a single affine transform,
 * verified numerically against a real `THREE.Texture` — see
 * `spike-v2/d4-rug-drive.mjs`/OUTCOME.md's D4 crop-fix addendum for how):
 *   1. Crop to `contentBox` — restrict sampling to the photo's real content,
 *      discarding padding.
 *   2. Rotate 90° if `contentBox`'s own aspect ratio disagrees with
 *      `targetAspect`'s orientation class (landscape vs. portrait) — same
 *      trigger as `needsOrientationRotation`, just fed the *content* box's
 *      aspect instead of the raw, possibly-padded bitmap's.
 *   3. Cover-fit crop for aspect ratio within the now-cropped,
 *      possibly-rotated content, so the photo fills the target footprint
 *      edge-to-edge with no stretching (same `computeCoverUV` idea, applied
 *      to the content sub-rectangle instead of the whole bitmap).
 *
 * `rawImageAspect` is the *raw, uncropped* bitmap's width/height ratio (used
 * to convert `contentBox`'s width/height *fractions* into an actual aspect
 * ratio, since fractions alone don't carry the bitmap's own aspect).
 * `targetAspect` is the item footprint's width/depth ratio, same convention
 * as `computeCoverUV`/`needsOrientationRotation`.
 *
 * **V-axis flip, the one easy-to-get-backwards part:** `contentBox` is in
 * image/DOM pixel-space (Y=0 top). A `THREE.Texture`'s UV space has V=0 at
 * the *bottom* of the image (`flipY = true` is the THREE.Texture default),
 * so a pixel-space Y-range `[minYFrac, maxYFrac]` becomes texture V-range
 * `[1 - maxYFrac, 1 - minYFrac]` — swapped AND complemented, not a direct
 * copy. Get this backwards and the crop still "works" geometrically (same
 * box size) but samples the wrong vertical strip of the photo.
 */
export function computeFlatTextureFit(
  contentBox: ContentBox,
  rawImageAspect: number,
  targetAspect: number,
): FlatTextureFit {
  assertUnitFrac(contentBox.minXFrac, "contentBox.minXFrac");
  assertUnitFrac(contentBox.maxXFrac, "contentBox.maxXFrac");
  assertUnitFrac(contentBox.minYFrac, "contentBox.minYFrac");
  assertUnitFrac(contentBox.maxYFrac, "contentBox.maxYFrac");
  if (contentBox.maxXFrac <= contentBox.minXFrac) {
    throw new Error(`computeFlatTextureFit: contentBox.maxXFrac must be > minXFrac, got ${JSON.stringify(contentBox)}`);
  }
  if (contentBox.maxYFrac <= contentBox.minYFrac) {
    throw new Error(`computeFlatTextureFit: contentBox.maxYFrac must be > minYFrac, got ${JSON.stringify(contentBox)}`);
  }
  if (!(rawImageAspect > 0) || !Number.isFinite(rawImageAspect)) {
    throw new Error(`computeFlatTextureFit: rawImageAspect must be a positive finite number, got ${rawImageAspect}`);
  }

  // Pixel-space (Y=0 top) -> texture UV-space (V=0 bottom): swap + complement.
  const minU = contentBox.minXFrac;
  const maxU = contentBox.maxXFrac;
  const minV = 1 - contentBox.maxYFrac;
  const maxV = 1 - contentBox.minYFrac;
  const widthFrac = maxU - minU; // == contentBox.maxXFrac - minXFrac
  const heightFrac = maxV - minV; // == contentBox.maxYFrac - minYFrac (flip preserves interval length)

  // Content box's own aspect ratio, derived from its fraction-of-bitmap size
  // and the raw bitmap's aspect ratio (fractions alone don't carry this).
  const contentAspect = (widthFrac * rawImageAspect) / heightFrac;
  const rotate = needsOrientationRotation(contentAspect, targetAspect);
  const effectiveAspect = rotate ? 1 / contentAspect : contentAspect;
  const cover = computeCoverUV(effectiveAspect, targetAspect);

  if (!rotate) {
    // No rotation: cover-fit's repeat/offset (computed within the content
    // box's own [0,1] local space) just needs rescaling into the content
    // box's actual sub-rectangle of the raw bitmap — a plain nested
    // scale+offset, no axis swap.
    return {
      repeat: [widthFrac * cover.repeat[0], heightFrac * cover.repeat[1]],
      offset: [minU + widthFrac * cover.offset[0], minV + heightFrac * cover.offset[1]],
      rotation: 0,
    };
  }

  // Rotate case: folds THREE's rotation=+90°/center=(0.5,0.5) convention
  // (the already-validated round-2 orientation fix) into a single
  // rotation=+90°/center=(0,0) affine transform that additionally rescales
  // into the content box's sub-rectangle. Derived by expanding the
  // round-2 formula's explicit outU(gu,gv)=repeat[0]*gv+K1,
  // outV(gu,gv)=-repeat[1]*gu+K2 form (K1/K2 folding in center=(0.5,0.5))
  // and nesting the content-box rescale on top; verified numerically
  // against an actual THREE.Texture (see D4 crop-fix OUTCOME.md addendum).
  return {
    repeat: [widthFrac * cover.repeat[0], heightFrac * cover.repeat[1]],
    offset: [
      minU + widthFrac * ((1 - cover.repeat[0]) / 2 + cover.offset[0]),
      minV + heightFrac * (cover.repeat[1] / 2 + 0.5 + cover.offset[1]),
    ],
    rotation: Math.PI / 2,
  };
}

/** Box dims (cm) for a flat-textured furniture item's placeholder mesh —
 *  just `dimsCm` restated as a named triple, kept as its own function so
 *  callers (buildScene.ts, tests) don't reach into the schema shape
 *  directly and so the "which dims a flat-texture item uses" question has
 *  one answer. Only BoxFurniture carries `flatTextureHash` (schema/scene.ts),
 *  so `dimsCm` is always present here. */
export function flatTextureBoxDims(dimsCm: { w: number; d: number; h: number }): {
  width: number;
  height: number;
  depth: number;
} {
  return { width: dimsCm.w, height: dimsCm.h, depth: dimsCm.d };
}
