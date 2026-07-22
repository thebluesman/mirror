// improvements-minor-fixes.md §3 (review round, new scope added at review —
// not in the original keyboard-cheatsheet.md proposal): the global "Lock
// all" HUD button (ViewportChrome.tsx) used to derive its label/pressed
// state purely from App.tsx's own `globalLock` toggle flag. That flag can go
// stale relative to reality — an item can end up individually locked via the
// per-item "L" key (Viewport.tsx's onKeyDown), entirely independent of this
// button, so "every item is locked" and "the globalLock flag is true" are
// two different facts that used to be conflated.
//
// This is the real-state half of the fix: a pure predicate over the actual
// per-item `locked` flags, factored out (rather than inlined in App.tsx,
// which only runs under jsdom/browser-shaped tooling this repo doesn't set
// up for component tests) so it's unit-testable the same way
// elevation.ts/rotateHandle.ts's pure helpers are.

/** True when `items` is non-empty and every item's own `locked` flag is set.
 *  An empty list is deliberately NOT "all locked" — there's nothing to be
 *  locked, so the button should read as its default "Lock all" (unpressed)
 *  state, not a vacuously-true "All locked." */
export function allItemsLocked(items: readonly { locked?: boolean }[]): boolean {
  return items.length > 0 && items.every((item) => item.locked === true);
}
