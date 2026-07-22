// Pure scene mutation for a completed furniture import (Phase 4, PRD §7.3).
// Kept separate from ImportPanel's React state so the "attach hashes to an
// item + ensure it has a placement" logic is unit-testable without a
// browser/IndexedDB/OPFS in the loop.

import type { Dims, FurnitureItem, ModelRotation, SceneFile } from "../schema/scene";
import { commitToActiveLayout } from "../scene/commit";

export interface ImportResult {
  /** Existing item id to attach the import to, or a fresh id for a brand-new
   *  item (see `newItemName`). */
  itemId: string;
  /** Set only when `itemId` isn't an existing item — creates a new box-shape
   *  FurnitureItem. Ignored when `itemId` already exists in `scene.items`. */
  newItemName?: string;
  dimsCm: Dims;
  sourcePhotoHash: string;
  glbHash: string;
  /** Pre-scale orientation correction for a Meshy GLB that came out lying
   *  on its side or facing backwards (see loadFurnitureModel.ts). Omitted
   *  (or all-zero) means the model needs no correction. */
  modelRotationDeg?: ModelRotation;
}

/**
 * Attaches a completed import's photo/GLB hashes and confirmed dims to its
 * item (creating the item if it's new), and ensures the **active** layout
 * (`scene.current`, whichever it is — not assumed to be the default one) has a
 * placement command for it: reusing the item's existing Figma-seeded/prior
 * command if one is already there (PRD §7.1/§7.3: "place at the item's
 * Figma-seeded position/rotation"), or appending a default-position command if
 * not ("items with no Figma footprint get a default position"). Pure: returns
 * a new SceneFile, does not mutate the input.
 *
 * The placement is written to the active layout only — each layout owns its
 * own commands (schema's full-copy-snapshot model), so a genuinely new item
 * imported while a non-default layout is active lands in that layout, and
 * other layouts are left as they were. The command write goes through
 * `commitToActiveLayout` (src/scene/commit.ts), the single seam every
 * placement-affecting action shares.
 */
export function applyFurnitureImport(scene: SceneFile, result: ImportResult): SceneFile {
  const existingIdx = scene.items.findIndex((i) => i.id === result.itemId);

  let items: FurnitureItem[];
  if (existingIdx >= 0) {
    items = scene.items.map((item, idx) => {
      if (idx !== existingIdx) return item;
      return {
        ...item,
        dimsCm: result.dimsCm,
        sourcePhotoHash: result.sourcePhotoHash,
        glbHash: result.glbHash,
        // Full replace, not merge: a re-import onto an existing item (e.g.
        // fixing a wrong source photo) clears a stale correction from the
        // old model rather than carrying it onto the new one.
        modelRotationDeg: result.modelRotationDeg,
      } as FurnitureItem;
    });
  } else {
    const newItem: FurnitureItem = {
      id: result.itemId,
      name: result.newItemName ?? result.itemId,
      shape: "box",
      dimsCm: result.dimsCm,
      sourcePhotoHash: result.sourcePhotoHash,
      glbHash: result.glbHash,
      modelRotationDeg: result.modelRotationDeg,
    };
    items = [...scene.items, newItem];
  }

  return commitToActiveLayout({ ...scene, items }, (commands) => {
    // Already placed in the active layout — a re-import/replace keeps its
    // existing position/rotation untouched (only the item's asset hashes,
    // updated above, change).
    if (commands.some((c) => c.itemId === result.itemId)) return [...commands];
    // New to this layout — give it a default placement command so it renders.
    // Position [0,0,0] is the origin corner; Phase 4 (PRD §7.4) replaces this
    // with a collision-nudged visible default. Kept here as the seam that
    // guarantees a placement exists at all.
    return [...commands, { type: "place", itemId: result.itemId, position: [0, 0, 0], rotationDeg: 0 }];
  });
}
