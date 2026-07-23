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
    downscaleModelTextures(gltf.scene);
    return gltf.scene;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// A GLB's on-disk size (compressed PNG/JPEG) says little about its GPU cost —
// a single undecoded 4K RGBA texture is ~64MB of VRAM once uploaded, and a
// PBR material commonly carries several (base color, normal, roughness/
// metalness, emissive...) at that resolution. A manually uploaded .glb (see
// ImportPanel's "Upload .glb…") isn't necessarily sized the way this app's
// own fal.ai generations are — a 44MB upload with 4K-per-slot textures
// blew past available VRAM and force-lost the WebGL context with no clean
// recovery (recurring report, 2026-07-23). 2048px keeps furniture looking
// correct at this app's viewing distances while cutting worst-case VRAM
// ~4x per texture slot.
const MAX_TEXTURE_SIZE = 2048;

// Every texture slot a glTF PBR material can populate on a MeshStandardMaterial
// (GLTFLoader maps glTF's metallic-roughness model onto these) — the app has
// only ever *read* `.map`/`.color` (furnitureTint.ts, tintBlend.ts), but an
// uploaded/generated GLB can carry any of these, so downscaling only `.map`
// would leave the others as the actual VRAM hog.
const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "bumpMap",
] as const satisfies ReadonlyArray<keyof THREE.MeshStandardMaterial>;

/** Caps every PBR texture on `model`'s materials to `maxSize` px per side,
 *  in place. Mutates each oversized `THREE.Texture` (redraws its image onto
 *  a canvas at the capped size, closes the original `ImageBitmap` to free it
 *  promptly, sets `needsUpdate`) rather than replacing the texture object —
 *  callers (furnitureTint.ts's captureTintableMaterials, tintBlend.ts) key
 *  off the material's existing texture references. A `Set` guards against
 *  downscaling the same texture twice when multiple meshes/materials in one
 *  model share it (glTF materials are commonly reused across mesh
 *  primitives). Exported for ObjectPreview3D.tsx, which decodes its own GLB
 *  independently of loadFurnitureModel (its own small isolated preview
 *  scene, not routed through OPFS/getAsset) but needs the same cap — it's
 *  the confirm-dims stage where this bug actually surfaced. */
export function downscaleModelTextures(model: THREE.Object3D, maxSize: number = MAX_TEXTURE_SIZE): void {
  const seen = new Set<THREE.Texture>();
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        if (texture && !seen.has(texture)) {
          seen.add(texture);
          downscaleTexture(texture, maxSize);
        }
      }
    }
  });
}

function downscaleTexture(texture: THREE.Texture, maxSize: number): void {
  const image = texture.image as { width?: number; height?: number } | undefined;
  const width = image?.width;
  const height = image?.height;
  if (!width || !height || (width <= maxSize && height <= maxSize)) return;

  const scale = maxSize / Math.max(width, height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // no 2d context available — leave the texture at full size rather than crash
  ctx.drawImage(image as CanvasImageSource, 0, 0, targetWidth, targetHeight);

  // GLTFLoader's default (ImageBitmapLoader) path decodes into an
  // ImageBitmap — close it now that it's been drawn into the smaller canvas,
  // rather than leaving the full-size bitmap's memory for GC to reclaim
  // eventually (same reasoning as texturing/pipeline.ts's `bitmap.close()`).
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();

  texture.image = canvas.transferToImageBitmap();
  texture.needsUpdate = true;
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
