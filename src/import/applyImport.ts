// Pure scene mutation for a completed furniture import (Phase 4, PRD §7.3).
// Kept separate from ImportPanel's React state so the "attach hashes to an
// item + ensure it has a placement" logic is unit-testable without a
// browser/IndexedDB/OPFS in the loop.

import type { Dims, FurnitureItem, PlaceCommand, SceneFile } from "../schema/scene";

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
}

/**
 * Attaches a completed import's photo/GLB hashes and confirmed dims to its
 * item (creating the item if it's new), and ensures the current layout has a
 * placement command for it — reusing the item's existing Figma-seeded
 * command if one is already there (PRD §7.1/§7.3: "place at the item's
 * Figma-seeded position/rotation"), or appending a default-position command
 * if not ("items with no Figma footprint get a default position"). Pure:
 * returns a new SceneFile, does not mutate the input.
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
    };
    items = [...scene.items, newItem];
  }

  const currentLayout = scene.layouts.find((l) => l.id === scene.current);
  const alreadyPlaced = currentLayout?.commands.some((c) => c.itemId === result.itemId) ?? false;

  let layouts = scene.layouts;
  if (currentLayout && !alreadyPlaced) {
    const defaultCommand: PlaceCommand = {
      type: "place",
      itemId: result.itemId,
      position: [0, 0, 0],
      rotationDeg: 0,
    };
    layouts = scene.layouts.map((l) =>
      l.id === scene.current ? { ...l, commands: [...l.commands, defaultCommand] } : l,
    );
  }

  return { ...scene, items, layouts };
}
