// improvements-minor-fixes §10 (docs/proposals/tint-blend-modes.md): shared
// blend math/dispatch for `tintBlendMode`, used by both the flat/untextured
// placeholder-box path (buildScene.ts's furnitureMaterialFor) and the
// textured path (loadFurnitureModel.ts's applyModelTint, for an imported
// GLB). Split into two functions per the proposal's §4 cost split:
//
// - `blendTint` is the actual per-channel math against a single flat scalar
//   color — cheap, no shader, used directly wherever `base` is just
//   `material.color` with no `.map` involved.
// - `applyTintBlend` is the material-level dispatch: it takes the flat-
//   scalar shortcut when the material has no `.map` (delegates straight to
//   `blendTint`), and only reaches for a real `onBeforeCompile` shader patch
//   when the material *does* carry a texture and the mode can't be folded
//   into `.color` alone (screen's additive term — see proposal §4).
//
// This round (2026-07-22 scope correction) only implements multiply
// (existing behavior) and screen. The schema already declares the full
// five-mode enum (`TintBlendMode`) so a later round can add overlay/
// soft-light/darken without a schema change; until then, any of those three
// (or any other unrecognized value) falls back to multiply here rather than
// throwing — same "never crash on a mode this build doesn't know" posture
// the enum comment in scene.ts documents.

import * as THREE from "three";
import type { TintBlendMode } from "../schema/scene";

/**
 * Combines `tintColor` into `baseColor` per `mode`, for a flat/untextured
 * material — both are plain per-channel scalars in [0, 1], no texture
 * sampling involved. Mutates and returns `baseColor` in place, mirroring the
 * `.color.multiply()` call site this replaces.
 *
 * - multiply (existing): `base * tint` — darkens toward tint.
 * - screen (new): `1 - (1-base)*(1-tint)` — multiply's lighten-toward-tint
 *   mirror image.
 * - anything else (overlay/soft-light/darken, or any future/unknown value):
 *   falls back to multiply — not implemented this round, but the schema
 *   already allows a file to carry one of these (e.g. authored by a later
 *   build), so this has to degrade sanely instead of throwing.
 */
export function blendTint(baseColor: THREE.Color, tintColor: THREE.Color, mode: TintBlendMode): THREE.Color {
  if (mode === "screen") {
    return baseColor.setRGB(
      1 - (1 - baseColor.r) * (1 - tintColor.r),
      1 - (1 - baseColor.g) * (1 - tintColor.g),
      1 - (1 - baseColor.b) * (1 - tintColor.b),
    );
  }
  return baseColor.multiply(tintColor);
}

/**
 * Applies a tint blend to `material` in place, dispatching on whether it
 * carries a texture map (proposal §4's flat-vs-textured cost split):
 *
 * - No `.map`: the whole blend is one already-computed color — delegate to
 *   `blendTint` directly on `material.color`. Free for every mode.
 * - Has a `.map`, mode is multiply (or an unimplemented mode falling back to
 *   multiply): still free — the stock shader only ever multiplies the
 *   sampled texel by `material.color`, and multiply commutes with that, so
 *   folding tint into `.color` is exact (this is the existing behavior,
 *   unchanged).
 * - Has a `.map`, mode is screen: NOT expressible via `.color` alone (screen
 *   has an additive term `.color` can't reach — see proposal §4), so this
 *   installs a real `onBeforeCompile` patch that recomputes the screen
 *   formula in the fragment shader right after the stock texture-sample
 *   chunk, with the tint color passed in as its own uniform.
 *   `material.color` itself is left at its natural/default value in this
 *   branch — the blend happens entirely in the injected shader code, not by
 *   pre-folding tint into `.color` the way multiply does.
 */
export function applyTintBlend(
  material: THREE.MeshStandardMaterial,
  tintColor: string,
  mode: TintBlendMode,
): void {
  const tint = new THREE.Color(tintColor);

  if (!material.map || mode !== "screen") {
    blendTint(material.color, tint, mode);
    material.needsUpdate = true;
    return;
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.tintColor = { value: tint };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 tintColor;")
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.rgb = 1.0 - (1.0 - diffuseColor.rgb) * (1.0 - tintColor);",
      );
  };
  material.needsUpdate = true;
}
