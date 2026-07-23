// Shared tint-apply helper for an imported GLB's materials (Viewport.tsx's
// GLB-attach handler and its material-only live-update effect — see
// buildScene.ts's structurallyEqualFurnitureItems for why tint edits no
// longer trigger a full rebuild). A GLB's per-mesh materials each start from
// whatever colors the import itself carried (no single shared base color the
// way MAT.furniture is for the box placeholder path), so — unlike
// buildScene.ts's furnitureMaterialFor, which can just derive a fresh
// material from the constant shared base on every call — a repeated tint
// edit here needs each material's own original color captured once, up
// front, to reset to before reapplying; otherwise a second tint edit would
// multiply/screen-blend on top of the first instead of replacing it.

import * as THREE from "three";
import type { TintBlendMode } from "../schema/scene";
import { applyTintBlend } from "./tintBlend";

export interface TintableMaterial {
  material: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
}

/** Walks a loaded model's meshes and captures every color-bearing material
 *  it owns, paired with its current (i.e. untinted — call this right after
 *  decode, before any tint is applied) color. Duck-types on `.color` like
 *  loadFurnitureModel.ts's old applyModelTint did, since a glTF import can
 *  carry any of several color-bearing material types. */
export function captureTintableMaterials(model: THREE.Object3D): TintableMaterial[] {
  const entries: TintableMaterial[] = [];
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((mat) => {
      const colorBearing = mat as THREE.Material & { color?: THREE.Color };
      if (!colorBearing.color) return;
      entries.push({ material: mat as THREE.MeshStandardMaterial, baseColor: colorBearing.color.clone() });
    });
  });
  return entries;
}

/** Applies (or clears) an item's tint across every material `captureTintableMaterials`
 *  found, resetting to each one's captured base color first — idempotent/safe
 *  to call repeatedly as tint edits change, unlike mutating `.color` directly
 *  on every call (which would compound). Also clears any previous screen-mode
 *  `onBeforeCompile` shader patch before reapplying — applyTintBlend only
 *  ever installs one, it never tears one down (buildScene's one-shot
 *  construction never needed to undo it; a persistent, repeatedly-edited
 *  material here does). */
export function applyItemTint(
  entries: TintableMaterial[],
  tintColor: string | undefined,
  mode: TintBlendMode = "multiply",
): void {
  entries.forEach(({ material, baseColor }) => {
    material.color.copy(baseColor);
    material.onBeforeCompile = () => {};
    if (tintColor) {
      applyTintBlend(material, tintColor, mode);
    } else {
      material.needsUpdate = true;
    }
  });
}
