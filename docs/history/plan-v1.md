# Build Plan — v1: Import + View

**Status:** Active, 2026-07-18. Executes `PRD-v1.md`. Supersedes nothing — this is
the first implementation plan post-spike.

## Planning principles

1. **Interruption-safe phases.** Every phase ends with work merged to `main`, a
   journal entry via `@historian`, and its checkbox ticked here. If a session or
   weekly limit cuts a phase short, the phase's branch holds WIP with a committed
   `HANDOFF.md` note at the branch root; nothing lives only in a conversation.
   A fresh session resumes from: this doc's checkboxes → the phase branch →
   `HANDOFF.md`.
2. **Multiagent orchestration, sized to the work.** The primary session (Sonnet,
   since Fable access was lost 2026-07-21) orchestrates: decomposes phases,
   spawns subagents into worktrees, reviews and merges. Subagents get the
   cheapest model that reliably does their kind of work (assignments per phase
   below) — this is independent of the primary session's model. Historian stays
   on its existing Stop-hook trigger — orchestration sessions on branches are
   gated out by design; journal entries land when work merges to `main`.
3. **Branch discipline.** Implementation phases run on `v1/<phase>` branches
   (worktrees for parallel streams). Docs and this plan's checkbox updates commit
   directly to `main`, per existing workflow. `/code-review` runs on each phase
   branch before merge.

## Model assignment rationale

| Work type | Model | Why |
|---|---|---|
| Orchestration, integration review, architectural decisions | Sonnet (primary session) — Fable access lost 2026-07-21; Opus subagents still used for the riskiest per-task work below | Judgment-heavy, holds full context |
| Three.js core port, storage/schema architecture, Meshy async-job flow | Opus | Complex, correctness-critical, cross-cutting |
| Standard feature work, UI components from `DESIGN.md` tokens, texture-pipeline port | Sonnet | Well-specified implementation against existing patterns |
| Scaffolding, config, test boilerplate, doc/research lookups (e.g. CORS behavior, API docs) | Haiku (Explore/general-purpose) | Mechanical or read-only; speed and cost win |

## Phases

Dependency shape: `0 → 1 → {2 ∥ 3} → 4 → 5`. Phases 2 and 3 can run as parallel
worktrees once 1 merges; everything else is sequential.

### Phase 0 — Gates (no app code)

Two blockers PRD §8/§12 explicitly schedule before building:

- [x] **G1 — fal.ai CORS verification.** Minimal throwaway HTML page (scratch, not
      committed as product code) exercising the **full round trip** browser-side
      with a pasted key: photo upload (`fal_client.upload_file`'s HTTP equivalent),
      the `fal-ai/meshy/v6/image-to-3d` job, and the result-GLB download. Each leg
      can fail CORS independently — a generate-only probe can pass while the flow
      still breaks in Phase 4. Outcome recorded as an ADR: browser-direct works, or
      v1 grows a minimal local proxy helper — **if proxy, building it becomes the
      first task of Phase 4** (it's on the import flow's critical path and nothing
      else needs it). *Agent: Haiku for docs research, then hands-on run needs
      Shyam's fal.ai key — human-in-the-loop.*
      **Resolved 2026-07-20:** all three legs passed with no CORS errors —
      browser-direct, no proxy. See [ADR-0001](docs/adr/0001-fal-browser-direct.md).
- [x] **G2 — Figma conversion session.** First, **draft the scene-schema subset**
      (room dims/openings, furniture item placement, the `layouts[]`/`current`
      branch shape) so the seed JSON has a real target shape — Phase 2 formalizes
      this draft with validation/migration/tests, it doesn't invent the schema
      from scratch. (Without this, G2 would depend on Phase 2's output while
      running two phases earlier — the original ordering was circular.) Then:
      agree layer/naming conventions, and run the one-time MCP session converting
      the Figma room layout → seed scene JSON (room dims, openings, per-item
      position/rotation — spike 3's `geometry.json` successor, in the drafted
      shape). Hand-in-the-loop with Shyam; numbers are a starting point,
      calibration comes later. Seed JSON committed to the repo. *Agent: primary
      session (Fable) — this is the judgment-heavy conversion the PRD describes.*
      **Resolved 2026-07-20:** schema draft at `schema/scene-schema-draft.md`;
      seed scene JSON at `seed/living-room.json`.

**Exit:** ADR for G1 outcome; committed schema draft + seed scene JSON; journal entry.
*Both gates need Shyam present — schedule them for an interactive session; they're
small and front-loaded precisely so later phases can run more autonomously.*

### Phase 1 — Scaffold + render core (`v1/scaffold`)

- [x] Vite + React + Three.js scaffold; `DESIGN.md` tokens as CSS custom
      properties; light-canvas app shell (header, viewport, side panel skeleton).
      *Agent: Haiku (scaffold/tokens), Sonnet (shell components).*
- [x] Port `spike/scene2.html`'s Three.js core into a React-managed viewport
      component: PBR renderer, lighting, orbit/pan/zoom. Loads the Phase 0 seed
      JSON statically (no storage layer yet) and renders the untextured shell +
      any spike GLBs available. *Agent: Opus, worktree. Spike code is read-only
      reference — productize, don't edit `spike/`.*

**Resolved 2026-07-20:** `src/scene/buildScene.ts` generalizes scene2.html's
wall/opening-cutting logic to any wall run; furniture renders as generic
`dimsCm` boxes (no GLBs exist yet — that's Phase 4) with a compound-sofa
special case for the seed's main/chaise sub-footprints. Verified in-browser
via Playwright: renders room + furniture from `seed/living-room.json` with no
console errors, orbit-drag repositions the camera.

**`/code-review` pass, 2026-07-21:** 8 findings; the 2 real rendering bugs
(TV mount elevation double-counted, window sill/head height ignoring the
seed's `sillHeightCm`/`headHeightCm`) are fixed in `buildScene.ts`. The other
6 are deferred, not forgotten — each is owned by the phase below that's
positioned to fix it properly rather than patched ad-hoc in Phase 1:

- **Phase 2 (schema)**: `WallOpening.type` has no `"glass-door"` value, so
  the seed's full-height glass balcony door (typed `"door"`) renders as an
  opaque leaf, losing its glazing — needs a real schema type, not a Phase 1
  patch. Also: `FurnitureItem.dimsCm` is typed required but the seed's
  `applaryd-sofa` omits it (main/chaise only) — `furnitureFootprint()` in
  `buildScene.ts` has an unguarded `item.dimsCm.w` fallback that will throw
  on a future item that's neither fully `dimsCm` nor fully `main`+`chaise`.
- **Phase 3 (texturing)/general polish**: floor/ceiling planes aren't
  `THREE.DoubleSide` and `OrbitControls` isn't polar-angle-clamped, so
  orbiting under the floor or over the ceiling shows the background color
  through them.
- **Viewport hardening (no owning phase yet — flag before Phase 5 polish)**:
  scene geometries/materials are never disposed on unmount (confirmed
  leaking one full scene's worth of GPU buffers on React 19 StrictMode's
  dev-mode double-invoke); `camera.fov = preset.fovDeg || HUMAN_FOV` uses
  `||` instead of `??` (silently drops a legitimate `fovDeg: 0` preset).
  **Extended by Phase 4's code-review (2026-07-21):** the same
  never-disposed gap now also applies to furniture GLBs loaded via
  `loadFurnitureModel` — every structural rebuild or unmount drops loaded
  geometries/materials/textures without `.dispose()`. Also flagging a
  distinct-but-related perf gap for this same hardening pass: `Viewport.tsx`'s
  `structuralSceneFile` memo depends on `sceneFile.items`, so completing one
  furniture import tears down and rebuilds the *entire* renderer/scene and
  re-decodes *every* already-imported item's GLB from OPFS, not just the new
  one — wasted work (and a visible flash) that scales with total furniture
  count on every single import.
- **Phase 4 (furniture import) altitude note**: `furnitureFootprint()`
  dispatches the compound-sofa case on `item.main && item.chaise` presence
  rather than a modeled shape discriminant — fine for now, but Phase 4's
  per-item GLB-swap logic will want a real discriminant to hook into rather
  than special-casing around this presence-check.

**Exit:** `npm run dev` shows the room shell from seed data with camera control.
Merged, reviewed, journaled.

### Phase 2 — Storage layer (`v1/storage`, parallel with 3)

- [x] Versioned JSON project schema — formalize the Phase 0 (G2) draft: Room,
      Furniture Item, Camera Position, and the `layouts: [{name, base,
      commands[]}]` / `current` branch shape from day one (PRD §8). Schema module
      + validation + migration stub; the committed seed JSON must validate
      against it (or ship with a migration from the draft shape). *Agent: Opus.*
- [x] OPFS content-addressed asset store (hash → blob), IndexedDB autosave,
      File System Access API save/load with download/upload fallback, zip export.
      *Agent: Opus (store design), Sonnet (zip/fallback plumbing).*
- [x] Unit tests for schema round-trip, hashing, autosave restore. *Agent: Sonnet.*

**Resolved 2026-07-21:** `src/schema/scene.ts` formalizes the draft with zod
(runtime validation + `z.infer` types, replacing the hand-kept
`src/scene/types.ts` mirror) and a `v1-draft` → `v1` `migrate()` path; the
committed seed still ships at `v1-draft` so every load exercises migration.
Folds in the two Phase 1 code-review findings assigned here: `WallOpening.type`
gained `"glass-door"` (seed's balcony door updated to use it; `buildScene.ts`
routes it through the existing door branch unchanged — Phase 3 owns the real
glazing) and `FurnitureItem` is now a box-vs-compound-sofa union so
`furnitureFootprint()` dispatches on `shape` instead of an unguarded
`main`/`chaise` presence-check. Added `src/storage/{assets,autosave,
projectFile,zipExport}.ts` (OPFS content-addressed store, IndexedDB autosave,
File System Access save/load with download/upload fallback, fflate zip
export/import) and `App.tsx` now loads from the autosave store — seeding from
`living-room.json` through `parseScene` on first run — instead of a static
import. 29 Vitest tests (fake-indexeddb + an in-memory OPFS shim) cover
schema/migration/round-trip, hashing, and autosave restore; `npm run build`
and `oxlint` are clean. Verified in-browser via Playwright: 0 console errors
before/after reload, IDB round-trips `schemaVersion "v1"`, and a
mutate-then-reload survives — the persistence exit criterion holds.

**`/code-review` pass, 2026-07-21:** 8 findings; 3 fixed directly on `main`
(`CameraPositionSchema` missing `.loose()` — was silently dropping the seed
camera's `note` field on first load+autosave; a redundant `JSON.parse(JSON.
stringify(...))` clone in `autosave.ts`'s `saveProjectNow` — `IDBObjectStore.
put()` already structured-clones; `migrate()`'s value-based door→glass-door
reclassification heuristic — fragile in both directions, and already dead for
the actual seed data since its balcony door is typed `glass-door` directly, so
simplified to a version-bump-only migration). The other 5 are deferred to the
phases positioned to fix them:

- **Phase 3 (texturing)/door rendering polish**: `buildScene.ts`'s door/
  glass-door branch hardcodes lintel/leaf heights (210/208) and ignores the
  opening's own `headHeightCm`/`sillHeightCm`, even though the schema carries
  them generally now — same bucket as Phase 1's deferred window-height finding.
- **Phase 4 (furniture import)**: `assets.ts`'s `putAsset()` idempotency check
  only verifies a file exists, not that a prior write completed — an
  interrupted import (tab closed mid-write) can leave a 0-byte stub masked as
  "already stored" forever. Worth hardening once real imports exist.
- **Phase 5 (polish/save-load chrome)**: `projectFile.ts`'s file-input
  fallback (`pickFileViaInput`) never resolves/rejects if the user cancels the
  native picker in a browser lacking the 'cancel' input event (Safari/Firefox
  — the exact fallback target); and `App.tsx` has no recovery path if an
  IndexedDB restore throws (`clearProject()` exists but nothing calls it from
  UI) — both are UI-layer gaps in modules Phase 2 built but didn't wire up yet.
- **No owning phase yet (schema robustness, flag before v2)**: an item
  authored with both `dimsCm` and `main`/`chaise` but no `shape` field
  silently validates as a plain box (`FurnitureItemSchema`'s union tries
  `CompoundSofaFurniture` first but falls through on the missing literal) —
  narrow edge case, no current data triggers it.
  **Extended by Phase 4's code-review (2026-07-21):** `applyFurnitureImport`
  silently adds an item to `items[]` with no placement command if
  `scene.current` doesn't match any `layouts[].id` — reachable only via a
  hand-edited/corrupted project file (no in-app flow produces this
  mismatch), same "narrow edge case, no current data triggers it" shape as
  the finding above.

**Exit:** project persists across a browser restart (PRD §10's persistence
criterion, testable before flows exist); Phase 1 viewport reads from the store
instead of the static file.

### Phase 3 — Shell texturing flow (`v1/texturing`, parallel with 2)

- [x] **Reimplement** (not port) `spike/textures/`'s tileable-texture pipeline
      in-browser (local, no network). Scoped honestly: `make-tileable.mjs` is
      built on **sharp**, a native Node library that cannot run in a browser —
      the quadrant-swap + cross-fade logic must be rewritten on Canvas/
      OffscreenCanvas, and the spike's no-visible-seams check re-verified against
      the new implementation. `shell-textures.mjs`'s mesh-targeting is also
      coupled to `scene2.html`'s specific material structure and needs redoing
      against Phase 1's viewport component. The *algorithms* are proven; the
      *code* is not reusable as-is. *Agent: Sonnet; Opus only if the rewrite hits
      real architectural friction.*
- [x] Upload UI (wall/floor/ceiling photos) + calibration panel — tint/repeat
      sliders replacing the spike's hand-edited `calibration.json` (PRD §7.2).
      Upload/processing states designed ad-hoc from `DESIGN.md` tokens; flag to
      Shyam for a Figma pass only if the ad-hoc version isn't good enough.
      *Agent: Sonnet.*

**Resolved 2026-07-21:** `src/texturing/tileable.ts` reimplements the spike's
quadrant-swap + cross-fade algorithm over plain RGBA buffers (Node-testable,
framework-free); `src/texturing/pipeline.ts` wraps it for the browser
(OffscreenCanvas/ImageBitmap, photo → center-crop → tileable → JPEG blob).
`src/scene/shellMaterials.ts` + `loadShellTexture.ts` reimplement
`shell-textures.mjs`'s calibration math (tint/repeat/roughness) directly
against `buildScene.ts`'s own material objects — no structural mesh-finding
needed since this is owned app code, not the spike's file-ownership-
constrained target. `src/schema/scene.ts` gained an additive
`room.shell.{wall,floor,ceiling}` calibration shape (no version bump
needed). `src/components/ShellPanel.tsx` is the upload + tint/repeat/
roughness slider UI, wired into `App.tsx` and persisted through Phase 2's
OPFS asset store + IndexedDB autosave. Also closed both Phase 1/2
code-review deferrals assigned here: `buildScene.ts`'s door/window branches
now honor `headHeightCm`/`sillHeightCm` instead of hardcoded 210/208, and
floor/ceiling got `THREE.DoubleSide` + `OrbitControls` polar-angle clamping.
Verified in-browser via Playwright with Shyam's real surface photos: 0
console errors, textures apply live, calibration survives reload.

**`/code-review` pass, 2026-07-21:** 8 findings (7 CONFIRMED, 1 PLAUSIBLE),
all fixed and re-verified on the phase branch before merge — `zipExport.ts`'s
`referencedHashes()` was missing `room.shell.*.assetHash` (exported zips
silently dropped shell textures); `Viewport.tsx`'s calibration effect could
flicker a surface black (texture disposed without nulling `material.map`
when effect runs overlapped) and leaked one `ImageBitmap` per surface per
change (never `.close()`d on the success path) — both traced to a root
cause also fixed: no debounce on calibration sliders, so any single-surface
tweak reloaded and reprocessed all three surfaces; three `buildScene.ts`
door/opening edge cases (`sillHeightCm > 0` leaving a see-through gap under
doors, unclamped `headHeightCm >= wallHeight` producing degenerate
lintel geometry, and a `headHeightCm - sillHeightCm <= 2` gap silently
deleting the door leaf — the last two now guarded in `addSegment` and via a
new `WallOpeningSchema` `.refine()` respectively); and a latent regression
where splitting the build effect from the calibration effect had frozen
`Viewport.tsx`'s structural rebuild to mount-only (fixed via a
`useMemo`'d structural-fields comparison, restoring the original
`[sceneFile]`-reactive guarantee for any future non-shell scene change).

**Exit:** shell textured from Shyam's photos entirely in-app, calibrated via
sliders, persisted (rebase onto Phase 2's store at merge).

### Phase 4 — Furniture import flow (`v1/import`)

Depends on **2 merged and G1's answer** — not on 3: import and shell texturing
touch different parts of the scene, so a slow texturing phase must not block
the riskiest flow in v1. Whichever of 3/4 merges second rebases.

- [x] ~~*(Only if G1's ADR says browser-direct fails)* Build the minimal local
      proxy helper G1 scoped~~ — not needed; ADR-0001 resolved G1 browser-direct.
- [x] Settings panel: fal.ai key paste, stored in IndexedDB, never bundled.
      *Agent: Sonnet.*
- [x] Meshy job flow: photo upload → cost-surfacing confirm step → async
      generation with progress → GLB into OPFS. Failure leaves no half-imported
      item; per-item retry reuses the uploaded photo. Consider passing the photo
      as a base64 data URI in the generate request instead of a separate upload
      call — fal.ai accepts data URIs for image inputs, which drops one network
      call and one CORS failure point, at ~33% larger payload (watch request-size
      limits on large phone photos). *Agent: Opus — the async/failure semantics
      are the risky part.*
- [x] Post-generation: confirm/adjust cm dimensions → rescale + floor-snap →
      place at Figma-seeded position/rotation (default position if no footprint).
      *Agent: Sonnet, against spike 3's proven scaling/snapping logic.*

**Exit:** one real furniture item goes photo → Meshy → placed in the rendered
room, in-app, with a paid generation Shyam approved. **Met 2026-07-21** — see
"Resolved" below.

**Handoff note (2026-07-21):** Shyam is out of usage budget for this session;
realladygrey (GitHub collaborator) is picking up all four checklist items
above. Nothing in the build itself requires Shyam specifically — the fal.ai
key used for dev/testing can be hers, and any photo works for building/
testing the flow. Only the **exit criterion** is Shyam-specific: the final
acceptance run needs his real furniture photo and his approval to pay for
that generation. Recommended split: she builds + tests the full flow
end-to-end on her own key/test photo through a `v1/import` branch (worktree,
per this plan's branch discipline), following the same phase-interruption
convention as Phase 3 (`HANDOFF.md` if she doesn't finish in one sitting,
`/code-review` before merge); Shyam runs the real photo → paid generation →
exit-criterion check himself once her branch is ready, since that step is
what the exit criterion actually requires him for.

**Resolved 2026-07-21 (implementation, not the exit criterion):** the
Settings/Meshy-client/GLB-rendering/import-flow work above is built —
`src/components/SettingsPanel.tsx` + `src/storage/settings.ts` (fal.ai key,
IndexedDB, never bundled; `src/storage/db.ts` now centralizes the
IndexedDB open/upgrade path autosave.ts and settings.ts both use, so they
can't drift onto two different `DB_VERSION`s), `src/import/falClient.ts`
(browser-direct per ADR-0001: upload → submit/poll with progress → download,
tolerant GLB-URL extraction), `src/scene/loadFurnitureModel.ts` +
`buildScene.ts`/`Viewport.tsx` (an item with `glbHash` loads its model from
OPFS and fits it to confirmed cm dims — rescale/floor-snap/recenter done at
load time in Three.js rather than pre-baked — async, same
after-the-structural-build pattern Phase 3 established for shell textures),
and `src/components/ImportPanel.tsx` + `src/import/applyImport.ts` (pick or
name an item → upload photo → cost-confirm → generate with progress →
confirm dims → commit at its Figma-seeded placement or a default position).
`npm run build`/`tsc -b`/`oxlint`/`npm run test` (48/48) all clean; verified
in-browser via Playwright short of the live Meshy call itself (no fal.ai key
available in this build session). **The exit criterion itself — a real
photo through a paid Meshy generation, approved and placed in-app — has not
been run.** That's explicitly Shyam-gated per the handoff note above; it's
the next thing to happen on this phase, not a follow-up phase.

**Exit criterion resolved 2026-07-21:** Shyam ran the real acceptance flow —
`npm install` first to pull in `@fal-ai/client` (declared in `package.json`/
lockfile but missing from `node_modules` post-handoff, blocking `npm run
dev` until installed) — then a real photo of his table lamp through a paid
Meshy generation via his own fal.ai key, confirmed cm dims, placed at the
Figma-seeded position. GLB downloaded and rendering in-scene; Shyam judged
it "looks good... good enough to move forward." Phase 4 exit criterion met.
Two things flagged during the run, not blocking:
- **Sofa/floor-lamp/bedroom-door positioning — fixed 2026-07-21, took two
  passes.** Cross-checked `seed/living-room.json` against the source Figma
  file directly: the swivel-chair and floor-lamp seed positions match Figma
  exactly, so this was never a seed/conversion error, purely a rendering
  bug. First pass fixed the sofa's overall *shape* (chaise `offsetX` was
  `-(main.w / 2) - chaise.w / 2`, double-subtracting main's half-width) but
  missed that `main`'s own offset (`main.w / 2`) put the whole group's
  anchor at main's west edge instead of its center, silently shifting the
  entire sofa 145cm east — into the bedroom door's clearance. Second pass,
  after Shyam caught the sofa sitting flush against the west wall instead
  of Figma's ~36cm gap: `main`'s offset is now `0` (position = main's
  center, same convention every plain-box item already uses), and the
  chaise shares main's *west edge* rather than abutting further west of
  it — confirmed against Figma, main and chaise's drawn rects share the
  same west x-coordinate; the L-shape comes from the chaise's greater
  depth (protruding into the room), not a sideways extension. New formula:
  `chaiseOffsetX = (chaise.w - main.w) / 2`. Also required updating the
  seed's `position` itself, from 671 (Figma's *uncorrected* drawn-main
  center) to 655 (the corrected-main center once `main.w` shrinks from
  Figma's drawn 322 to the real 290 while preserving the shared west edge
  at x510). Result: main spans world x[510,800] — 36cm clear of the west
  wall, matching Shyam's Figma read exactly — and ~92cm clear of the
  bedroom door. `npm run build`/`test` (48/48) clean after each pass.
  **Lesson for future geometry bugs on this item:** verify against actual
  Figma coordinates before trusting a formula that merely produces a
  plausible-looking number (the first pass's "expected ~381cm" from the
  original code-review finding was never itself checked against Figma —
  it happened to get the width right while the anchor was still wrong).
- **West-wall window sizing — fixed 2026-07-21.** Not a Figma/seed
  mismatch (Figma's 2D plan shows both west-wall openings at the same
  110cm width, matching the seed exactly, and carries no sill/head-height
  info at all) — it was a units bug in `seed/living-room.json`'s window
  opening. `spike/geometry.json`'s original note reads "Window sill 90 /
  height 120 assumed" — a 120cm-tall opening, i.e. `headHeightCm` should be
  `sill + height = 210`. The seed instead set `headHeightCm: 120` literally,
  rendering a ~30cm-tall window instead of ~120cm. Confirmed against
  `spike/out2/scene2-reverse.png` (the reference render shows a window
  nearly as tall as the balcony door beside it, not a thin slit) and fixed
  to `headHeightCm: 210`. `npm run build`/`test` (48/48) clean. Still an
  assumed value, not a measured one (per the spike note's own "assumed"
  caveat) — worth Shyam's photo-derived approach eventually, but the seed
  now at least matches its own documented intent.
- **DESIGN.md fidelity** — the app doesn't read as strongly "Cohere" yet.
  Likely just current-stage minimalism (Phase 5 owns viewport chrome/control
  bar per PRD §9) rather than a real gap, but flagged for a deliberate check
  once Phase 5's chrome work lands rather than assumed benign. Still
  realladygrey's to check per the Phase 5 handoff note below.

**Dev-workflow gotcha surfaced while verifying the two fixes above:**
`App.tsx` restores from IndexedDB autosave whenever one exists and only
reads `seed/living-room.json` on a database's first-ever load — so a seed
data fix (like the window/sofa fixes above) silently doesn't show up in an
already-seeded browser profile until the autosave is cleared (DevTools ->
Application -> IndexedDB -> delete the `mirror` database -> reload).
Clearing it also wipes any in-progress import state (Shyam had to redo the
lamp import after clearing). This is the same gap Phase 2's code review
already flagged (`clearProject()` exists but nothing calls it from the UI)
— still Phase 5's to wire up a real recovery/reset affordance, now with a
second concrete case motivating it.

**`/code-review` pass, 2026-07-21:** 8 findings (6 CONFIRMED, 2 PLAUSIBLE), 3
fixed directly on the branch — `ImportPanel.tsx`'s confirm-dims form accepted
zero/negative/non-finite cm values with no guard (schema's `Dims` has no
positivity constraint either, so a bad value would persist forever with no
in-app fix in v1); now validated inline, "Confirm and place" disabled until
all three are positive finite numbers. `buildScene.ts`/`Viewport.tsx`: an
item whose GLB failed to load (missing/corrupted OPFS asset) stayed
permanently invisible — `addFurniture`'s box-placeholder logic is now a
shared `addFurnitureBoxMeshes` helper Viewport falls back to on load
failure, so a bad asset degrades to "looks unimported" instead of
"vanishes with only a console trace." `assets.ts`'s `putAsset` (already
tightened once this phase from presence-only to size-only) still trusted a
same-size corrupted stub forever; now re-hashes the existing file's content
on a size match before trusting it, closing the gap fully.

The other 5 are deferred: 2 extend already-existing deferred buckets above
(Phase 1's "Viewport hardening" note now also covers furniture-GLB disposal
and the full-rebuild-per-import cost; Phase 2's schema-robustness note now
also covers `applyFurnitureImport`'s silent no-op on a corrupted
`current`/`layouts` mismatch) — see those entries. The remaining 2:

- **Phase 1 origin, no owning phase yet**: `furnitureFootprint()`'s
  compound-sofa chaise offset (`-(main.w / 2) - chaise.w / 2`) leaves a
  145cm gap instead of abutting the chaise to the main body — main's own
  offset (`main.w / 2`) already accounts for its half-width, so subtracting
  it again from the chaise's offset double-counts. Harmless as long as the
  sofa only ever renders as a box placeholder, but Phase 4's new
  `furnitureOverallDims` (which a GLB import would fit to) inherits the gap
  and computes a ~38% too-wide bounding box (526cm vs. an expected ~381cm)
  for the seed's `applaryd-sofa`. Predates this phase and touches
  already-verified Phase 1 render output (the sofa's on-screen position),
  so not patched ad hoc here — fix before anyone runs this specific item
  through the import flow.
- **Live-API-dependent, same gap HANDOFF.md already flags**: `falClient.ts`'s
  `findGlbUrlAnywhere` fallback returns the first `.glb`-suffixed URL found
  in an unordered scan if none of the named response-key candidates match —
  fine if fal's response only ever carries one GLB URL, silently wrong if it
  ever carries more than one (e.g. a preview alongside the final mesh).
  Unverifiable without a live call (see HANDOFF.md); whoever runs the real
  key/photo/paid-generation exit-criterion check should also confirm which
  key the real response uses and that this fallback isn't silently needed.

### Phase 5 — View polish + acceptance (`v1/polish`)

- [x] Named camera viewpoints (save/recall), viewport chrome per PRD §9
      (near-black floating control bar, pill buttons). *Agent: Sonnet.*
- [x] Surface the Figma-seeding staleness limitation in-app (PRD §7.1b: layout
      changes require redoing the MCP session manually — the app should say so,
      e.g. a note near the room/placement info, rather than silently going
      stale). *Agent: Sonnet — small, but the PRD assigns it and no phase owned
      it.*
- [x] Acceptance run: Shyam sets up his actual room shell, imports his actual
      furniture, judges against OUTCOME-3's "that's my room" bar. Fix-forward on
      whatever it surfaces. *Human-in-the-loop.*

**Progress (2026-07-21):** First two checklist items done. `Viewport.tsx` now
exposes an imperative `getCurrentView`/`flyTo` handle (camera/controls live
inside its Three.js build, not in props/state); `ViewportChrome.tsx` is the
new floating pill control bar (near-black, per PRD §9) — save-current-view,
recall, and delete, backed by a pure `scene/cameraViewpoints.ts` (unit
tested) for id/slug generation. Saved viewpoints deliberately stay out of
Viewport's structural-rebuild dependency list (`sceneFile.cameras` was
removed from that memo's deps) — recall is metadata, not scene geometry, and
rebuilding on every save would reset the camera to `cameras[0]`, undoing the
save. `ImportPanel.tsx` got a staleness note near the item/placement
controls. DESIGN.md/Cohere-fidelity check (folded in from the Phase 4
handoff note): re-reviewed the app with the chrome in place — the floating
near-black pill bar was the missing signature the earlier flat viewport
lacked; panels already matched DESIGN.md's pill-button/soft-stone-card/
hairline language. No further fixes needed. Verified in-browser via
Playwright (save/orbit-away/recall round-trip, staleness note render);
`npx vitest run` (51 tests) and `npx tsc --noEmit` both clean.
Acceptance run remains for Shyam.

**Handoff note (2026-07-21):** realladygrey picking this phase up fresh.
Branch off `main` as `v1/polish` (worktree), same `HANDOFF.md`-if-interrupted
and `/code-review`-before-merge discipline as prior phases. Beyond the three
checklist items above, fold in one thing that surfaced during Shyam's
Phase 4 acceptance run (see that phase's "Exit criterion resolved" note) —
wasn't on Phase 5's original checklist, but will visibly affect the
acceptance run's "that's my room" judgment, so worth doing alongside or
before the checklist items rather than leaving for a later pass:

- **DESIGN.md/Cohere fidelity check.** The app doesn't read as strongly
  "Cohere" yet per Shyam. Likely just current-stage minimalism — item #1
  above (viewport chrome, control bar, pill buttons) is exactly the work
  that should resolve or clarify this — but treat it as a deliberate
  check against `DESIGN.md` once that chrome lands, not an assumed non-issue.

Both other Phase 4 acceptance-run findings (sofa/floor-lamp/bedroom-door
positioning, west-wall window sizing) are fixed — see Phase 4's note.
Neither needed Figma access in the end: the sofa symptom was the
chaise-offset bug in `buildScene.ts`, and the window sizing was a units bug
in `seed/living-room.json` (`headHeightCm` set to a magnitude instead of an
absolute elevation). Nothing left over from that run for her to pick up
beyond the DESIGN.md check above.

**Acceptance run resolved 2026-07-21:** Shyam ran the real flow end to end —
his own room shell, his own furniture, all imported via the Import panel —
and judged the result **"passable"** against OUTCOME-3's bar: good enough to
close v1 on, with remaining polish deferred rather than blocking. Findings
surfaced and fixed in this pass:

- **Furniture facing/orientation wrong** (sofa, shoe rack; bookshelf
  rendered squished/on its side) — traced to a real gap: v1 had no
  mechanism to correct a Meshy GLB that comes out sideways/backwards
  (`OUTCOME-3` hit this exact class of bug and worked around it offline;
  v1's pipeline never carried a fix forward). Added an optional
  `modelRotationDeg` field (schema + `fitModelToDims` + an `ImportPanel`
  rotation picker) applied *before* the bounding-box rescale — the
  **capability** is fixed and merged. Applying it to the sofa/shoe rack
  themselves (re-running each through Import with a rotation correction)
  is deliberately **not done** on Shyam's live project — his call, since
  v2's arrangement work will likely reposition/rescale these items anyway,
  making a fix now wasted effort. Revisit when v2 touches them.
- **Re-import blocked for already-imported items** — `ImportPanel`'s item
  picker filtered out anything with a `glbHash`, so a wrong source photo
  (the water cooler) couldn't be fixed without a full delete/recreate path
  that didn't exist either. Fixed: all items are now re-import targets,
  with a distinct warning before replacing an already-imported one (a
  `/code-review` pass on this fix caught and closed 5 more findings,
  including a stale-rotation-carryover bug and a compound-sofa dims
  corruption path — see `docs/journal/` for that pass's detail).
- **Wall missing next to the water cooler** — root cause was *not* the
  furniture (confirmed by re-importing the water cooler with a correct
  photo, which didn't fix it). Live scene-graph inspection (a small
  dev-only console hook added to `Viewport.tsx`) plus a follow-up Figma
  MCP pass found the real cause: the open-kitchen alcove's walls were
  hidden in Figma when the original G2 conversion ran (seed's own
  `meta.changedSinceSpike3` already documented this) and were re-added to
  Figma afterward without the seed being updated to match. Added
  `kitchen-west-wall`/`kitchen-south-wall` to `seed/living-room.json`,
  reflecting Figma nodes `40:100`/`40:102`. The kitchen room itself stays
  out of scope for v1 (no floor/furniture, no pass-through opening) — only
  the boundary wall was needed.
- **Table lamp item lost** (deleted from Shyam's live project during
  troubleshooting) — recovered without a second paid Meshy generation: OPFS
  assets are content-addressed, so the original photo/GLB were still
  sitting there orphaned; identified by upload timestamp and file-signature
  sniffing, confirmed visually, then re-attached to a re-created item via a
  direct IndexedDB patch.
- **Shell texture quality** (wall/floor/ceiling photos look flat/poorly-lit)
  — raised, deliberately **not** fixed: doing so with AI-cleaned/generated
  textures would reopen the "texturing is local, only network call is
  Meshy" standing decision, which Shyam chose not to revisit now. Logged as
  a known v1 limitation.

Two fixes (orientation correction, kitchen walls) landed as normal
`v1/*` branch merges to `main`; the wall/lamp recoveries were direct,
narrowly-scoped patches to Shyam's live browser data (IndexedDB/OPFS), not
code changes, since his real project state — not the committed seed — was
what needed correcting.

**Exit:** PRD §10 satisfied — passable, not pixel-perfect, by Shyam's own
judgment, with remaining polish (shell texture quality chief among it)
explicitly deferred rather than silently accepted. **v1 is done.** Closing
journal entry next; v2 spike scoping becomes the next conversation. Some
Phase 5 follow-up work from realladygrey may still be in flight (per
Shyam, reviewed separately/later) — this close-out doesn't presume it's in
or out of what shipped.

## Standing orchestration mechanics

- Worktree subagents get: the phase goal, relevant PRD/DESIGN sections, and the
  instruction to commit incrementally with descriptive messages — so a killed
  session loses minutes, not the phase.
- The orchestrator updates this doc's checkboxes and merges; subagents never
  touch `main` or canonical docs.
- Anything that changes a standing decision (e.g. G1 forcing a proxy) becomes an
  ADR, not an edit to the PRD.
