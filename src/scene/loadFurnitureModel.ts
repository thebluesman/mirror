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
import type { Dims } from "../schema/scene";

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
 */
export function fitModelToDims(model: THREE.Object3D, dims: Dims): void {
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
