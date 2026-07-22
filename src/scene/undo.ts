// v2 Phase 7 (single-step undo — PRD-v2 §7.9 / §11.3, decided 2026-07-22
// reversing the draft's "defer again" recommendation). Shyam asked for undo in
// v2, scoped deliberately to **single-step**: revert the one most recent
// committed action. Multi-step history and redo are explicitly separate,
// undecided questions for later (§7.9) — deliberately NOT built toward here.
//
// The mechanism is a whole-SceneFile snapshot, not per-command inversion. Every
// discrete action already funnels through App.tsx's `commit()` tail (move /
// rotate / elevation / replace / import / layout save-delete-rename / view
// save-delete-rename), and `commit()` produces a fresh SceneFile each time. So
// the single seam undo needs is "the SceneFile as it was just before the most
// recent commit" — one slot, restored wholesale. This is strictly more general
// than popping a layout's commands[] (§7.9's framing): it also covers layout-
// and view-level ops, which don't live in commands[] at all, with no special
// casing. Kept pure (no React, no persistence) so it's unit-testable the same
// way commit.ts / layouts.ts / snapping.ts are; App owns the setSceneFile +
// saveProjectNow tail on top of what this returns.

import type { SceneFile } from "../schema/scene";

/**
 * The single-step undo slot: at most one SceneFile — the state immediately
 * before the most recent committed action. `null` means there's nothing to undo
 * (initial load, right after a reload, or right after an undo was consumed).
 *
 * Deliberately one slot, never an array: PRD-v2 §7.9 scopes v2 to single-step
 * undo with no multi-step history and no redo. If this ever became a stack,
 * that would be over-building past the decided scope.
 */
export type UndoSlot = SceneFile | null;

/**
 * Records the pre-action SceneFile as the thing a subsequent undo restores,
 * replacing whatever was there (single-step: only the most recent action is
 * ever undoable). Call with `sceneFile` as it was *before* the action's result
 * is committed.
 */
export function recordUndo(previous: SceneFile): UndoSlot {
  return previous;
}

/**
 * Consumes the slot: returns the SceneFile to restore plus the next slot state,
 * or `null` if there's nothing to undo (so the caller can no-op — a disabled
 * button, or a keyboard shortcut that does nothing).
 *
 * The next slot is always empty. Undoing is not itself recorded as an undoable
 * or redoable action (there is no redo in v2), so a second undo press is a
 * no-op until another committed action records a fresh slot — exactly the
 * single-step semantics §7.9 asks for.
 */
export function applyUndo(slot: UndoSlot): { restored: SceneFile; next: UndoSlot } | null {
  if (!slot) return null;
  return { restored: slot, next: null };
}
