# Proposal: keyboard shortcuts + a discoverable cheatsheet — improvements-minor-fixes.md §3

**Status:** approved for build (2026-07-22 review). Decisions: mode-toggle
key is **`V`** (not `M` — overrides this doc's recommendation); build
**both** the cheatsheet overlay and the revived `L`-lock hint pill (open
question 1: yes to both); build the shared `SHORTCUTS` table (§4.3) that
both `onKeyDown` and the `?` overlay read from; cheatsheet stays in the
existing bottom-center HUD pill group, not a new position. **New scope
added at review time, not in the original proposal:** the global "Lock all"
HUD button (`ViewportChrome.tsx`) should reflect *actual* lock state — right
now it only tracks its own toggle, so if items end up individually locked
via the `L` key (independent of that button), the button's label/icon can
drift out of sync with reality. Needs a real state read (e.g. "all items
currently locked?") driving the label, not just the button's own flag.
**Date:** 2026-07-22
**Scope frame:** a walk/orbit mode-toggle key, a discoverability audit of the
existing `L` lock shortcut, and a one-click cheatsheet overlay driven by a
single shared shortcut table. No new manipulation behavior — every shortcut
covered here already exists except the mode toggle.

## Problem

The app has accumulated six-ish keyboard shortcuts across two files
(`Viewport.tsx`'s canvas-scoped `onKeyDown`, `App.tsx`'s window-level undo
listener) with no single place that lists them and no way to discover most of
them short of reading source. Two concrete gaps named in §3:

1. Walk vs. orbit camera mode is only reachable via a HUD click
   (`viewport-mode-toggle-pill`, `Viewport.tsx:2049-2063`) — every other
   mode/state toggle in the app (lock, rotate, elevation) has a keyboard
   equivalent; this one doesn't.
2. The per-item lock shortcut (`L`) has a keyboard binding but §3 explicitly
   asks whether the shortcut itself is the problem or whether nobody can find
   out it exists. That needs an answer before proposing more UI for it.

## Recommendation (summary)

1. Bind mode-toggle to **`M`** (mnemonic "mode"), handled in `Viewport.tsx`'s
   existing `onKeyDown` by calling the same `applyModeRef.current?.(...)`
   toggle the HUD button already calls — one new branch, no new logic.
2. Confirmed: `L` has **zero in-app discoverability** today — no tooltip, no
   hint text, nothing in `ObjectInspector` while an item is selected. The
   fix is the cheatsheet (below), plus optionally reviving the "hint pill"
   pattern walk mode already uses, scoped to selection. See §2.
3. Add a `SHORTCUTS` data table (`src/scene/shortcuts.ts`) that both
   `onKeyDown`'s key-matching and a new `?` cheatsheet overlay read from, so
   the two can't drift as shortcuts are added. See §3 for the concrete shape
   and exactly how much drift-proofing it actually buys.

## 1. Full current shortcut survey

Surveyed `Viewport.tsx`'s `onKeyDown` (`Viewport.tsx:1367-1460`), its
walk-mode WASD branch (`Viewport.tsx:1401-1417`), its `onKeyUp`
(`Viewport.tsx:1468-1474`), and `App.tsx`'s window-level undo listener
(`App.tsx:177-188`). Every currently-bound key:

| Key(s) | Effect | Scope / gating | Source |
|---|---|---|---|
| `W`/`A`/`S`/`D` (case-insensitive) | Walk movement (held) | Only in walk mode; inert while orbiting | `Viewport.tsx:1401-1409` |
| `Escape` | Cancel in-progress drag/rotate/elevate gesture; also the browser's own pointer-lock exit, which separately drops walk mode back to orbit | Canvas-focused; a no-op in walk mode's own branch since gestures are always null there | `Viewport.tsx:1378-1389` |
| `L` / `l` | Toggle lock on the selected item | Canvas-focused, item selected, **not** in walk mode (walk mode's branch returns before reaching this) | `Viewport.tsx:1422-1434` |
| `Q`/`q`/`[` | Rotate selected item −15° | Same gating as `L` | `Viewport.tsx:1440` |
| `E`/`e`/`]` | Rotate selected item +15° | Same gating as `L` | `Viewport.tsx:1441` |
| `PageUp` | Raise selected item 5cm | Same gating as `L` | `Viewport.tsx:1442` |
| `PageDown` | Lower selected item 5cm | Same gating as `L` | `Viewport.tsx:1443` |
| `Cmd/Ctrl+Z` | Undo last committed action | Window-level, not canvas-scoped; bails if focus is on an editable element | `App.tsx:177-188` |

Two things worth noting from the survey itself:

- **Rotate/lock/elevate are unreachable while walking**, by design — the
  walk-mode branch returns before the item-shortcut code runs
  (`Viewport.tsx:1411-1417`, "every other key below this point is item
  manipulation"). A mode-toggle key therefore has to work from *both* modes
  to be a real toggle, but nothing else needs to.
- **No collisions exist today.** `W`/`A`/`S`/`D` only ever fire inside the
  walk-mode branch, which returns before `Q`/`E`/`L`/`PageUp`/`PageDown` are
  reachable — so those two "layers" never actually compete for the same
  keypress despite living in the same function.

## 2. The mode-toggle key

**Proposed: `M`.**

Constraints from the survey: not `W`/`A`/`S`/`D` (claimed by walk movement),
and ideally a key with no meaning while walking so there's no ambiguity about
what it does mid-walk. `M` satisfies both — it's untouched by the walk-mode
branch and free everywhere else.

Implementation shape: one new branch in `onKeyDown`, placed **before** the
`cameraModeRef.current === "walk"` check (`Viewport.tsx:1401`) and before the
`if (!itemId) return` gate (`Viewport.tsx:1420`), since mode-toggle isn't
item-scoped and has to fire in both modes:

```ts
if (evt.key === "m" || evt.key === "M") {
  evt.preventDefault();
  applyModeRef.current?.(cameraModeRef.current === "orbit" ? "walk" : "orbit");
  return;
}
```

This calls the exact same `applyModeRef` the HUD pill already calls
(`Viewport.tsx:2053`), so there's no second implementation of the mode-switch
logic to keep in sync — the key is just a second trigger for the existing
one.

**Alternatives considered and rejected:**

- **`Tab`.** Common in-game convention for a mode/view toggle, but it's the
  browser's own focus-navigation key. Using it means `preventDefault()` on
  every press while canvas-focused, which is a bigger behavioral claim than
  a plain letter and has no precedent elsewhere in this file.
- **`V`** ("view"). Equally free and equally mnemonic-plausible. No strong
  reason to prefer it over `M`; flagged in §5 as the one genuinely open call
  if `M` doesn't sit right.

## 3. Is `L`'s discoverability the real gap?

Audited every place lock state is surfaced in the UI:

- `ViewportChrome`'s "Lock all" pill (`ViewportChrome.tsx:85-94`) has a
  `title` — but it describes the *global* lock toggle
  ("Lock all items (prevent accidental drag/rotate/elevate)"), says nothing
  about the per-item `L` key, and isn't near the selected item at all.
- `ObjectInspector` (`ObjectInspector.tsx`), the panel that appears while an
  item is selected, renders name/dims/rotation fields and a close button —
  no lock state, no lock affordance, no keyboard hint, at all.
- The selection outline and handles *do* recolor to amber when an item is
  locked (`LOCKED_COLOR`, `Viewport.tsx:238`, composed in
  `gestureAffordanceColor`) — so a locked item's *state* is visible, but
  there is nothing anywhere that says "press L to toggle this."

**Conclusion: yes, discoverability is the actual gap, not the shortcut.**
The binding itself (`L`, unmodified, canvas-scoped) is a fine, conventional
choice — nothing about it is hard to reach or awkward to press. The problem
is purely that a user who hasn't read the source has no way to learn it
exists. This is exactly what §3's own framing suspected, confirmed against
the code rather than assumed.

Two ways to close that gap, not mutually exclusive:

1. **The cheatsheet (§4)** — the comprehensive fix, listing `L` alongside
   everything else.
2. **Revive the walk-mode hint pattern, scoped to selection.** Walk mode
   already proves this idiom works and is cheap: a small pill-shaped hint
   line rendered under the mode-toggle button whenever walk mode is active
   ("Click to look around · WASD to move · Esc to exit",
   `Viewport.tsx:2064-2066`, `.viewport-mode-hint` in `Viewport.css:51-60`).
   The same treatment could run next to `ObjectInspector` whenever an item
   is selected: "L lock · Q/E rotate · PgUp/PgDn elevate · Esc cancel."
   Cheap (reuses an existing CSS class and text-hint pattern), and it puts
   the specific shortcuts relevant to *what's currently selected* right next
   to the thing they act on, which a general cheatsheet overlay can't do
   (the overlay is opt-in and modal; this is always-on and contextual).

Recommend building both, but if only one ships, the cheatsheet is the one
§3 actually asked for — the selection hint is a cheap complement, not a
substitute (flagged as open question 1 in §5).

## 4. The cheatsheet

### 4.1 HUD affordance

A `?` pill, placed in `ViewportChrome`'s bottom-center bar alongside the
existing "Lock all" and "Snapshot" pills (`ViewportChrome.tsx:85-106`) —
those two are already the bar's precedent for "a standalone viewport action,
not a saved-view list item," which is exactly what this is. Reuses
`.viewport-chrome-pill` as-is (no new visual language, matching the doc's
"matching the existing pill visual language" instruction directly):

```tsx
<button
  type="button"
  className="viewport-chrome-pill"
  onClick={onOpenShortcuts}
  title="Keyboard shortcuts"
  aria-label="Show keyboard shortcuts"
>
  ?
</button>
```

The mode-toggle pill (`viewport-mode-toggle-pill`, top-right,
`Viewport.css:32-45`) is a plausible alternative location, but it's a
solid-fill variant of the same shape reserved for the one mode-switch
control — adding an unrelated second pill there muddies what that corner
means. `ViewportChrome`'s bar is already the "misc viewport actions" shelf;
this belongs there.

### 4.2 Overlay component

A new `ShortcutCheatsheet.tsx`, rendered as a full-viewport modal overlay
(no existing overlay/modal precedent in `DESIGN.md` or the codebase to
extend — this is the first one, so it should stay deliberately plain:
`DESIGN.md`'s token set — canvas/ink colors, `--radius-md`, `--space-*` —
applied to a centered card over a scrim, Escape-to-close, nothing fancier).
Groups entries by `context` (see §4.3) and renders each as a `key — label`
row.

### 4.3 The shared source of truth — the part that needs real design

Add `src/scene/shortcuts.ts`, a plain data module alongside the other
pure/no-React scene helpers (`elevation.ts`, `rotateHandle.ts`,
`walkCamera.ts`) — no React, no Three.js, importable from both
`Viewport.tsx` and the new overlay component without pulling either into
the other's dependency graph:

```ts
export interface ShortcutDef {
  /** Display key(s) for the cheatsheet row, e.g. "Q / E" or "L". Not
   *  necessarily every evt.key variant that matches — see keys below for that. */
  display: string;
  label: string;
  /** When the shortcut is actually live — drives cheatsheet grouping, and
   *  optionally graying out rows that don't apply to the current mode/
   *  selection state (nice-to-have, not required for v1 of the overlay). */
  context: "selection" | "walk" | "global";
}

// Exported key-literal arrays: Viewport.tsx/App.tsx match against these
// directly (`KEYS_ROTATE_CCW.includes(evt.key)`) instead of retyping the
// literals inline, so the *values* a keystroke is compared against and the
// values documented in the cheatsheet are the same array, not two
// hand-synced copies of "q", "Q", "[".
export const KEYS_ROTATE_CCW = ["q", "Q", "["];
export const KEYS_ROTATE_CW = ["e", "E", "]"];
export const KEYS_ELEVATE_UP = ["PageUp"];
export const KEYS_ELEVATE_DOWN = ["PageDown"];
export const KEYS_LOCK = ["l", "L"];
export const KEYS_MODE_TOGGLE = ["m", "M"];
export const KEYS_CANCEL_GESTURE = ["Escape"];
export const KEYS_WALK_FORWARD = ["w", "W"];
export const KEYS_WALK_BACK = ["s", "S"];
export const KEYS_WALK_LEFT = ["a", "A"];
export const KEYS_WALK_RIGHT = ["d", "D"];

export const SHORTCUTS: ShortcutDef[] = [
  { display: "Q / E", label: "Rotate selected item 15°", context: "selection" },
  { display: "PgUp / PgDn", label: "Raise / lower selected item", context: "selection" },
  { display: "L", label: "Toggle lock on selected item", context: "selection" },
  { display: "Esc", label: "Cancel an in-progress drag/rotate/elevate", context: "selection" },
  { display: "M", label: "Toggle walk / orbit camera mode", context: "global" },
  { display: "W A S D", label: "Move while walking", context: "walk" },
  { display: "Esc", label: "Exit walk mode", context: "walk" },
  { display: "Cmd/Ctrl+Z", label: "Undo last action", context: "global" },
];
```

`Viewport.tsx`'s `onKeyDown` swaps its inline literal comparisons for these
exported arrays, e.g.:

```ts
// before
if (evt.key === "q" || evt.key === "Q" || evt.key === "[") stepDeg = -ROTATE_STEP_DEG;
// after
if (KEYS_ROTATE_CCW.includes(evt.key)) stepDeg = -ROTATE_STEP_DEG;
```

**How much drift-proofing this actually buys — stated honestly:** this makes
the *key literals* a true single source (the string `"q"` is typed once, in
`shortcuts.ts`, not once in `onKeyDown` and once in a hand-copied cheatsheet
row). It does **not** make the dispatch itself table-driven — `onKeyDown`
stays the same if/else chain it is today, just comparing against imported
arrays instead of inline literals. A fully drift-proof version would refactor
`onKeyDown` into a lookup over `SHORTCUTS` (each entry carrying its own
handler), which would guarantee "every entry in the table does something and
everything the handler does is in the table" — but that means restructuring
tested, gesture-sensitive keyboard-handling code for a discoverability
feature, which is a worse cost/benefit trade than the plain-literals version
above. The plain version stops the specific drift that actually happens in
practice (someone adds a new key inline in `onKeyDown` and forgets the
cheatsheet, or types `"[["`with a typo in one of the two spots) without
touching the control flow.

One shortcut can't be pulled into this scheme cleanly: **undo lives in
`App.tsx`**, not `Viewport.tsx`, and matches on `(evt.ctrlKey || evt.metaKey) && evt.key === "z"`
— a modifier chord, not a plain `evt.key` literal like everything else here.
Its `SHORTCUTS` row is documentation-only; nothing enforces that `App.tsx`'s
listener and this table agree if the undo binding ever changes. Flagged
because it's the one place the "single source of truth" claim doesn't fully
hold — low risk in practice (undo's binding is extremely unlikely to move),
but worth being honest about rather than overstating the guarantee.

## 5. Open questions for Shyam

1. **Cheatsheet alone, or cheatsheet + the revived selection-hint pill
   (§3)?** The cheatsheet is what §3 asked for and is the comprehensive fix.
   The selection hint is cheap (reuses an existing CSS class/pattern) and
   puts `L` specifically in front of the user at the moment it's relevant,
   which the modal overlay can't do since it's opt-in. Recommend both, but
   flagging this as a scope call, not a given.
2. **`M` vs. `V` for the mode-toggle key.** No strong reason to prefer one —
   both are free, both are equally mnemonic-plausible ("mode" vs. "view").
   Recommend `M`, but this is the one binding choice that's genuinely a
   coin flip.
3. **Is the plain-literals version of the shared source of truth (§4.3)
   enough, or is the stronger table-driven-dispatch refactor worth it?**
   Recommend the plain version — smaller diff, doesn't touch tested gesture
   code — but flagging that it's a real (if unlikely) drift risk, not a
   hard guarantee, in case Shyam would rather pay for the stronger version
   up front.
