// Pure scene mutation for a completed furniture import (Phase 4, PRD §7.3).
// Kept separate from ImportPanel's React state so the "attach hashes to an
// item + ensure it has a placement" logic is unit-testable without a
// browser/IndexedDB/OPFS in the loop.

import type { Dims, FurnitureItem, ModelRotation, SceneFile } from "../schema/scene";
import { commitToActiveLayout } from "../scene/commit";
import { itemFootprintAABB, wallFootprintAABBs, type AABB } from "../scene/collision";
import { findClearDefaultPosition, largestFloorRect } from "../scene/defaultPlacement";

export interface ImportResult {
  /** Existing item id to attach the import to, or a fresh id for a brand-new
   *  item (see `newItemName`). */
  itemId: string;
  /** Set only when `itemId` isn't an existing item — creates a new box-shape
   *  FurnitureItem. Ignored when `itemId` already exists in `scene.items`. */
  newItemName?: string;
  dimsCm: Dims;
  /** Undefined when the GLB came from a manual upload rather than a fresh
   *  fal.ai generation (see ImportPanel's "Upload .glb…" path) — there's no
   *  local photo to hash in that case. The persisted schema has always
   *  allowed this field to be absent (scene.ts); this interface previously
   *  required it only because every caller happened to have one. */
  sourcePhotoHash?: string;
  glbHash: string;
  /** Pre-scale orientation correction for a generated GLB that came out lying
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
        // A manual .glb upload (result.sourcePhotoHash undefined) has no new
        // photo to replace the old one with — keep whatever photo the item
        // already had rather than clearing it, since the old photo still
        // describes the real object even though this GLB didn't come from it.
        sourcePhotoHash: result.sourcePhotoHash ?? item.sourcePhotoHash,
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
    // New to this layout — give it a *visible* default placement (PRD-v2 §7.4).
    // v1 used [0,0,0], the room's origin corner buried in the wall, which D0
    // traced the "TV not showing" report to; this centers the item in the
    // largest floor rect and nudges it off any collision using the same
    // footprint/collision math the live drag path uses (defaultPlacement.ts).
    const position = defaultPlacementForNewItem(scene, items, result.itemId);
    return [...commands, { type: "place", itemId: result.itemId, position, rotationDeg: 0 }];
  });
}

/** The collision-nudged default position (§7.4) for an item newly placed in the
 *  active layout, computed from the scene's room and the items already placed in
 *  that layout. Factored out so the seam above reads as one line. Rotation is
 *  the default 0deg and `position[1]` is 0 — a brand-new item rests on the floor
 *  with no established elevation (elevation is `position[1]`, never re-read from
 *  `item.elevationCm`; see elevation.ts). Falls back to the origin only in the
 *  degenerate no-floor case, where there's nothing to center against. */
function defaultPlacementForNewItem(
  scene: SceneFile,
  items: readonly FurnitureItem[],
  newItemId: string,
): [number, number, number] {
  const room = largestFloorRect(scene.room.floor);
  if (!room) return [0, 0, 0];

  const newItem = items.find((i) => i.id === newItemId)!;
  const itemsById = new Map(scene.items.map((i) => [i.id, i]));
  const activeCommands = scene.layouts.find((l) => l.id === scene.current)?.commands ?? [];
  const others: Array<{ itemId: string; aabb: AABB }> = [];
  activeCommands.forEach((c) => {
    const placed = itemsById.get(c.itemId);
    if (placed) others.push({ itemId: c.itemId, aabb: itemFootprintAABB(placed, c.position, c.rotationDeg) });
  });

  return findClearDefaultPosition(newItem, 0, room, others, wallFootprintAABBs(scene.room));
}
