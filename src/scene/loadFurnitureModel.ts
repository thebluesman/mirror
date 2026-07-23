// Bridges Phase 2's OPFS asset store to a rendered furniture GLB (Phase 4,
// PRD §7.3): decode a stored GLB into a THREE.Object3D, then rescale/
// floor-snap/recenter it to an item's confirmed cm dimensions — the same
// transform spike/import/process-glb.mjs did offline with gltf-transform,
// done here at load time in Three.js instead. Doing it at load time (rather
// than baking a processed GLB) means re-confirming an item's dims later
// doesn't require regenerating or re-processing the file.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getAsset } from "../storage/assets";
import type { Dims, ModelRotation } from "../schema/scene";

/** Decodes a stored GLB into a fresh THREE.Object3D. Throws if the hash isn't
 *  in the asset store — callers should already know it's there (it came from
 *  a completed import), so a miss means real data corruption, not a normal
 *  "not found yet" case to swallow. */
export async function loadFurnitureModel(glbHash: string): Promise<THREE.Object3D> {
  const blob = await getAsset(glbHash);
  if (!blob) throw new Error(`Furniture GLB asset not found in store: ${glbHash}`);
  const url = URL.createObjectURL(blob);
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    return gltf.scene;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Scales `model` per-axis so its bounding box matches `dims` (cm), then
 * floor-snaps (min-Y -> 0) and recenters (X/Z bbox center -> 0/0) — mirrors
 * process-glb.mjs's rescale+floor-snap+recenter, adapted to run against
 * whatever native units the loaded GLB uses (glTF convention is meters, but
 * this only cares about the ratio, not the unit name) and to land directly
 * in the app's cm-scaled scene coordinates. Mutates `model` in place.
 *
 * `modelRotationDeg`, if given, is applied *before* the bounding box is
 * measured — Meshy doesn't guarantee a generated GLB comes out upright or
 * forward-facing (spike 3 hit this same class of bug), so a model that's
 * lying on its side or facing backwards needs correcting before its local
 * axes are read as width/height/depth, not after (a post-hoc yaw on an
 * already axis-fit model can't undo a bad axis assignment).
 *
 * The correction rotation goes on an inner wrapper, not on `model` itself:
 * `Object3D.scale` is applied in the node's *own* local axes (scale, then
 * rotation, then translation, in that composition order), so if `model`
 * carried both the correction rotation and the fitted scale, `model.scale`
 * would still act along the pre-rotation axes — not the post-rotation axes
 * the bounding box below is measured in. Keeping `model`'s own rotation at
 * identity and pushing the correction into a child means `model.scale` (set
 * further down) operates in the same frame the box was measured in.
 */
export function fitModelToDims(model: THREE.Object3D, dims: Dims, modelRotationDeg?: ModelRotation): void {
  if (modelRotationDeg) {
    const wrapper = new THREE.Group();
    wrapper.rotation.set(
      THREE.MathUtils.degToRad(modelRotationDeg.x),
      THREE.MathUtils.degToRad(modelRotationDeg.y),
      THREE.MathUtils.degToRad(modelRotationDeg.z),
    );
    while (model.children.length > 0) {
      wrapper.add(model.children[0]);
    }
    model.add(wrapper);
    model.updateMatrixWorld(true);
  }

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  model.scale.set(
    size.x > 1e-6 ? dims.w / size.x : 1,
    size.y > 1e-6 ? dims.h / size.y : 1,
    size.z > 1e-6 ? dims.d / size.z : 1,
  );
  model.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  fitted.getCenter(center);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= fitted.min.y;
  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

// Tint application for a loaded GLB moved to src/scene/furnitureTint.ts
// (captureTintableMaterials/applyItemTint) — Viewport.tsx's material-only
// live-update effect needs to reapply a changed tint without redecoding the
// model, which requires capturing each material's original color once at
// load time and resetting to it before reapplying, unlike this file's old
// one-shot applyModelTint (safe only because it ran exactly once per fresh
// decode).
