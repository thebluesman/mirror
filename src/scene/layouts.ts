// Pure logic for D3 (v2 spike, W-A persistence — see spike-v2/OUTCOME.md,
// v2-spike-plan.md §2's "Multi-layout" bar): save the current arrangement as
// a new named layout, switch between saved layouts. Kept separate from
// LayoutChrome's React state, same split as cameraViewpoints.ts (Phase 5)
// and applyImport.ts use for their own scene mutations — id/slug generation
// and the branch-shape bookkeeping are unit-testable without a WebGL/React
// tree in the loop.

import type { Layout } from "../schema/scene";
import { slugify, uniqueId } from "../util/slug";

/** Snapshots `source`'s current commands into a brand-new named Layout —
 *  a full copy, not a diff: buildScene.ts/Viewport.tsx read a layout's
 *  `commands` directly with no base-layout merge step, so a diff-only
 *  layout simply wouldn't render correctly yet. `base` still records the
 *  parent layout id per the schema's intent (schema/scene-schema-draft.md:
 *  "base: parent layoutId") — forward-looking metadata for whenever a real
 *  diff/undo model lands, unused by any rendering path today. Pure —
 *  caller appends the result to `sceneFile.layouts`. */
export function makeLayout(name: string, source: Layout, existingLayouts: readonly Layout[]): Layout {
  const id = uniqueId(slugify(name, "layout"), new Set(existingLayouts.map((l) => l.id)));
  return {
    id,
    name: name.trim() || id,
    base: source.id,
    commands: source.commands.map((cmd) => ({ ...cmd })),
  };
}

/** In-place rename (PRD-v2 §7.2): updates a layout's display `name` only —
 *  `id` and `commands[]` (and `base`) are untouched, so switching, deleting,
 *  and every placement command already referencing this layout keep working
 *  unchanged. Same blank-name fallback `makeLayout` uses (trim, fall back to
 *  the stable id) rather than re-slugifying — the id was already minted at
 *  creation and renaming must never move it out from under `current` or a
 *  `base` reference. Pure — caller replaces the matching entry in
 *  `sceneFile.layouts`. */
export function renameLayout(layout: Layout, name: string): Layout {
  return { ...layout, name: name.trim() || layout.id };
}
