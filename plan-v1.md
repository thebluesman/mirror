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
2. **Multiagent orchestration, sized to the work.** The primary session (Fable)
   orchestrates: decomposes phases, spawns subagents into worktrees, reviews and
   merges. Subagents get the cheapest model that reliably does their kind of work
   (assignments per phase below). Historian stays on its existing Stop-hook
   trigger — orchestration sessions on branches are gated out by design; journal
   entries land when work merges to `main`.
3. **Branch discipline.** Implementation phases run on `v1/<phase>` branches
   (worktrees for parallel streams). Docs and this plan's checkbox updates commit
   directly to `main`, per existing workflow. `/code-review` runs on each phase
   branch before merge.

## Model assignment rationale

| Work type | Model | Why |
|---|---|---|
| Orchestration, integration review, architectural decisions | Fable (primary session) | Judgment-heavy, holds full context |
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

**Exit:** project persists across a browser restart (PRD §10's persistence
criterion, testable before flows exist); Phase 1 viewport reads from the store
instead of the static file.

### Phase 3 — Shell texturing flow (`v1/texturing`, parallel with 2)

- [ ] **Reimplement** (not port) `spike/textures/`'s tileable-texture pipeline
      in-browser (local, no network). Scoped honestly: `make-tileable.mjs` is
      built on **sharp**, a native Node library that cannot run in a browser —
      the quadrant-swap + cross-fade logic must be rewritten on Canvas/
      OffscreenCanvas, and the spike's no-visible-seams check re-verified against
      the new implementation. `shell-textures.mjs`'s mesh-targeting is also
      coupled to `scene2.html`'s specific material structure and needs redoing
      against Phase 1's viewport component. The *algorithms* are proven; the
      *code* is not reusable as-is. *Agent: Sonnet; Opus only if the rewrite hits
      real architectural friction.*
- [ ] Upload UI (wall/floor/ceiling photos) + calibration panel — tint/repeat
      sliders replacing the spike's hand-edited `calibration.json` (PRD §7.2).
      Upload/processing states designed ad-hoc from `DESIGN.md` tokens; flag to
      Shyam for a Figma pass only if the ad-hoc version isn't good enough.
      *Agent: Sonnet.*

**Exit:** shell textured from Shyam's photos entirely in-app, calibrated via
sliders, persisted (rebase onto Phase 2's store at merge).

### Phase 4 — Furniture import flow (`v1/import`)

Depends on **2 merged and G1's answer** — not on 3: import and shell texturing
touch different parts of the scene, so a slow texturing phase must not block
the riskiest flow in v1. Whichever of 3/4 merges second rebases.

- [ ] *(Only if G1's ADR says browser-direct fails)* Build the minimal local
      proxy helper G1 scoped, before the flow work below. *Agent: Sonnet.*
- [ ] Settings panel: fal.ai key paste, stored in IndexedDB, never bundled.
      *Agent: Sonnet.*
- [ ] Meshy job flow: photo upload → cost-surfacing confirm step → async
      generation with progress → GLB into OPFS. Failure leaves no half-imported
      item; per-item retry reuses the uploaded photo. Consider passing the photo
      as a base64 data URI in the generate request instead of a separate upload
      call — fal.ai accepts data URIs for image inputs, which drops one network
      call and one CORS failure point, at ~33% larger payload (watch request-size
      limits on large phone photos). *Agent: Opus — the async/failure semantics
      are the risky part.*
- [ ] Post-generation: confirm/adjust cm dimensions → rescale + floor-snap →
      place at Figma-seeded position/rotation (default position if no footprint).
      *Agent: Sonnet, against spike 3's proven scaling/snapping logic.*

**Exit:** one real furniture item goes photo → Meshy → placed in the rendered
room, in-app, with a paid generation Shyam approved.

### Phase 5 — View polish + acceptance (`v1/polish`)

- [ ] Named camera viewpoints (save/recall), viewport chrome per PRD §9
      (near-black floating control bar, pill buttons). *Agent: Sonnet.*
- [ ] Surface the Figma-seeding staleness limitation in-app (PRD §7.1b: layout
      changes require redoing the MCP session manually — the app should say so,
      e.g. a note near the room/placement info, rather than silently going
      stale). *Agent: Sonnet — small, but the PRD assigns it and no phase owned
      it.*
- [ ] Acceptance run: Shyam sets up his actual room shell, imports his actual
      furniture, judges against OUTCOME-3's "that's my room" bar. Fix-forward on
      whatever it surfaces. *Human-in-the-loop.*

**Exit:** PRD §10 satisfied end to end; closing journal entry; v2 spike scoping
becomes the next conversation.

## Standing orchestration mechanics

- Worktree subagents get: the phase goal, relevant PRD/DESIGN sections, and the
  instruction to commit incrementally with descriptive messages — so a killed
  session loses minutes, not the phase.
- The orchestrator updates this doc's checkboxes and merges; subagents never
  touch `main` or canonical docs.
- Anything that changes a standing decision (e.g. G1 forcing a proxy) becomes an
  ADR, not an edit to the PRD.
