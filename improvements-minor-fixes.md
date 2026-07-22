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

---

## v2.2 feedback — first-pass notes on PR #26

Numbering restarts per-PR, same convention as the v2.1 section above (these
map to `improvements-v2.2.md`'s own §2/§4a/§5/§6/§8, not to each other).

### 8. Soft rubber-band camera containment (§2) — fine as-is

No changes requested. Ships as built.

### 9. Location-based sun/lighting (extends §4a) — RESOLVED, scope set

Sun intensity/azimuth/elevation are manual sliders today
(`LightingPanel.tsx`, `schema/scene.ts`'s `LightingSchema`). Shyam wants to
explore driving them from a **real location + time of day** instead, tying
into lighting work he has planned beyond this repo (not detailed further
here).

**Decisions from Shyam (2026-07-22):**
- **Coexists as a toggle** — manual sliders and location-driven mode are
  both available, not a replacement of one by the other.
- **Input is raw lat/long, not a free-text place name** — no geocoding
  needed (fine, since CLAUDE.md's standing decisions keep this repo's only
  network call as the fal.ai import). Also needs **room/apartment
  orientation** as a separate input alongside lat/long — the room's local
  X/Z axes aren't compass-aligned, so a solar azimuth computed from
  lat/long/time needs the room's own facing to map onto scene coordinates.
- **Keep the input UI basic for v1** — plain fields are fine, polish comes
  later. Use `cohere/DESIGN.md` as the styling reference (same as every
  other form control in this app), not a bespoke input design.

**Still research-and-propose, not a straight build** — same treatment as
v2.2 §3/§7 got. What's still open for realladygrey to scope:
- A solar-position formula (azimuth/elevation from lat/long/date/time) is a
  well-known calculation (NOAA's algorithm, or a small library) — survey
  options before hand-rolling the math.
- Time-of-day slider: one value (hour) or hour+date (seasonal sun angle
  varies)? Simplest useful version is probably hour-only against a fixed
  date — flag this as an open call in the proposal rather than deciding it
  unilaterally.
- What the lat/long + orientation input actually looks like — this is the
  part Shyam explicitly wants researched/designed, not just wired up:
  propose a concrete basic-but-usable form layout (e.g. two number fields +
  a compass-direction picker for orientation), styled per `cohere/DESIGN.md`.
- Schema shape: likely a new `room`-level field (lat/long + orientation
  degrees), separate from `LightingSchema`'s existing manual fields, plus
  whatever toggle/mode field selects manual vs. location-driven.

### 10. Per-object tint — add blend modes (extends §5) — RESOLVED, scope set

The multiplicative tint (`buildScene.ts`'s `furnitureMaterialFor`) works and
is "quite cool" — Shyam wants additional blend modes beyond multiply (e.g.
overlay/screen/etc., the general photo-editing sense) as an option per item,
not a replacement for multiply.

**Decision:** realladygrey surveys and proposes a shortlist herself — Shyam
has no specific modes in mind, just multiply-only feeling limited.

Scope for that survey: which blend modes actually make sense over a
`MeshStandardMaterial`'s flat base color (some photo-editing blend modes
don't have a clean single-color equivalent — they assume a full image, not
a flat tint, so the shortlist should explicitly note which common modes
were excluded and why), and whether this needs a per-item `tintBlendMode`
schema field (`z.enum`, same optional/no-version-bump shape as `tintColor`)
with a `<select>` next to the existing color picker in `ImportPanel.tsx`'s
`TintRow`.

### 11. Docked object editor — reposition near the object (extends §6) — RESOLVED, scope set

`ObjectInspector` is currently fixed bottom-left
(`ObjectInspector.css`'s `.object-inspector`, `position: absolute; left:
var(--space-24); bottom: var(--space-24)`). Shyam wants it positioned
relative to the selected object instead — above/below/beside it in
viewport-space — so the editor visually anchors to what it's editing
rather than sitting in a fixed HUD corner.

**Decision: clamp on-screen.** When the object goes off-screen or near a
viewport edge, the editor clamps back into the visible viewport rather than
hiding/fading — it should always stay reachable while the item is selected.

Still needs the object's *screen-space* position (project the item's world
position through the camera each frame, `THREE.Vector3.project()`), not
just a CSS anchor. Worth a short proposal on the exact anchor rule (which
side of the object it prefers — above? nearest free screen edge?) and the
clamp margin, before building.

### 12. Walk-mode collision prevention — RESOLVED, scope set

Walk mode (`walkCamera.ts`) currently has **no collision at all** — WASD
movement is unclamped, so you can walk straight through furniture and walls
today. Shyam wants it to feel like actually walking through the space —
i.e., collide with placed items and walls, not pass through them.

**Decision: hard stop for v1.** Slide-along-the-wall (the usual FPS feel)
is explicitly deferred — build the simpler hard-stop version first, revisit
sliding only if the hard stop actually feels bad in practice.

The room already has the AABB machinery this needs
(`src/scene/collision.ts`'s `itemFootprintAABB`/`wallFootprintAABBs`/
`aabbOverlap`), built for drag-placement collision checks — the walk-mode
build should reuse those, not build a second collision system. The new part
is per-frame clamping of the *camera's* position against those same AABBs
(with some eye-radius buffer so the camera doesn't clip flush against a
surface) — this can go straight to a build now that the collision response
is decided, no separate proposal needed.

### 13. Top-down HUD minimap (early/lite version)

A game-style minimap: a simple top-down 2D overlay showing furniture as
boxes and the camera's position/facing, visible in **both** orbit and walk
mode. Explicitly scoped as an early/lite pass — no renders, no textures,
just shapes — with richer HUD/space-UI treatment deferred to later.

This is genuinely cheap to build a first version of: the room/furniture
footprint data already exists (`buildScene.ts`'s `furnitureFootprint`,
`Room.floor`) and a top-down 2D projection is simpler than anything Three.js
already does here — likely a `<canvas>` or absolutely-positioned `<div>`s
in a fixed HUD corner, redrawn from the same `sceneFile.items`/`room` data
Viewport already has, plus the live camera x/z/facing angle. No proposal
needed — this can go straight to a small build; flag scope explicitly as
"boxes + camera dot, no polish" so it doesn't quietly grow into §5's kind of
open-ended reskin work.

### 14. Expose the import flow from the object editor (extends §6/§7-ImportPanel)

Right now, fixing a bad import means leaving the docked `ObjectInspector`,
switching to the **Import** tab, re-selecting the same item from its picker,
and re-running the photo → confirm-dims flow (`ImportPanel.tsx`). Shyam is
asking whether that re-import entry point should also be reachable directly
from `ObjectInspector` while the item is already selected in the viewport —
skipping the tab switch and re-selection step.

Plausible shape: a "Re-import" affordance in `ObjectInspector` that hands
off to `ImportPanel`'s existing `confirm-cost`/`generating`/`confirm-dims`
stages (already built, tested, and item-aware via `dimsOf`/
`furnitureOverallDims`) rather than duplicating that flow — this is a UI
entry-point/routing question, not new import logic. Worth a quick proposal
on where that hands off to (switch tabs programmatically + pre-select the
item vs. inlining the stages into the docked panel itself) before building,
since inlining risks duplicating state ImportPanel already owns.

## Proposal decisions — improvements-v2.2 §3 and §7's research docs

Shyam reviewed both `docs/proposals/*.md` research-and-propose docs from
v2.2 and made the call on each (2026-07-22):

- **`multi-joint-objects.md` (§3) — deferred, not built.** There is one
  object in Shyam's room this could arguably apply to, but not worth the
  build cost the proposal lays out right now. No schema work starts. The
  document stays in the repo as the reference to return to if a real object
  later justifies it — whoever picks it back up should re-read that
  proposal rather than re-deriving the "why a generated GLB can't be
  jointed" reasoning from scratch. Status line in the file itself updated
  to reflect this.
- **`object-categories.md` (§7) — approved for build, schema-only.** Add the
  `category` field exactly as scoped in the proposal (optional
  `z.enum(...)`, both furniture branches, no version bump, no rendering/
  behavior change). The lamp point-light feature (§4b) this unblocks is
  **not** part of this approval — that's a separate, not-yet-scoped future
  item; this just lands the tag so it exists when that work starts. Status
  line in the file itself updated to reflect this.

## Sequencing note (v2.2)

§9's location/time-of-day lighting still needs a research-and-propose pass
before implementation (same treatment as v2.1 §5's handle-reskin and v2.2
§3/§7's original research items) — scope/UI decided by Shyam, but the
solar-math survey and concrete input design still need to come back as a
proposal before building. §10's blend-mode survey is realladygrey's to
scope and propose a shortlist for. §11's reposition and §14's re-import
entry point are each a proposal-then-build, not pure research (the "what"
is clear, the "how" needs a short design pass). §12 (walk-mode collision)
and §13 (minimap) can now go straight to a build — no proposal step needed,
collision response and minimap scope are both decided. The `category`
field (§7's proposal, above) is also approved straight to build. §8 needs
nothing further. `multi-joint-objects.md` (§3's proposal, above) is
deferred — no action until Shyam reopens it.

---

## Follow-up round — 2026-07-22 (same-day additions)

### 15. SONDEROD rug texture import — still broken (revisits v2.2 §1)

`improvements-v2.2.md` §1 flagged this and deliberately left it untouched
pending a repro from Shyam ("do not assume it's the same issue" as the
historical square-pixel bug `computeFlatTextureFit`/`Viewport.tsx` already
fixed — see that section for the prior bug's details). Shyam confirms it's
**still broken** — he expected it to already be fixed, because he'd seen
renders that appeared to show it working, but **he has never personally
exercised the import in the running app** — so those renders may have been
against a different code path, a stale build, or simply not the same
failure he's hitting live.

**Still blocked on the same thing v2.2 §1 asked for: an actual repro from
Shyam.** realladygrey needs, from Shyam, before diagnosing further:
- Which image file (the actual SONDEROD photo he's uploading).
- Which step it fails at (upload, tileable-pipeline processing, or
  render/placement).
- The exact failure — a thrown error / console message, vs. it "succeeding"
  but rendering visibly wrong (wrong orientation, stretched, blank/
  untextured, etc.).

Do not assume this is the same root cause as the historical bug just
because it's the same item — confirm from the actual current symptom.

### 16. Bookshelf reimport — confirmed working (no action needed)

Shyam successfully reimported the bookshelf and fixed its orientation/shape
using the current import/edit flow. Logged as a positive confirmation that
the re-import path (`ImportPanel.tsx`'s existing-item re-import,
`applyImport.ts`'s `existingIdx >= 0` branch) and the §6 edit flow both work
end-to-end for a real item — no fix needed, just a data point that this
flow is solid.

### 17. Switchable camera lenses (new)

Shyam wants the ability to switch between camera lenses (FOV presets) while
viewing the room — not just the current fixed `HUMAN_FOV = 38` (~35mm-
equivalent, `Viewport.tsx:65`) used for the live orbit/walk camera.

Partial infra already exists: `CameraPositionSchema` already carries an
optional `fovDeg` per **saved** viewpoint (`Viewport.tsx`'s
`applyCameraPreset` reads `preset.fovDeg ?? HUMAN_FOV`, and
`getCurrentView()` reports the live `camera.fov` back out) — so fov is
already a first-class per-viewpoint value, just not exposed as a live,
in-the-moment control. What's missing is a HUD affordance to change the
*current* camera's fov on the fly (a lens picker — e.g. wide/normal/tele
presets, or a slider), independent of recalling a saved viewpoint. Worth a
short proposal on preset values (a small named set like "wide/normal/tele"
vs. a continuous slider) and where it lives in the HUD (`ViewportChrome.tsx`
alongside the other viewport-level controls seems the natural home) before
building.

### 18. Shell texturing import flow — preview + microcopy (extends Phase 3 / ShellPanel)

Two related asks about `ShellPanel.tsx`'s surface-photo import flow:

- **No preview before committing.** `SurfaceRow`'s `handleFile` runs the
  uploaded photo straight through `photoToTileableBlob` → `putAsset` →
  `onChange` (an immediate commit, `ShellPanel.tsx:50-63`) — the very first
  time Shyam sees the tiled result is already live on the real wall/floor/
  ceiling in the viewport. He wants to **preview** what a photo (especially
  his own CC0 textures, not just his own surface photos) will tile like
  before committing it to the actual room shell.
- **Sliders need microcopy.** Repeat X/Y and Roughness (`ShellPanel.tsx`
  lines 104-142) are bare labels + a live numeric readout — no explanation
  of what they visually do. Wants an info-tooltip with brief microcopy per
  slider (e.g. what "repeat" means for a tiled texture, what raising/
  lowering roughness looks like).

Worth a short proposal rather than a blind build: the preview needs its own
small isolated render (same shape as `ObjectPreview3D.tsx` from §6 — a
tiny standalone Three.js viewport rendering a flat tiled plane with the
candidate texture/repeat/roughness, not the real room), so it doesn't
commit anything until confirmed. Tooltip mechanism (native `title`, a
small custom tooltip component, or reusing whatever `DESIGN.md`/`cohere/
DESIGN.md` specify for this) should be decided once, then reused for every
slider needing one — not one-off per slider.

## Sequencing note (follow-up round)

§15 (rug bug) is blocked on Shyam providing a repro — same as before,
nothing for realladygrey to do until that lands. §16 needs no action. §17
and §18 each want a short proposal (preset/slider shape for §17; preview-
render approach + tooltip mechanism for §18) before building, same
proposal-then-build treatment as §11/§14 above.

---

## Build round — 2026-07-22 (this PR)

**Built directly** (decided scope, no proposal gate): §4 (walk-mode crouch/
"sit" key — `C`, instant snap to 120cm), §12 (walk-mode hard-stop collision,
30cm eye-radius buffer, reusing `collision.ts`'s AABB machinery), §13
(top-down HUD minimap, boxes + camera dot, bottom-right corner), §2 + §1
(icon-sizing system — 16px inline / 20px standalone, codified in `DESIGN.md`
§6 and `tokens.css`, applied to `ViewportChrome.tsx`/`LayoutChrome.tsx`/
`App.tsx`, resolving §1's misalignment as a side effect), §7 (sidebar panel
titles bold via a new `--text-feature-heading-bold` token, weight 600 —
`.app-title` left untouched), and the approved `category` schema field from
`object-categories.md` (now marked built).

**§6 audit done, findings reported, not fixed** — comparing `DESIGN.md`
against `cohere/DESIGN.md` surfaced 9 gaps beyond icon sizing (notably: a
live contradiction where `ObjectInspector.css` already uses a blurred
box-shadow the docs both say not to use; ~30 hand-picked font sizes because
`DESIGN.md`'s type scale is missing Caption/Micro roles that `cohere/
DESIGN.md` defines; no motion/transition system in either doc; and a direct
tension with §7 above — Cohere's own typography principles say "avoid heavy
bold weights," which is why §7's fix used 600 rather than 700). Full list in
the PR description — needs a scope call from Shyam, nothing auto-applied.

**Researched, proposal docs written, NOT built** — each needs Shyam's call
before implementation, per this doc's own sequencing notes:
`docs/proposals/keyboard-cheatsheet.md` (§3), `reimport-entry-point.md`
(§14), `object-inspector-anchor.md` (§11), `camera-lens-picker.md` (§17),
`handle-reskin.md` (§5), `shell-texture-preview.md` (§18),
`location-lighting.md` (§9), `tint-blend-modes.md` (§10).

**Still blocked** — §15 (rug bug repro still not provided). **No action
needed** — §8, §16 (unchanged from prior round).

---

## Review round — 2026-07-22 (Shyam tests PR #27, calls made on all 8 proposals)

Shyam manually tested the build-round items and reviewed all 8 proposal
docs plus the §6 DESIGN.md audit. Feedback below; nothing in this round has
been built yet — this is the punch list for the *next* round.

### 12 (revisited). Walk-mode hard-stop collision needs a rethink — not just polish

Confirmed problem, not a nitpick: the whole-frame hard-stop makes tight
spaces hard to navigate, and the floor rug (`sonderod-rug`) is itself
colliding — you can't walk near it at all. **Decided: do both of the
following**, not either/or:

1. **Exclude flat floor coverings from collision entirely.** Rugs shouldn't
   block walking in real life. The `category` field shipped this same PR
   (`docs/proposals/object-categories.md`) already tags `sonderod-rug` as
   `category: "rug"` — `allItemFootprintAABBs()` (`Viewport.tsx`) should skip
   any item whose `category === "rug"` when building the walk-collision
   AABB list. (Room-shell walls presumably stay collidable — only rug/flat-
   covering *furniture items* are meant to fall out, not the walls
   `wallFootprintAABBs` already covers.)
2. **Replace the whole-frame hard revert with axis-independent sliding.**
   Check X and Z movement separately (not just revert the entire XZ step on
   any overlap) so brushing a wall or item on one axis doesn't freeze
   movement on the other — the standard "slide along the surface" collision
   response `walkStepCollides`'s own header comment already named as the
   deferred alternative to the v1 hard-stop scope. This is the harder half
   of the two fixes; `walkCameraFootprintAABB`/`walkStepCollides`
   (`walkCamera.ts`) will need per-axis variants or an equivalent refactor,
   not a one-line change.

### 3. Keyboard cheatsheet — approved for build

Mode-toggle key is **`V`**, not `M` (this doc's proposal recommended `M`;
Shyam picked `V`). Build **both** the cheatsheet overlay and the revived `L`
hint pill (open question 1: do both, not one or the other). Build the
shared `SHORTCUTS` table (§4.3 of the proposal) as both `onKeyDown` and the
`?` overlay's source of truth. The `?` cheatsheet stays anchored in the
existing bottom-center HUD pill group — no new HUD position.

**New scope added at review, not in the original proposal:** the global
"Lock all" HUD button (`ViewportChrome.tsx`) needs to reflect real lock
state. Today it only tracks its own toggle flag (`globalLock`); if items get
individually locked via the `L` key independent of that button, the button's
"Lock all"/"All locked" label can silently go stale relative to what's
actually locked. Fix: derive the label from whether every item is currently
locked, not from a separately-tracked boolean.

See `docs/proposals/keyboard-cheatsheet.md`'s updated status line for the
full detail.

### 14. Re-import entry point — approved for build

Go with the proposal's own lean on both open questions: switching to the
Import tab via "Re-import" leaves `ObjectInspector` open behind the sidebar
(doesn't deselect the item); icon is `RefreshCw`. See
`docs/proposals/reimport-entry-point.md`.

### 17. Camera lens picker — approved for build, scope corrected

Shyam's ask was **focal-length presets, not FOV**: **Wide 24mm / Normal
35mm / Tele 85mm**, shown to the user by focal length only — the UI must
never surface a degree value. This is a change from the proposal doc's own
55°/38°/20° FOV-degree preset table; whoever builds this needs to re-derive
each preset's actual `camera.fov` from its 35mm-equivalent focal length
(check `HUMAN_FOV = 38`'s existing "~35mm-equivalent" derivation in
`Viewport.tsx`/`walkCamera.ts` first, so the three new presets and the
existing default share one sensor-format convention rather than inventing a
second one). See `docs/proposals/camera-lens-picker.md`.

### 5. Handle reskin — approved for build

**Option B** (shape + palette reskin) confirmed. The three smaller open
questions (Coral on hover vs. drag-only; document handle colors in
`DESIGN.md`; align collision-red to the documented Error hex or keep the
brighter one) weren't explicitly revisited — proposal's own recommended
leans carry forward unless corrected at build time. See
`docs/proposals/handle-reskin.md`.

### 18. Shell texture preview — approved for build, scope corrected

**P-2** (narrow draft — preview gates only the *photo*, not the whole
calibration), overriding the proposal's own P-1 recommendation. Remaining
open questions (defer `putAsset` to Confirm; tooltip mechanism T-1 vs. T-2;
inline vs. larger preview) weren't explicitly revisited — proposal's leans
carry forward unless corrected at build time. See
`docs/proposals/shell-texture-preview.md`.

### 9. Location-driven lighting — approved for build

**Hour + date**, confirming the proposal's own recommendation — date
defaults to today. See `docs/proposals/location-lighting.md`.

### 10. Tint blend modes — approved for build, reduced scope

Ship **multiply + screen only** this round (both free on the flat/
placeholder-box path); overlay/soft-light/darken deferred to a follow-up,
not dropped. See `docs/proposals/tint-blend-modes.md`.

### 11. ObjectInspector anchor — not addressed this round

Shyam didn't review this one in this round (the only one of the 8 proposals
without an explicit call) — status in `docs/proposals/object-inspector-anchor.md`
is unchanged: direction decided, implementation-detail open questions still
open. Flag for Shyam next time rather than assuming an answer.

### §1/§2 (icon placement) — reopened, still unresolved

The size fix landed this PR, but Shyam says icon *placement* within their
buttons still looks "weird" — unlike the size question, this one has no
diagnosed root cause yet. Likely candidates worth checking first: button
padding/centering box not accounting for the icon's actual visual bounding
box (Lucide icons have internal padding that varies slightly by glyph), or
the `--space-8` icon-to-text gap reading unevenly against different icon
shapes. Needs actual visual inspection in the running app before guessing
further — not a decision Shyam can make in the abstract, a bug to
diagnose next round.

### 15. SONDEROD rug bug — repro obtained, ready to diagnose

Photo confirmed: `spike-v2/assets/sonderod-rug-photo.png` (already in-repo
from the spike work) — Shyam confirms this is the exact file he's been
uploading. Item: `sonderod-rug` in `seed/living-room.json`
(`category: "rug"` per the schema field shipped this PR).

**Symptom, precisely:** upload completes with no thrown error and no
console message — but the rug's rendered appearance shows **no change
whatsoever**, not a distortion/stretch/wrong-orientation bug. It reads as a
no-op: either the new texture never gets applied to the material, or it's
being applied but is visually indistinguishable from whatever was already
there (worth checking both).

**Also confirmed:** Shyam has personally exercised this in the running app
and it has never worked for him live — the earlier renders that looked
correct were from separate test worktrees/branches, not this app running
end-to-end, so don't assume those prove any current code path works. Ready
to diagnose next round with this repro in hand — no further info needed
from Shyam first.

## Sequencing note (review round)

Everything above except §11 (not reviewed) and §15 (diagnosis, not a
proposal) is now approved straight to build — no further proposal gate.
Suggested order for whoever picks this up: §15 (rug bug) and §12's
collision rethink first (both are regressions/bugs affecting the app today,
not new features), then the approved proposals in whatever order is
convenient, then circle back to Shyam for §11 and the icon-placement
diagnosis.
