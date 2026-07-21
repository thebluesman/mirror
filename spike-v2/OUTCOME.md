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

## D3 — W-A persistence: named layouts + replace via re-import

**Status: built, evidence captured, awaiting C1 alongside D1/D2.** Branch:
`v2/spike-arrange`. Screenshots: `spike-v2/d3-screenshots/`, captured by
`spike-v2/d3-layouts-drive.mjs` (same one-off-Playwright-driver shape as
D1/D2's evidence scripts).

**Replace via re-import — already done, not new work here.** Checked
before building anything: Phase 5's acceptance-run fix (plan-v1.md, "Re-
import blocked for already-imported items") already made every item a
re-import target, with a warning before replacing an already-imported
one's photo/model/dims/orientation (`ImportPanel.tsx`/`applyImport.ts`).
Item identity (`itemId`) is separate from placement (`layouts[].commands`,
keyed by `itemId`) and from the asset (`glbHash`) — so replacing an asset
never touches any layout's placement commands, in the current layout or
any other. Confirmed by reading `applyFurnitureImport`, not re-verified
live here (no fal.ai key in this session — same gap D1/D4/D5 flag).

**What's new for named layouts:**
- **`src/scene/layouts.ts`** — `makeLayout()`, pure: snapshots a source
  layout's current `commands` into a new named `Layout` (slugified,
  de-duplicated id via the same `util/slug.ts` scheme `cameraViewpoints.ts`
  uses for saved views), recording `base: source.id` per the schema's
  documented intent (`schema/scene-schema-draft.md`: "base: parent layoutId").
  A full copy, not a diff — `buildScene.ts`/`Viewport.tsx` read a layout's
  `commands` directly with no base-merge step, so a diff-only layout
  wouldn't render correctly yet; this proves the `layouts[]`/`current`
  shape works as authored since v1, it doesn't redesign it.
- **`src/components/LayoutChrome.tsx`** — a second floating pill bar
  (top-center, via a `.viewport-chrome--top` CSS override so it doesn't
  collide with `ViewportChrome`'s existing bottom-center camera-viewpoint
  bar), same save/name/delete interaction pattern as `ViewportChrome`.
  Clicking a layout's pill switches to it; the active layout's pill is
  visually distinct; deleting the last remaining layout or the currently
  active one is disabled (would leave `sceneFile.current` pointing at
  nothing) rather than silently no-op'd.
- **`App.tsx`** — `handleSwitchLayout`/`handleSaveLayout`/`handleDeleteLayout`,
  same "discrete, deliberate action, persist immediately" treatment as
  `handleSaveView`/`handleDeleteView` already use for camera viewpoints.
  Switching layouts sets `sceneFile.current`, which was already a
  structural-rebuild dependency in `Viewport.tsx` (D1's comment: "switching
  to a different saved layout is a structural change... and should get a
  real rebuild, unlike an in-place edit to the current layout's commands")
  — so layout switching needed no Viewport changes at all, just proof the
  existing wiring does what it was built for.

**Tests**: `src/scene/layouts.test.ts` — command copy is a real copy (not
a shared reference), `base` is recorded, id slugification/de-duplication,
blank-name fallback. `npx vitest run` — 79 tests, all passing (75 pre-
existing + 4 new). `npx tsc -b`, `npm run build`, and `oxlint` all clean.

**Evidence** (`d3-layouts-drive.mjs`, against a running dev server and the
real seed): starting from the seed's single `current` layout, saving a new
"Weekend" layout shows both pills with "Weekend" active
(`1-after-save-second-layout.png`); clicking "current" switches back
(`2-switched-back-to-current.png`); reloading the page keeps both layouts
and the active selection (`3-after-reload.png`) — IndexedDB read-back
confirms `layouts` and `current` are byte-identical before and after
reload (`PERSISTENCE OK`), the same persistence-proof discipline D1 used
for move/rotate.

**Rough edges found (surfacing per §6, not hiding them):**
- `applyFurnitureImport`'s existing "add a default placement if the
  current layout doesn't have one for this item" logic (Phase 4) only
  ever checks `scene.current` — importing/replacing while a *non-default*
  layout is active, for an item that layout hasn't placed yet, adds a
  `[0,0,0]` default command to *that* layout only, leaving other layouts
  as they were. This is arguably correct (each layout tracks its own
  placement) but untested here — D3's evidence only exercises save/
  switch/reload, not import-while-on-a-non-default-layout. Worth a
  deliberate check at C1 if Shyam's hands-on drive touches it.
- No UI affordance to rename a layout after saving (camera viewpoints have
  the same gap) — save-as-new with a new name is the only path; not
  required by the plan's bar ("save current arrangement as a named layout,
  make a second one, switch between them") but a natural follow-up if D3's
  branch becomes v2's real seed.

**`/code-review` pass, 2026-07-21:** 3 findings (1 CONFIRMED, 1 duplication-
risk, 1 PLAUSIBLE), 2 fixed directly on the branch — `itemFootprintAABB`'s
corner-rotation math had its cross-term signs flipped relative to
`THREE.Object3D`'s actual `rotation.y` convention (verified numerically
against `THREE.Group.applyEuler`: the code computed a rotated offset that
was the exact negation of the real one). Invisible for a symmetric plain
box (which is why D2's own tests didn't catch it — none of them rotated an
asymmetric footprint), but for the compound-sofa's off-center chaise
sub-part, any rotation not a multiple of 180° would compute an AABB
mirrored through the item's own center relative to how it actually
renders — reachable today through the shipped keyboard-rotate control,
even though no seed placement currently rotates the sofa away from 0°.
Fixed, with a new regression test (`collision.test.ts`) pinning the
correct rotated offset. Also fixed: `wallFootprintAABBs` had its own
hardcoded copy of `buildScene.ts`'s `WALL_THICKNESS` instead of importing
it (now exported, same drift-prevention reasoning that made
`furnitureFootprint` exported for D2 in the first place). The third
finding is deferred, not fixed: `snapping.ts`'s `bestSnapDelta` can, in the
narrow case where a dragged item's edge already sits inside a wall's
thickness band, snap toward the wall's far/outer face instead of back out
to the room-facing side — cosmetically wrong-direction, but the item is
already flagged as colliding in that state regardless of which way it
snaps, so nothing is hidden from the user. `npx vitest run` (80 tests),
`npx tsc -b`, `npm run build`, and `oxlint` all clean after the fixes.

**PR #10 review (Shyam), 2026-07-21:** one more correctness finding, caught
after the self-review above had already gone out — `snapping.ts`'s
`snapPosition` merged `walls` and `others` into one flat target list before
building the per-axis candidate lists (`targets = [...walls, ...others]`),
feeding every wall's full AABB into *both* axes uniformly. A wall's AABB is
only thin (a real face) along the axis its face actually points on; the
other axis is just the wall run's extent — its endpoints/corners, not a
face. For a horizontal wall (e.g. `x:[0,400]`, `z:[-5,5]`), that meant an
item near `x=0` or `x=400` could snap its X there even with no actual
X-facing wall present, purely because that's where the wall run happens to
end — masked in the existing tests, which only ever exercised a wall on
its own real (thin) axis. Fixed: walls now contribute only to the axis
they're thin on; `others` (real furniture items, which do have a genuine
face on every side) are unaffected. Two new regression tests in
`snapping.test.ts` reproduce the exact failure (confirmed failing against
the pre-fix code, passing after) for both a horizontal and a vertical
wall's spurious cross-axis endpoint. `npx vitest run` (82 tests), `npx tsc
-b`, `npm run build`, and `oxlint` all clean after the fix.

## C1 — Checkpoint: Shyam drives the W-A branch, 2026-07-21

Driven against `main` post-#10 (D1+D2+D3), against Shyam's own imported room
data. Per-item results against the §2 bar:

- **Move** — good.
- **Rotate** — keyboard step works; no visible UI handle for rotate. Bar
  technically clears ("handle *or* keyboard step"), but Shyam wants a
  handle added — **new follow-up scoped below, not blocking this record.**
- **Collision/overlap** — flags correctly. Surfaced a real question in the
  process: no way to move an item vertically (Shyam wanted to lift a table
  lamp clear of a bookshelf collision). This is not a bug — §9 explicitly
  excludes it ("floor-plane placement + yaw rotation only; no vertical
  stacking, no tilt, no physics engine") — **recorded as a new finding for
  a future scope conversation, intentionally left as-is for now.**
- **Snapping** — good.
- **Replace** — good (re-import via existing flow, placement/scale/identity
  preserved).
- **Multi-layout** — good (save/switch/reload all work as intended).

**Bookshelf — model defect, not an orientation bug.** Screenshot evidence:
the cubby holes sit on the model's narrow end, not the wide end, and there's
no backboard (cubbies are visible through the far side). Rotating in W-A
cannot fix this — it's a bad Meshy generation, structurally wrong rather
than misoriented. This lands squarely on why bookshelf is already in W-C's
(D5) comparison slate — OUTCOME-3 flagged it as the weakest Meshy pass, "the
most room to show a difference" against Hunyuan — so this finding is
concrete evidence for that comparison, not a new problem to solve in W-A.
Until D5 resolves it (or the asset is otherwise replaced), the bookshelf
can't be placed correctly regardless of arrangement quality — noted as a
known-bad-asset caveat on the verdict below, not counted against W-A itself.

**Verdict: Go-with-constraints.** Core interactions (move, collision,
snapping, replace, multi-layout) are decision-grade. Two named gaps keep it
short of a clean go: (1) rotate has no UI handle (fix scoped immediately
below), (2) no vertical placement axis (intentionally out of scope per §9,
flagged for a possible future scope reopen, not fixed now). The bookshelf's
bad geometry is a generation-quality issue outside W-A's remit, tracked via
D5.

**Follow-up spawned from C1: rotate UI handle.** A drag handle for rotating
the selected item (alongside the existing keyboard step) — scoped and
tracked as its own build pass on top of `main` post-#10; see the PR for
implementation and evidence once it lands.

## C1 follow-up — rotate UI handle

**Status: built, evidence captured.** Branch: `v2/spike-arrange-rotate-handle`
(off `main` post-C1). Screenshots:
`spike-v2/d1-followup-rotate-handle-screenshots/`, captured by
`spike-v2/d1-followup-rotate-handle-drive.mjs` (same one-off-Playwright-driver
shape as D1/D2/D3's evidence scripts).

**What's there:**
- **The handle itself**: a small sphere, offset along the selected item's
  local +Z from its center (`ROTATE_HANDLE_MARGIN_CM = 25` beyond the item's
  own half-depth), reusing `SELECTION_COLOR` so it reads as part of the same
  selection affordance as the existing outline, not a new unrelated UI
  element. Shares the outline's depth-test-disabled/late-`renderOrder`
  overlay treatment, for the same reason: a selection control should never be
  occluded by the furniture it's attached to, and that overlay treatment
  doubles as making it a reliable click target. Created/destroyed alongside
  `selectionHelperRef`'s `THREE.BoxHelper` in the same lifecycle effect.
- **The math**: `src/scene/rotateHandle.ts` — two pure, framework-free
  functions (`yawDegFromPointer`, `rotateHandleWorldXZ`), same "pure
  algorithm, no THREE dependency" shape as `collision.ts`/`snapping.ts`.
  `yawDegFromPointer` takes the item's center and the pointer's current
  floor-plane hit and returns the yaw that points the item's local +Z (where
  the handle rests at yaw 0) at the pointer — direction only, independent of
  distance from center, so it's exactly what a rotate-drag sets
  `group.rotation.y` to on every `pointermove`. `rotateHandleWorldXZ` is its
  inverse (used to position the handle itself). Both verified against the
  same `THREE.Object3D.rotation.y` convention D2's `itemFootprintAABB` fix
  pinned down, and round-trip-tested against each other.
- **Not parented under the item's group.** The handle's world position is
  recomputed from the group's live position/rotation at three points: its own
  creation, the placement-reconciliation effect (a committed layout change
  from outside this component's own drag code, e.g. a future undo), and
  every `animate()` frame (so a live translate-drag, rotate-drag, or keyboard
  step all keep it glued to the item with no extra bookkeeping). Mirrors why
  the selection outline isn't parented either — a translate-drag mutates
  `group.position` directly, and re-deriving the handle's world (x, z) from
  that every frame is simpler than fighting THREE's parent-transform update
  timing for a value only ever read, never authored, by the handle itself.
- **Its own raycast target.** `onPointerDown` checks the handle mesh in
  isolation, first, before the general `scene.children` walk that decides
  between "clicked the selected item" (start a translate-drag) and "clicked
  empty space" (deselect). A hit here starts a `rotateDrag` gesture and
  returns immediately, so clicking the handle can never be read as a
  translate-drag on the item it's attached to — the two gestures
  (`drag`/`rotateDrag`) are mutually exclusive per pointer-down, same
  "gesture owns the pointer, controls are disabled" treatment translate
  already uses.
- **Same seam, same commit path.** Dragging the handle mutates
  `group.rotation.y` live (mutate-during-gesture) via `onPointerMove`'s new
  `rotateDrag` branch — a floor-plane raycast at the item's height, exactly
  like translate-drag's `dragPlane` technique, feeding `yawDegFromPointer`
  instead of a position delta. `updateCollisionHighlight()` fires on every
  move, same as translate-drag and keyboard-rotate already do. On
  pointer-up/pointer-cancel/mid-drag structural rebuild, `commitRotateDrag()`
  fires through the identical `onCommitPlacementRef` path move and
  keyboard-step rotate use, normalizing degrees the same way (`normalizeDeg`)
  — no new commit machinery.
- **Keyboard step untouched** — `ROTATE_STEP_DEG`, `onKeyDown`, and its
  `evt.repeat` guard are unchanged; the handle is additive.

**Tests**: `src/scene/rotateHandle.test.ts` — the four cardinal directions
(0/90/180/270deg), distance-independence (only direction matters), a
non-origin center, and a round-trip through both functions for an arbitrary
yaw/center/offset. `npx vitest run` — 91 tests, all passing (82 pre-existing +
9 new in `rotateHandle.test.ts`). `npx tsc -b`, `npm run build`, and
`oxlint src/` all clean.

**Evidence** (`d1-followup-rotate-handle-drive.mjs`, against a running dev
server and the real seed):
- Selecting `shoe-rack` shows the cyan handle sphere appear next to it
  (`1-selected-handle-visible.png`); dragging it toward a +40deg target
  screenshots mid-drag with the item visibly rotated partway
  (`2-mid-drag-40deg.png`) and after release at 38.97deg — within tolerance
  of the 40deg drag target, the small gap being the synthetic mouse path's
  step count rather than the rotation math itself
  (`3-after-release.png`). A page reload confirms the commit persisted
  (`PERSISTENCE OK`), same discipline D1 used for translate/keyboard-rotate.
- A keyboard-step regression check (`e` key) still steps exactly 15deg after
  the handle code landed (`KEYBOARD ROTATE OK`), confirming the two rotate
  paths don't interfere.
- Dragging `water-cooler`'s handle toward the neighboring
  `billy-hogadal-shelving` (7cm apart at rest, close enough that any
  noticeable yaw swings a footprint corner into it) recolors the selection
  outline red mid-drag (`4-collision-mid-handle-drag.png`), confirming
  `updateCollisionHighlight()` stays live during a handle-drag exactly as it
  does for translate-drag and keyboard-rotate.

**Rough edges found (surfacing per plan §6's discipline, not hiding them):**
- **No visual rotation gradient/ring** — the handle is a plain sphere with no
  indication of "which way is 0deg" or a snapping ring at 15deg increments
  (the keyboard step's granularity). Free-angle drag and 15deg-stepped
  keyboard rotate can now disagree by a few degrees if used interleaved on
  the same item — not a bug (both commit through the same path, and
  `normalizeDeg` keeps values sane), but a real inconsistency in how precise
  each control is. Worth deciding, if this becomes real UI, whether the
  handle should snap to the same 15deg steps or stay free-angle.
- **Handle grab target is small and floats in open space** — 6cm-radius
  sphere with no camera-relative size compensation (a far-zoomed-out view
  makes it a tiny screen-space target; very close-up it can dominate the
  frame). The depth-test-disabled overlay treatment means it's always
  clickable regardless of occlusion by nearer geometry, which is consistent
  but also means it can be clicked "through" furniture that visually should
  be in front of it — acceptable for a selection affordance, worth a second
  look before a real build.
- **No visible drag affordance until already dragging** — same gap D1 flagged
  for translate-drag (no cursor change, no hover highlight on the handle
  itself before pointerdown) — inherited, not newly introduced, but now
  applies to a second control.
- **Feel, hands-on**: not yet driven by Shyam directly (this is a same-day
  follow-up build, evidence captured via the Playwright script above, not a
  live hands-on session) — the numeric/screenshot evidence shows the
  mechanism works correctly, but whether the drag *feels* good (grab-target
  size, drag sensitivity, handle placement) is exactly the kind of judgment
  that needs Shyam's own hand on the mouse, same as C1's original bar. Recorded
  here so that's an explicit next step, not an assumed pass.

## D4/D5 — not started

Blocked on Shyam's inputs (D4's rug photo; D5's FAL_KEY plus item/
multi-angle photos).
