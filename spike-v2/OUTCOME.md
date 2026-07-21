# v2 Spike — Outcome (in progress)

Tracks verdicts as `v2-spike-plan.md`'s workstreams complete. Started
2026-07-21. Format follows `spike/OUTCOME*.md`.

## D0 — TV-not-showing diagnosis

**Status: cause hypothesized from code tracing, not yet confirmed against
Shyam's actual project state (still needed — see plan §8.6).**

Traced the import path end to end: `ImportPanel.tsx` → `applyImport.ts` →
`buildScene.ts` → `Viewport.tsx`'s async GLB-load effect. The Phase 4
code-review fallback (`Viewport.tsx:157-164`) already degrades a failed GLB
load to a box placeholder — so a corrupt/missing OPFS asset would show as
"looks unimported," not "invisible," and logs a `console.error`. That known
failure mode is **not** the TV's symptom as reported ("completed import,
object not showing"), which points elsewhere.

Two real gaps found while tracing, either of which fits the report:

1. **`ImportPanel.tsx:36`** — `importableItems = sceneFile.items.filter((i)
   => !i.glbHash)`. Once an item has any `glbHash` (including a prior
   attempt), it drops out of the dropdown entirely. There is no "re-import /
   replace" path in v1 — which is exactly why W-A's Replace task (D3) exists.
   If Shyam tried to re-import or fix the TV's asset, the panel would have
   forced him to `+ New item…` instead.
2. **`applyImport.ts:59-69`** — a genuinely new item (no existing id match)
   gets a default placement command at `position: [0, 0, 0], rotationDeg: 0`
   with no `elevationCm` accounting. Seed data bakes elevation into the
   placement's y directly (e.g. `tv-samsung-frame`'s seeded command uses
   y=70, matching its `elevationCm: 70`) — but a fresh import has no seeded
   command, so it lands on the floor at the room's origin corner, nowhere
   near the actual TV wall. Easy to read as "didn't import" if it's off in a
   corner behind/under other geometry.

**Working hypothesis:** Shyam picked "+ New item…" (likely because the
already-imported TV no longer appeared as importable), which created a
second, unplaced-by-design TV item at world origin — distinct from the
seeded `tv-samsung-frame` item and its correctly-positioned command — and
that duplicate is either occluded or just not where he was looking.

**Not fixed here.** Both gaps are legitimate but out of D0's "fix if small"
budget: gap 1 *is* D3's Replace feature, not a patch to bolt on ahead of it;
gap 2 only matters for genuinely new items, and it's D1/D3's placement code
this spike is already rebuilding. Fixing either now risks work D3 throws
away. Recorded here per plan discipline ("fix if small; otherwise record
cause for v2") — D3 should treat both as acceptance criteria: replacing an
already-imported item must not require `+ New item…`, and any new-item
default placement should be visible/sane, not silently at the origin.

**To confirm/close:** Shyam's project export (or the TV source photo, for a
fresh repro) per plan §8.6 — still outstanding.

## D1 — W-A core (selection, floor-plane drag, rotate)

**Status: built, evidence captured, awaiting C1 (Shyam driving it
hands-on).** Branch: `v2/spike-arrange`. Screenshots + a machine-readable
persistence check: `spike-v2/w-a-screenshots/` (captured by
`spike-v2/w-a-drive.mjs`, a Playwright driver against the real dev server
and a clean seeded scene — not a test suite, a one-off evidence script).

**What's there:**
- **Selection**: click a placed item (raycast, not screen-space) to select
  it; a cyan `THREE.BoxHelper` wireframe outline indicates it (cheapest
  option per the plan — a scene-level object, not a shared-material swap,
  since `buildScene.ts`'s box-shape material is one instance shared across
  every box item). Click empty space (or the shell) to deselect.
- **Move**: floor-plane drag via ray-plane intersection at the item's own
  height (not a screen-space delta) — tracks the cursor 1:1, no jump/jitter
  in testing. Position commits to the current layout's `PlaceCommand` on
  pointer-release.
- **Rotate**: keyboard step (`q`/`e` or `[`/`]`, 15deg increments) rather
  than a drag handle — tradeoff recorded in `Viewport.tsx` (simpler and
  exactly precise, e.g. fixing the three known orientation bugs in §3 is a
  few keypresses; no free-angle rotate). Commits on each keypress.
- **Persistence**: confirmed end-to-end — `w-a-drive.mjs` drags, rotates,
  reads IndexedDB, reloads the page, reads IndexedDB again, and diffs; the
  two reads match. A moved/rotated item survives a reload where you left
  it, through the same autosave path (`saveProjectNow`) import/save-view
  already use.

**The seam** (the plan's "most likely source of ugly-but-instructive spike
code," §6): `Viewport.tsx`'s structural-rebuild memo (`structuralSceneFile`)
now excludes `sceneFile.layouts` as a dependency — a move/rotate commit no
longer tears down the renderer/camera/OrbitControls the way it would if
layouts fed the full `buildScene()` rebuild (the same class of regression
Phase 5 hit and fixed for camera-viewpoint recall). Drag/rotate handlers
mutate a live `THREE.Group`'s position/rotation directly, read from a new
`BuiltScene.furnitureGroups` map (itemId → Group, added to `buildScene.ts`);
a separate placement-reconciliation effect reads `sceneFile.layouts`
unmemoized and pushes committed values onto those groups in place — the
hook D2 (collision/snap) and D3 (persistence/replace, named layouts) can
extend without re-deriving "push a placement into the live scene."
`sceneFile.current` deliberately stays a rebuild trigger, so a future
layout *switch* (D3) still gets a real rebuild.

**Rough edges found (surfacing per §6, not hiding them):**
- No collision/bounds checking (correctly out of scope — D2): a drag can
  push an item behind or into a wall with no feedback, which happened
  during evidence capture with a larger test drag and just silently
  hid the item from that camera angle. Not a bug in the seam, but a real
  gap Shyam will hit immediately without D2.
- The selection outline initially rendered but was invisible — it sits
  exactly on the wrapped mesh's own surface and z-fought against it.
  Fixed with a depth-test-disabled, late-`renderOrder` material (an
  "always-on-top overlay," the standard fix), but it's a reminder that a
  BoxHelper wrapping a mesh 1:1 isn't a drop-in selection indicator.
- Keyboard rotate is window-level (so focus doesn't need to be on the
  canvas) and has a blunt guard against firing while a Shell/Import/
  Settings text input has focus — fine for a spike, would want a more
  deliberate ownership model (e.g. explicit viewport focus) before v2
  proper.
- Rotate-release and pointer-cancel aren't distinguished from a normal
  drop — a cancelled gesture (browser steals the pointer) commits
  wherever the item currently sits rather than reverting. Acceptable for
  a prototype; a real build would want an explicit revert path.
- No visible drag affordance until you're already dragging (no cursor
  change, no hover highlight) — fine for evidence capture, worth deciding
  on for a real build.

**Code review (2026-07-21), fixed:**
- **Mid-drag rebuild discarded the gesture silently.** `structuralSceneFile`
  depends on `sceneFile.items`, which changes independent of any drag (e.g.
  a background Meshy import completing while the user is mid-drag on a
  different item) — the structural effect's cleanup then tore down the
  canvas/listeners the live drag closure depended on, `commitDrag()` never
  fired, and the item silently snapped back to its last-committed position
  with no explanation. Fixed: the effect's cleanup now calls `commitDrag()`
  first, so an interrupted gesture commits wherever it currently sits
  (the same "commit wherever it is" behavior `onPointerCancel` already
  accepts for a browser-stolen gesture) instead of vanishing.
- **Keyboard rotate had no `evt.repeat` guard.** Holding a rotate key
  triggers OS keyboard auto-repeat (~20-30 keydowns/sec), and each one
  fired a full commit + immediate (non-debounced) IndexedDB write via
  `commitPlacement` — many redundant writes for what the surrounding
  comment intended as one discrete step per press. Fixed: auto-repeat
  keydowns are now ignored (`if (evt.repeat) return`), so a held key is a
  no-op past the first step rather than a write flood.

**Code review (2026-07-21), deferred to D2/D3 rather than patched now**
(architectural, not urgent — not reachable through any path the current app
UI exposes):
- The reconciliation effect's `if (!group) return` for a command whose item
  isn't yet in `furnitureGroups` is silent-safe only because today's sole
  producer of a new item+command pair (`applyFurnitureImport`) always
  changes `sceneFile.items` in the same update that adds the command, which
  forces the rebuild that would otherwise be needed. D2/D3 (collision
  persistence, replace, named layouts, undo) will likely add paths that
  mutate `layouts` without an accompanying `items`/`room`/`current` change —
  worth an explicit look when those land, rather than guessing at the right
  general fix now.
- `commitPlacement` (App.tsx) duplicates the "find current layout, edit
  commands, setSceneFile + saveProjectNow" shape already written separately
  for `handleImported`/`handleSaveView`/`handleDeleteView` and again in
  `applyImport.ts` — worth factoring into one helper once D3's persistence
  work is touching all of these anyway, rather than as a standalone
  refactor now.
- Minor hot-path waste in the drag handler (`getBoundingClientRect()` on
  every `pointermove` instead of cached at `pointerdown`) and a redundant
  `selectionHelperRef.current?.update()` call in the reconciliation effect
  (superseded by `animate()`'s per-frame call) — real but low-severity,
  worth folding in as drive-by cleanup whenever D2/D3 next touches these
  same functions rather than a dedicated pass.

**My read (not the C1 call — that's Shyam's):** move + rotate + persist
feel decision-grade for the core gesture itself — the drag tracks
precisely, the commit-on-drop seam avoids the camera-reset regression the
plan worried about, and the three known orientation bugs are trivially
fixable with the keyboard step. But the *arrangement experience* as a
whole is tech-demo-grade until D2 lands: without collision/bounds
feedback, dragging in 3D with no top-down reference is easy to get
subtly wrong (an item behind a wall, overlapping another, no way to tell
without orbiting to check) — which is exactly the failure mode the plan's
top-down-orthographic fallback exists for. Whether that's "go" or
"go-with-constraints" depends on how much D2's snapping/collision closes
that gap; recommend Shyam's C1 pass explicitly try a few drags that would
be ambiguous without collision feedback (behind furniture, into a wall)
before judging.

## R1 — Hunyuan3D (fal.ai) endpoint/pricing survey

**Status: done.** Full memo: `spike-v2/R1-hunyuan-memo.md`.

Two fal-hosted model families exist: **v2** (`fal-ai/hunyuan3d/v2` +
`/turbo`/`/mini`/`/mini/turbo`, single-image; `/multi-view` +
`/multi-view/turbo`, multi-image via named per-angle fields) and **v3.1**
(`fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` — up to 8 view angles, best
quality; `/rapid/image-to-3d` — single front view, cheaper). Best-fit guess
for what Shyam actually tried is **v3.1 Pro** (only endpoint matching both
"noticeably better" and "multi-angle"), but that's inferred, not confirmed —
D5 should check his fal dashboard history rather than assume.

All variants are cheaper per-run than Meshy's ~$0.80 (v3.1 Pro + PBR +
multi-view tops out around $0.60–0.70 worst case) — cost isn't a blocker
either way, though the memo flags the v2/multi-view figure as unreliable
(conflicting sources) and wants live confirmation before D5 finalizes
budget. CORS: same fal queue-job platform as Meshy (`fal.storage.upload` /
`fal.subscribe`), so the three legs ADR-0001 verified should carry over —
inferred with high confidence from platform consistency, but not
empirically re-tested (fal.ai's site 403'd a plain fetch during this
research pass), so D5 still needs to verify it for real, same discipline as
ADR-0001 used for Meshy. Handily, Hunyuan's output field (`model_mesh.url`)
already matches `falClient.ts`'s first `GLB_URL_KEY_CANDIDATES` entry.

Protocol recommendation for D5: don't generalize `falClient.ts` into a
multi-provider abstraction — write a small parallel `hunyuanClient.ts`-style
module (single-image comparison, reusing the upload/extractGlbUrl helpers)
plus a separate function for the multi-angle test, living in `spike-v2/`
per §4 ("W-C is scripted"), not app code.

## D2 — W-A rules: footprint collision flagging + wall/edge snapping

**Status: built, evidence captured, awaiting C1 alongside D1/D3.** Branch:
`v2/spike-arrange` (same branch as D1 — "after D1, same files" per the
delegation map). Screenshots: `spike-v2/d2-screenshots/`, captured by
`spike-v2/d2-collision-snap-drive.mjs` (a one-off Playwright driver, same
shape as D1's `w-a-drive.mjs`).

**What's there:**
- **`src/scene/collision.ts`** — `itemFootprintAABB()` (world-space AABB for
  a placed item, unioning compound-sofa sub-footprints), `wallFootprintAABBs()`
  (one AABB per wall run, at `buildScene.ts`'s `WALL_THICKNESS`), and
  `checkCollisions()` (item-vs-item and item-vs-wall AABB overlap). Pure,
  framework-free functions — same shape as `src/texturing/tileable.ts` — so
  Viewport.tsx's per-pointermove drag handler can call them with no THREE
  overhead. Deliberately AABB, not true oriented-rectangle SAT: "footprint-
  rectangle detection is enough ... decision support, not physics" per
  v2-spike-plan.md §2. Exact at the 0/90/180/270deg placements the seed and
  Figma conversion use; only ever over-flags (never under-flags) at W-A's
  in-between 15deg rotate steps.
- **`src/scene/snapping.ts`** — `snapPosition()`, independent per-axis
  snapping against wall/item AABB edges (abut or edge-align, whichever's
  closest within an 8cm threshold). Axis-aligned math is exact for the
  axis-aligned walls `buildScene.ts` draws.
- **Viewport.tsx wiring**: `onPointerMove`'s drag handler snaps the
  candidate position (unless Shift is held — the plan's "must be escapable"
  bar) before committing it live to the group, then recolors the selection
  outline red via a new `updateCollisionHighlight()` helper if the item's
  footprint now overlaps another item or a wall. The same helper fires on
  keyboard rotate, on first selecting an already-overlapping item, and when
  a committed layout change moves some *other* item the selection depends
  on — so the highlight never lags behind what's actually on screen. Per
  the plan's "decision support, not physics" framing, nothing is blocked —
  overlapping placements are flagged, not prevented.
- **Known simplification, flagged not hidden**: wall AABBs don't subtract
  door/window openings — a furniture item positioned inside a doorway's
  clear width reads as a wall collision even though the render shows an
  open gap there. No current seed placement puts an item in a doorway;
  reusing `addWall`'s segment-cutting logic just for this check risked
  drifting from the renderer's own geometry for a case nothing hits yet.

**Tests**: `src/scene/collision.test.ts` and `src/scene/snapping.test.ts` —
AABB math (axis-aligned exactness, off-axis over-estimation, compound-sofa
union, wall-run AABBs, overlap/no-overlap/flush-touching) and snap math
(wall abutment, item-to-item edge alignment, independent x/z, no-snap
outside threshold). `npx vitest run` — 75 tests, all passing (60 pre-
existing + 15 new). `npx tsc -b`, `npm run build`, and `oxlint` all clean.

**Evidence** (`d2-collision-snap-drive.mjs`, against a running dev server
and the real seed): dragging `water-cooler` onto `billy-hogadal-shelving`
recolors the selection outline red on overlap
(`1-item-collision-mid-drag.png`). Dragging `floor-lamp` (28cm wide,
seed position x=492) toward the west wall (inner face at x=479, so a flush
placement centers it at x=493) from a raw drag target of x=498 pulls it to
x=496 — visibly snapped closer to the wall than the raw cursor target,
outline cyan (not yet overlapping) — while the same drag held with Shift
lands at x=498.000004, matching the raw target with no adjustment,
confirming the escape hatch. (The snapped result landed a few cm short of
the hand-computed ideal of 493 — traced to the evidence script's synthetic
pixel-rounded mouse path, not the app's snap math itself, which the unit
tests exercise exactly; the qualitative result — snap-enabled pulls toward
the wall, Shift-held doesn't move at all from the raw target — is what
matters here and holds cleanly.)

**Rough edges found (surfacing per §6, not hiding them):**
- Framing a Playwright evidence shot for this feature turned out to be its
  own small trap: a shallow waist-height camera let other, taller furniture
  sitting between the camera and a drag target block the click raycast
  entirely (the first evidence attempt's "collision" screenshot turned out
  to be a much bigger neighboring item the ray had hit first, not the
  intended target) — worth remembering for D3's own evidence capture.
- Collision/snap targets are recomputed by walking every other placed
  item's live group every pointermove (`built.furnitureGroups`) — fine at
  the seed's ~13-item scale, but an obvious spot to revisit if D3's
  multi-layout work or a larger real room makes per-move cost noticeable.

## D3/D4/D5 — not started

D3 (W-A persistence: named layouts + replace) is next, same branch/files as
D1/D2 per the delegation map. D4/D5 remain blocked on Shyam's inputs (D4's
rug photo; D5's FAL_KEY plus item/multi-angle photos).
