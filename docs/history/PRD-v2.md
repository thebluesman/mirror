# PRD v2 — Home Digital Twin: Arrangement

**Status:** Draft, 2026-07-22. Written from `spike-v2/OUTCOME.md` (net **GO**,
closed 2026-07-22), the same way PRD-v1 was written from OUTCOME-3. Scope:
arrangement (move, rotate, replace, collision, snapping, multi-layout), the
quality items the v1 acceptance run pulled in (rug — already fixed and merged;
shell tiles — deliberately deferred into this build), and the Hunyuan3D
provider swap's build work (ADR-0002). Measurement stays v3 — see §5.

## 1. Problem

v1 answers "what does my room look like?" — and the acceptance verdict was
"passable, just clears the minimum requirements." What it can't answer is the
question that actually drives furniture decisions: **"what would my room look
like arranged differently — and can I trust the comparison enough to act on
it?"** In v1, placement is frozen at the one-time Figma-seeded positions;
fixing even a wrong-facing sofa required re-running a manual conversion
session. v2 makes the room *rearrangeable*: move and rotate items directly in
the viewport, see collisions and snap to walls, keep multiple named layouts,
and swap an item's asset without losing its place.

## 2. Background — what the v2 spike validated

The v2 spike (`v2-spike-plan.md`, outcomes in `spike-v2/OUTCOME.md`) ran three
workstreams. All three cleared their bars:

1. **W-A — Arrangement interaction: GO (upgraded from go-with-constraints
   after the rotate-handle follow-up).** Move (floor-plane drag), rotate
   (drag handle + 15° keyboard step), collision flagging (AABB footprints,
   item-vs-item and item-vs-wall), escapable snapping (Shift disables),
   replace via re-import, and named layouts (save/switch/reload) are all
   decision-grade, judged by Shyam driving his real room data at C1.
2. **W-B — Render quality: rug fixed and merged (PR #11); shell tiles
   deferred here deliberately.** The rug bypasses mesh generation entirely —
   a flat textured plane mapped 1:1 from the source photo (three C2 rounds:
   texture quality, orientation, crop — all closed, "yes much better").
   The shell-tile ladder was not attempted in the spike, by Shyam's call
   (2026-07-22): it carries into this build as scoped work, not a dropped
   finding — see §7.5.
3. **W-C — Generation provider: Hunyuan3D adopted (ADR-0002).** Hunyuan wins
   significantly on quality *under the app's own lighting* (settling the
   viewer-flattery risk) and is cheaper (~$0.53–0.68/generation vs. Meshy's
   ~$0.80). Full swap, no Meshy fallback. The ADR is the decision; the code
   change (`src/import/falClient.ts` still calls Meshy's endpoint/schema) is
   v2 build work — see §7.3.

**One structural difference from v1's spike lineage, worth stating plainly:**
unlike spikes 1–3 (throwaway evidence scripts), most of W-A's code merged to
`main` during the spike after hands-on passes (PRs #10, #11, #12). v2's build
therefore starts from working, reviewed, tested code already in the app — the
build scope below is hardening, gap-closing, and the deferred pieces, not a
from-scratch implementation of arrangement.

## 3. Goals (v2)

- **Arrange the real room in-app**: select, move, rotate, with collision
  flagging and escapable snapping — decision-grade per the spike's C1 bar.
  (Core shipped via spike merges; v2 closes the named gaps in §7.)
- **Multiple named layouts**: save the current arrangement, switch between
  layouts, survive reload. (Shipped; v2 adds rename — §7.2.)
- **Replace any item's asset** via re-import while keeping placement, scale,
  and identity. (Shipped; v2 points it at Hunyuan and fixes default
  placement for genuinely new items — §7.3, §7.4.)
- **Sane default placement on fresh import** — a newly imported item must be
  visible, never silently at the room origin inside a wall. This is a
  *confirmed* acceptance criterion, not a hypothesis: D0 traced the v1
  "TV not showing" report to exactly this gap.
- **Retire the shell-tile complaint** (acceptance feedback #5) via the
  deferred W-B ladder — §7.5.
- **Flat-texture items get a real import path** — the rug fix currently has
  no UI; adopting it for real requires a small upload affordance — §7.6.
- **Lift an item off the floor** — a minimal elevation control on the
  selected item (writes `elevationCm`), for the C1 lamp-over-bookshelf case.
  Decided 2026-07-22 (§11.1) — §7.8.
- **Undo the last arrangement action** — a single-step undo over the
  existing `commands[]` shape. Decided 2026-07-22 (§11.3), reversing this
  draft's original "defer again" recommendation — §7.9.

## 4. Non-goals (v2)

- **Measurement (v3)** — clearance/distance overlays. Depends on v2's
  placement model, now real; still not pulled forward.
- **General physics, tilt, free 3D transform** — placement stays floor-plane
  + yaw + the one elevation scalar decided in §11.1 (§7.8); no free vertical
  dragging, no stacking physics.
- **Top-down 2D arrange mode** — the spike's named fallback was never
  needed; C1 passed on direct 3D manipulation. Stays in reserve.
- **Multi-state furniture** — the spike's multi-view probe was inconclusive
  by its own admission (no genuine back/side photo available). Feasibility
  plumbing works; the feature stays unscoped (§11.5).
- **Meshy fallback** — per ADR-0002, no fallback path. A future revival is a
  new ADR.
- **Multi-room, sharing, accounts** — unchanged from v1.

## 5. Users

Single user (Shyam), personal use, own home. Unchanged from v1.

## 6. Core flows

1. **Arrange** — click an item to select (outline + rotate handle); drag on
   the floor plane to move; drag the handle or use `q`/`e` (15° steps) to
   rotate — handle-drag snaps to the same 15° steps by default, Shift held
   frees it; a small elevation control on the selection (keyboard step /
   numeric field) raises or lowers the item via `elevationCm`; outline turns
   red on item/wall overlap; snapping pulls to wall-abutment and
   edge-alignment within 8cm, Shift held disables it. Placement commits to
   the current layout on release and autosaves. Undo reverts the last
   committed action (§7.9).
2. **Layouts** — a top-center pill bar: save the current arrangement under a
   name, switch by clicking, delete (guarded — never the active/last one),
   rename (new in v2). Each layout owns its own placement commands;
   switching is a full scene rebuild by design.
3. **Import / replace** — unchanged v1 flow shape (photo → generate →
   confirm cm dims → rescale + floor-snap), now generating via Hunyuan3D
   (`fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, per ADR-0002). Any item can be
   re-imported to replace its asset, with a warning; placement, scale, and
   identity survive the swap in every layout. A genuinely new item lands at
   a visible, sane default placement — not the origin.
4. **Flat-texture items** — for rug-class items (flat, pattern-is-the-point),
   upload a straight-on photo mapped 1:1 onto the item's real footprint
   (content-box crop + orientation detection, per D4), bypassing mesh
   generation. Small per-item upload control mirroring `ShellPanel.tsx`'s
   pattern.
5. **Shell texturing** — v1 flow unchanged, but the source textures improve
   via the §7.5 ladder so floor/wall/ceiling stop reading as obvious tiles.

## 7. Build scope

What actually gets built, given the spike merges. Roughly ordered.

### 7.1 Arrangement hardening (from the spike's carried-forward edges)

The spike surfaced these deliberately (`OUTCOME.md`, "carried-forward rough
edges" + per-section deferrals). Each is either fixed in v2 or explicitly
accepted below:

- **Fix:** `applyFurnitureImport`'s default-placement logic only checks
  `sceneFile.current` and is untested against a non-default active layout —
  must behave sanely (and be tested) when importing while any layout is
  active. Pairs with the D0 default-placement criterion (§3).
- **Fix:** the placement-reconciliation effect's silent `if (!group) return`
  — revisit now that layout-mutating paths exist beyond import (the exact
  condition the spike said to re-examine "when those land").
- **Fix:** factor the four copies of "find current layout, edit commands,
  setSceneFile + saveProjectNow" into one helper (`commitPlacement`,
  `handleImported`, `handleSaveView`/`handleDeleteView`, `applyImport.ts`)
  — the spike deferred this until persistence work touched them all; v2 is
  that moment.
- **Fix (small):** snapping's wrong-direction edge case (an item already
  inside a wall's thickness band can snap to the wall's far face); drag-path
  hot-loop cleanups (`getBoundingClientRect` per pointermove).
- **Accept, monitor:** collision/snap recompute is O(items) per pointermove
  — fine at ~13 items; revisit only if the real room makes it noticeable.
- **Accept:** wall AABBs don't subtract door/window openings — no current
  placement hits it; fix only if a real arrangement does.
- **Polish (C1-deferred, in scope here):** rotate-handle grab-target sizing
  (camera-relative); handle-drag snaps to the same 15° steps as the
  keyboard shortcut by default, Shift held frees it (decided 2026-07-22,
  §11.4); hover/cursor affordances for drag and handle; an explicit revert
  on pointer-cancel; and a deliberate keyboard-focus ownership model for
  viewport shortcuts.

### 7.2 Layout rename

Save-as-new is currently the only path to a name change. Add in-place rename
for layouts — and, since it's the same gap and the same pill-bar pattern, for
saved camera viewpoints too.

### 7.3 Hunyuan provider swap (the ADR-0002 consequence)

Swap `src/import/falClient.ts` / `applyImport.ts` from Meshy's endpoint and
schema to Hunyuan3D's confirmed live schema: `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`,
`input_image_url` in, `model_glb.url` out (already `GLB_URL_CANDIDATES`' #2),
`enable_pbr` on. Single-photo import only — the endpoint's multi-view fields
exist but stay unused (§11.5). One open verification carried from the spike:
D5's live calls ran from Node, so the literal browser-tab CORS check ADR-0001
did for Meshy should be repeated once, first, before the rest of the import
flow work (expected to pass — same fal platform/client — but expected ≠
verified, per the project's own discipline).

### 7.4 Default placement for new imports

The D0-confirmed criterion (§3), concretely: a new item with no seeded
placement gets a visible position (e.g. open floor near the room center,
nudged to avoid collisions using the existing footprint math), with
`elevationCm` accounted for — never `[0,0,0]` at the origin corner.

### 7.5 Shell-texture ladder (deferred from W-B, scoped here)

Same lever discipline as every quality pass (one iteration per lever, no
loops), same bar as the spike plan set: at the two standard views,
floor/wall/ceiling no longer read as obvious tiles, judged by Shyam against
the same reference photos as C2. Levers, in cost order per the original plan:

1. Better CC0 source textures (Poly Haven / ambientCG) calibrated to Shyam's
   surface photos via the existing tint/repeat calibration UI.
2. An agent-driven pass on the photo-derived textures in `src/texturing/`
   — better tileability (seam removal, larger effective tile), de-lighting,
   higher-res input.

Ordering decided in §11.2 (CC0-first); fail = record what was tried and cap
expectations, same as the spike plan's rule.

### 7.6 Flat-texture import UI

A per-item "use flat photo texture" upload control (mirroring
`ShellPanel.tsx`'s per-surface upload pattern) that stores the photo in OPFS
and sets `flatTextureHash` — replacing the current only-path of hand-editing
the persisted project record. Box items only, per the spike's schema
decision.

### 7.7 Content debt, not code

The bookshelf's structural defect (cubbies on the narrow end, no backboard)
reproduces on both providers — it's the source photo. The fix is a re-shoot
and re-import through the §7.3 flow, tracked as content work for Shyam, not
build scope.

### 7.8 Elevation control (from §11.1)

A minimal control on the selected item writing `elevationCm` — already
modeled in the schema and seed data, unused until now. Keyboard step and/or
a numeric field in the selection UI, mirroring the existing rotate-step
affordance. No free vertical dragging, no stacking physics: floor-plane XZ +
yaw + this one elevation scalar is the complete v2 placement model.

### 7.9 Undo (from §11.3, reversing the draft's original recommendation)

Shyam wants an undo control in v2 rather than deferring it again. Scoped as
**single-step undo**: a button (plus keyboard shortcut) that pops the last
committed command — move, rotate, elevation change, replace, or
layout save/delete/rename — off the active layout's `commands[]` and
rebuilds the scene from what remains. Multi-step history and redo are open
implementation questions for the build phase, not decided here; start with
the single step Shyam actually asked for and extend only if he wants more
once he's using it. This is the one item in this build with no spike
de-risking behind it — treat its estimate accordingly (§12).

## 8. Architecture

Deltas from v1 only — everything else (browser-only, Vite + React + Three.js,
JSON project file + OPFS assets + IndexedDB autosave, zip export) carries
forward unchanged.

- **Schema: no migration needed.** The `layouts[]`/`current` branch shape
  authored in v1 survived the spike exactly as designed — named layouts are
  full-copy snapshots recording `base`, read directly by `buildScene()`.
  `flatTextureHash` (box items) is already in from PR #11. Placement stays
  in layout commands, identity on the item, assets by hash — the replace
  flow's cross-layout safety falls out of this separation, as designed.
- **Rendering seam, now proven:** in-place mutation during a gesture,
  commit-on-release to the layout's `PlaceCommand`, structural rebuild only
  on real structural change (items/room/current — not per-frame, not
  per-commit). v2 builds on this seam; it doesn't redesign it.
- **Only network call:** fal.ai Hunyuan3D, per ADR-0002 (amending
  ADR-0001's browser-direct architecture, which is unchanged). Texturing
  and rendering stay local.

## 9. Visual design

`DESIGN.md` remains the base language. Arrangement chrome introduced by the
spike (selection outline, rotate handle, collision red, layout pill bar)
reuses the existing viewport-chrome tokens; §7.1's polish items are refined
within that system, not a new one. No new design surface beyond the small
§7.6 upload control, which follows `ShellPanel.tsx`'s existing pattern.

## 10. Success criteria

v2 is done when Shyam can, for his actual room: rearrange furniture directly
in the viewport and trust what he sees (collision/snap feedback, no silent
misplacement); keep and switch between at least two named layouts across
sessions; import or replace an item via Hunyuan3D end-to-end inside the app;
and no longer list the shell tiles among his issues at the two standard
views. Concretely, the v1 acceptance run's actionable items (#2 orientation,
#3 replace, #4 rug, #5 shell tiles, #8 TV-not-showing) are all retired —
#2/#3/#4/#8 already are via the spike merges and D0's fix landing here;
#5 is this build's remaining quality gate.

## 11. Decisions (resolved 2026-07-22, per Shyam)

This section was "Open questions" in the initial draft — each item carried a
recommendation but was explicitly undecided. Shyam has now ruled on all five;
the resulting scope changes are folded into §3/§4/§6/§7/§12 above, and are
only summarized here for the record.

1. **Vertical placement axis — in scope.** Surfaced as a real want at C1
   (lifting a table lamp clear of a bookshelf collision); explicitly excluded
   from the spike. **Decided: yes**, build the minimal elevation control
   (keyboard step / numeric field writing `elevationCm`) — not free vertical
   dragging, no stacking physics. See §7.8.
2. **Shell-texture lever order — CC0-first confirmed.** Better CC0 source
   textures (lever 1) run before any agent-driven pipeline pass (lever 2);
   lever 2 only if lever 1 fails the bar. No change to §7.5.
3. **Undo/history — in scope, reversing this draft's original "defer
   again" recommendation.** Shyam wants an undo control in v2. See §7.9 for
   the scoped-down (single-step) build and §12 for the estimate impact —
   this is the one build item with no spike de-risking behind it.
4. **Rotate-handle angle snapping — confirmed.** Handle-drag snaps to the
   same 15° steps as the keyboard shortcut by default, Shift held frees it —
   consistent with how translate-snapping is escapable. No change to §7.1's
   existing polish item beyond making the behavior explicit.
5. **Multi-view generation — confirmed out of scope for v2.** Post-v2 is
   fine per Shyam; stays a standalone probe (one deliberately-shot back/side
   photo) if he wants the back-view-fidelity answer later. No change to §4.

## 12. Estimate

PRD-v1 §11's "3–5 weeks once scoped" predated both the scope expansion and
the spike's merges. Re-cut from what's actually left (§7), now including the
§11 decisions that add scope beyond the draft (elevation control, undo):
provider swap + CORS check ≈ 2–3 days; default placement + import-path
hardening ≈ 2–3 days; shell ladder ≈ 2–4 days (hard-capped per lever); rename
+ flat-texture UI + polish batch (incl. rotate-handle default-snap, elevation
control) ≈ 4–6 days; undo (single-step, §7.9) ≈ 2–4 days. **Roughly 3–4 weeks
elapsed**, revised up from the draft's 2–3 given Shyam's undo decision — undo
and the shell ladder are the widest error bars, since neither has spike
de-risking behind it.
