// v2 Phase 1 (arrangement hardening — PRD-v2 §7.1): the single write-point
// for placement commands into a scene's *active* layout. Before this, four
// call sites (App.tsx's commitPlacement + handleImported, and applyImport.ts)
// each open-coded "find the current layout, edit its commands[], hand back a
// new SceneFile" — the spike deferred unifying them until persistence work
// touched them all, and this is that moment.
//
// Why it matters beyond tidiness: Phase 7 (single-step undo) needs *exactly
// one* place where a command enters a layout, so it has a single seam to
// record what was written (and, later, to pop it back off). That seam is
// `commitToActiveLayout` below — a future undo hook attaches here without
// having to re-find every scattered mutation. Kept pure (no React, no
// persistence) so it's unit-testable and reusable from both the pure import
// path and App.tsx's React state; App owns the setSceneFile + saveProjectNow
// tail on top of what this returns.

import type { PlaceCommand, SceneFile } from "../schema/scene";

/** A transform on the active layout's command list — receives the current
 *  commands, returns the next set. The whole delta (which command changed,
 *  from what to what) is observable inside `commitToActiveLayout` from the
 *  before/after pair, which is the hook a later undo phase records against. */
export type CommandsMutation = (commands: readonly PlaceCommand[]) => PlaceCommand[];

/**
 * Applies `mutate` to the active (`scene.current`) layout's commands and
 * returns a new SceneFile — the one place placement commands are written into
 * a layout. Other layouts are left untouched (each layout owns its own
 * commands, per the schema's full-copy-snapshot model). Pure: does not mutate
 * the input.
 *
 * If `scene.current` doesn't resolve to a layout (a corrupt/stale `current`),
 * the input is returned unchanged rather than silently dropping the mutation
 * into nowhere — the caller's other edits (e.g. an item added to `items[]`)
 * still stand, and the miss is visible as "no placement happened" rather than
 * a half-applied write.
 *
 * Phase 7 (undo) hook point: a recorder can wrap this call (or observe the
 * before/after commands here) to log the committed command; nothing else in
 * the app writes a layout's commands, so this is the only seam it needs.
 */
export function commitToActiveLayout(scene: SceneFile, mutate: CommandsMutation): SceneFile {
  let changed = false;
  const layouts = scene.layouts.map((layout) => {
    if (layout.id !== scene.current) return layout;
    changed = true;
    return { ...layout, commands: mutate(layout.commands) };
  });
  if (!changed) return scene;
  return { ...scene, layouts };
}

/** Upserts one item's PlaceCommand into a command list: replaces the existing
 *  command for `itemId` in place if present (a move/rotate/elevation edit of
 *  an already-placed item), else appends a fresh one (an item gaining its
 *  first placement). A `CommandsMutation` for the common single-item case. */
export function setPlaceCommand(
  commands: readonly PlaceCommand[],
  itemId: string,
  position: [number, number, number],
  rotationDeg: number,
): PlaceCommand[] {
  if (commands.some((c) => c.itemId === itemId)) {
    return commands.map((c) => (c.itemId === itemId ? { ...c, position, rotationDeg } : c));
  }
  return [...commands, { type: "place", itemId, position, rotationDeg }];
}
