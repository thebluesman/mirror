// Proposal: docs/proposals/keyboard-cheatsheet.md (improvements-minor-fixes.md
// §3, approved 2026-07-22). Single source of truth for every currently-bound
// keyboard shortcut — Viewport.tsx's `onKeyDown` matches keystrokes against
// the exported `KEYS_*` arrays below, and the new `?` cheatsheet overlay
// (ShortcutCheatsheet.tsx) renders `SHORTCUTS` — so the *key literals* can't
// drift between the two (the string "q" is typed once, here, not once inline
// in onKeyDown and once hand-copied into the overlay). Per the proposal's
// §4.3, this is NOT a fully table-driven dispatch — onKeyDown stays the same
// if/else chain it always was, just comparing against imported arrays
// instead of inline literals; see that section for why the stronger refactor
// wasn't worth the cost here.
//
// Plain data module, no React/Three import — same "pure, importable from
// both Viewport.tsx and the overlay without pulling either into the other's
// dependency graph" shape as elevation.ts/rotateHandle.ts/walkCamera.ts.
//
// Mode-toggle key is `V` (not `M`, the proposal's own recommendation) —
// product review picked `V` instead (2026-07-22).

export interface ShortcutDef {
  /** Display key(s) for the cheatsheet row, e.g. "Q / E" or "L". Not
   *  necessarily every evt.key variant that matches — see the KEYS_* arrays
   *  below for that (both letter cases, where relevant). */
  display: string;
  label: string;
  /** When the shortcut is actually live — drives cheatsheet grouping. */
  context: "selection" | "walk" | "global";
}

export type ShortcutContext = ShortcutDef["context"];

// Exported key-literal arrays: Viewport.tsx's onKeyDown/onKeyUp match against
// these directly (`KEYS_ROTATE_CCW.includes(evt.key)`) instead of retyping
// the literals inline, so the *values* a keystroke is compared against and
// the values documented in the cheatsheet are the same array, not two
// hand-synced copies of "q", "Q", "[".
export const KEYS_ROTATE_CCW = ["q", "Q", "["];
export const KEYS_ROTATE_CW = ["e", "E", "]"];
export const KEYS_ELEVATE_UP = ["PageUp"];
export const KEYS_ELEVATE_DOWN = ["PageDown"];
export const KEYS_LOCK = ["l", "L"];
export const KEYS_MODE_TOGGLE = ["v", "V"];
export const KEYS_CANCEL_GESTURE = ["Escape"];
export const KEYS_WALK_FORWARD = ["w", "W"];
export const KEYS_WALK_BACK = ["s", "S"];
export const KEYS_WALK_LEFT = ["a", "A"];
export const KEYS_WALK_RIGHT = ["d", "D"];
// improvements-minor-fixes.md §4: walk-mode crouch/"sit" toggle — built the
// round before this proposal's own shortcut survey was written, so it isn't
// in the proposal's own table. Added here anyway so this shared source of
// truth is actually complete (every currently-live shortcut, not just the
// ones the proposal happened to survey) rather than silently missing a real
// binding the cheatsheet should list.
export const KEYS_CROUCH = ["c", "C"];

export const SHORTCUTS: ShortcutDef[] = [
  { display: "Q / E", label: "Rotate selected item 15°", context: "selection" },
  { display: "PgUp / PgDn", label: "Raise / lower selected item", context: "selection" },
  { display: "L", label: "Toggle lock on selected item", context: "selection" },
  { display: "Esc", label: "Cancel an in-progress drag/rotate/elevate", context: "selection" },
  { display: "V", label: "Toggle walk / orbit camera mode", context: "global" },
  { display: "W A S D", label: "Move while walking", context: "walk" },
  { display: "C", label: "Crouch / stand while walking", context: "walk" },
  { display: "Esc", label: "Exit walk mode", context: "walk" },
  { display: "Cmd/Ctrl+Z", label: "Undo last action", context: "global" },
];
