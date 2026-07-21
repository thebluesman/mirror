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
