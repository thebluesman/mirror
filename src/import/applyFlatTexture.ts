// Pure scene mutation for the flat-texture upload control (Phase 6, PRD
// §7.6). Kept separate from ImportPanel's React state, same reasoning as
// applyImport.ts's applyFurnitureImport: attaching a hash to an item is
// unit-testable without a browser/OPFS in the loop, and the panel component
// stays a thin wrapper around it (upload photo -> putAsset -> this ->
// persist).
//
// Unlike a furniture import, a flat-texture upload never creates a new item
// or touches placement — it only ever sets `flatTextureHash` on an item
// that's already in the scene, and only when that item is box-shaped (the
// same restriction the schema and buildScene.ts's renderer already carry —
// see schema/scene.ts's `flatTextureHash` comment and
// buildScene.ts's `isBoxFurnitureItem`).

import { isBoxFurnitureItem } from "../scene/buildScene";
import type { FurnitureItem, SceneFile } from "../schema/scene";

/**
 * Sets `itemId`'s `flatTextureHash` to `flatTextureHash`, returning a new
 * SceneFile (does not mutate the input). Throws if `itemId` isn't in
 * `scene.items`, or if it isn't a box-shaped item — both are programming
 * errors at the call site (the UI only ever offers this control for an
 * existing box item), not user-recoverable states worth a softer failure.
 */
export function applyFlatTexture(scene: SceneFile, itemId: string, flatTextureHash: string): SceneFile {
  const existing = scene.items.find((i) => i.id === itemId);
  if (!existing) {
    throw new Error(`applyFlatTexture: no item with id "${itemId}"`);
  }
  if (!isBoxFurnitureItem(existing)) {
    throw new Error(`applyFlatTexture: item "${itemId}" isn't box-shaped — flat textures are box-items-only`);
  }

  const items: FurnitureItem[] = scene.items.map((item) => {
    if (item.id !== itemId) return item;
    // Narrows `item` to BoxFurnitureItem so the spread below type-checks
    // against the full FurnitureItem union (the `existing` check above
    // already guarantees this branch is always taken here).
    if (!isBoxFurnitureItem(item)) return item;
    return { ...item, flatTextureHash };
  });
  return { ...scene, items };
}
