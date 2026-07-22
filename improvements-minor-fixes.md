# improvements-minor-fixes — running punch list from Shyam's testing

Not a versioned batch like v1/v2 or a thought-grouping like v2.1/v2.2 — this
is a running doc for small feedback items Shyam finds while testing shipped
work, so they don't need a new doc per round. Currently holds first-pass
notes on `improvements-v2.1.md`'s PR (#25). More will be appended once
`improvements-v2.2.md` lands and Shyam tests that.

## 1. HUD button icon placement is still off

Screenshot: the HUD pill row (`ViewportChrome.tsx`) — lock-all pill, saved-view
chips with pencil/× icons. Spacing/alignment reads inconsistent even after the
Lucide swap in v2.1 §0.

Likely the same root cause as §2 below, not a separate bug: icon sizes are
hand-picked per call site with no system —
`<Lock size={13} .../> <LockOpen size={13} .../>` (line 87), `<Pencil
size={12} .../>` (line 126), `<X size={14} .../>` (line 134) — three
different sizes across icons that all sit inline with the same 13px text at
the same `gap: var(--space-8)`. Optically these don't line up even though the
flexbox alignment (`align-items: center`) is technically correct. Fix
alongside §2 — a defined icon-size scale tied to context (inline-with-text vs.
standalone button) should resolve both at once rather than hand-tuning three
more magic numbers.

## 2. Icon sizing — needs a system, not eyeballing

Increase icon sizes generally (current 12–14px reads small against 13–14px
body text). Research what works — survey how comparable products size icons
relative to adjacent text/touch targets (e.g. a fixed ratio to font-size, or
a small fixed step scale like 16/20/24) — then **codify the result in
`DESIGN.md`** as a new rule (icon sizing wasn't covered in the original
Cohere extraction, so this is new ground, not a gap-fix). Once the rule
exists, apply it across all current Lucide usages
(`ViewportChrome.tsx`, `LayoutChrome.tsx`, `App.tsx`) instead of the current
per-call-site sizes.

## 3. Keyboard shortcuts + a discoverable cheatsheet

Cmd/Ctrl+Z already works for undo (`App.tsx`, window-level keydown listener).
What's missing:
- A **toggle shortcut for walk vs. orbit mode** — currently only reachable
  via a HUD click, no keyboard equivalent, unlike every other mode/state
  toggle in the app (L for lock, q/e/[/]/PageUp/PageDown for
  rotate/elevation).
- A **shortcut for lock** already exists (`L`, per-item, `Viewport.tsx`) —
  worth confirming discoverability is the actual gap here, not the shortcut
  itself.
- Survey the rest of the current shortcut set for gaps/collisions before
  picking new bindings (walk-mode WASD already claims those letters while
  walking, which constrains what a mode-toggle key can be).
- **One-click cheatsheet:** a HUD affordance (e.g. a `?` pill, matching the
  existing pill visual language) that opens an overlay listing every active
  shortcut. Should read shortcuts from one shared source of truth (not
  hand-duplicated between the overlay and each handler), so it can't drift
  out of sync with `Viewport.tsx`'s actual key handling as shortcuts are
  added later.

## 4. Walk mode: add a "sit"/crouch key

Walk mode (`walkCamera.ts`, `WALK_EYE_HEIGHT_CM = 160`) is a fixed eye
height today. Add a crouch/"sit" toggle that drops eye height to a seated
level while walk mode is active — same drag-free, instant-toggle shape as
lock, not a continuous crouch animation unless that turns out to be trivial
given the existing velocity-integration code. Scope the exact seated height
and transition (instant snap vs. eased) as part of the build, and flag if it
interacts with the orbit-mode Y-restore fix already shipped in v2.1's
post-review pass (`applyCameraMode`'s stash/restore of pre-walk Y).

## 5. Give the manipulation handles a design-system voice

The new rotate ring/knob and elevation double-arrow (v2.1 §3) are
functionally good but visually generic. Reskin them using `DESIGN.md`'s
actual vocabulary — radius scale, shape language, corner treatment — so they
read as part of the same product as the rest of the UI rather than default
Three.js gizmo shapes. Needs a proposal (shapes/colors/proportions), same as
§3's original research-and-propose treatment, not a blind reskin — bring
options back before implementing, consistent with the "no undocumented
interaction variants" rule DESIGN.md already sets for chrome.

## 6. Static local copy of the live getdesign.md source

v2.1's audit (§0) couldn't diff `DESIGN.md` against
https://getdesign.md/cohere/design-md because that session's network policy
blocked the fetch. Resolved: Shyam ran `npx getdesign@latest add cohere`
himself and committed the output at **`cohere/DESIGN.md`** — realladygrey
should diff the repo-root `DESIGN.md` against `cohere/DESIGN.md` directly,
no live network access needed. This unblocks the outstanding half of v2.1
§0.

## 7. Sidebar panel titles should be bold

Screenshot: "Shell texturing" heading (`ShellPanel.tsx:192`,
`.shell-panel-title`). Root cause: `--text-feature-heading` in
`tokens.css:34` is defined as `400 24px/1.3 var(--font-display)` — weight
400 (regular), not bold. Confirm whether this token is used only by these
sidebar panel titles or shared more broadly before changing it — if shared,
either bump the token itself or add a heavier variant so other users of
`--text-feature-heading` aren't unintentionally affected.

## Sequencing note

§1 and §2 share a root cause — do §2's research/DESIGN.md rule first, then
apply it, which likely resolves §1 as a side effect rather than as a
separate fix. §5 and §3's cheatsheet both need a short research/proposal
pass before implementation, same treatment as v2.1 §3 and v2.2 §3/§7. §6 is
blocked on Shyam providing the file, not on realladygrey. §4, §7 are
otherwise independent and small.
