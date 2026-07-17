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

- [ ] **G1 — fal.ai CORS verification.** Minimal throwaway HTML page (scratch, not
      committed as product code) calling `fal-ai/meshy/v6/image-to-3d` browser-side
      with a pasted key. Outcome recorded as an ADR: browser-direct works, or v1
      grows a minimal local proxy helper. *Agent: Haiku for docs research, then
      hands-on run needs Shyam's fal.ai key — human-in-the-loop.*
- [ ] **G2 — Figma conversion session.** Agree layer/naming conventions, then the
      one-time MCP session converting the Figma room layout → seed scene JSON
      (room dims, openings, per-item position/rotation — spike 3's `geometry.json`
      successor, but in the v1 schema shape from Phase 2's draft). Hand-in-the-loop
      with Shyam; numbers are a starting point, calibration comes later. Seed JSON
      committed to the repo. *Agent: primary session (Fable) — this is the
      judgment-heavy conversion the PRD describes.*

**Exit:** ADR for G1 outcome; committed seed scene JSON; journal entry.
*Both gates need Shyam present — schedule them for an interactive session; they're
small and front-loaded precisely so later phases can run more autonomously.*

### Phase 1 — Scaffold + render core (`v1/scaffold`)

- [ ] Vite + React + Three.js scaffold; `DESIGN.md` tokens as CSS custom
      properties; light-canvas app shell (header, viewport, side panel skeleton).
      *Agent: Haiku (scaffold/tokens), Sonnet (shell components).*
- [ ] Port `spike/scene2.html`'s Three.js core into a React-managed viewport
      component: PBR renderer, lighting, orbit/pan/zoom. Loads the Phase 0 seed
      JSON statically (no storage layer yet) and renders the untextured shell +
      any spike GLBs available. *Agent: Opus, worktree. Spike code is read-only
      reference — productize, don't edit `spike/`.*

**Exit:** `npm run dev` shows the room shell from seed data with camera control.
Merged, reviewed, journaled.

### Phase 2 — Storage layer (`v1/storage`, parallel with 3)

- [ ] Versioned JSON project schema — Room, Furniture Item, Camera Position, and
      the `layouts: [{name, base, commands[]}]` / `current` branch shape from day
      one (PRD §8). Schema module + validation + migration stub. *Agent: Opus.*
- [ ] OPFS content-addressed asset store (hash → blob), IndexedDB autosave,
      File System Access API save/load with download/upload fallback, zip export.
      *Agent: Opus (store design), Sonnet (zip/fallback plumbing).*
- [ ] Unit tests for schema round-trip, hashing, autosave restore. *Agent: Sonnet.*

**Exit:** project persists across a browser restart (PRD §10's persistence
criterion, testable before flows exist); Phase 1 viewport reads from the store
instead of the static file.

### Phase 3 — Shell texturing flow (`v1/texturing`, parallel with 2)

- [ ] Port `spike/textures/` tileable-texture pipeline to run in-browser (local,
      no network). *Agent: Sonnet; Opus only if the port hits real architectural
      friction.*
- [ ] Upload UI (wall/floor/ceiling photos) + calibration panel — tint/repeat
      sliders replacing the spike's hand-edited `calibration.json` (PRD §7.2).
      Upload/processing states designed ad-hoc from `DESIGN.md` tokens; flag to
      Shyam for a Figma pass only if the ad-hoc version isn't good enough.
      *Agent: Sonnet.*

**Exit:** shell textured from Shyam's photos entirely in-app, calibrated via
sliders, persisted (rebase onto Phase 2's store at merge).

### Phase 4 — Furniture import flow (`v1/import`)

Depends on 2 + 3 merged and G1's answer.

- [ ] Settings panel: fal.ai key paste, stored in IndexedDB, never bundled.
      *Agent: Sonnet.*
- [ ] Meshy job flow: photo upload → cost-surfacing confirm step → async
      generation with progress → GLB into OPFS. Failure leaves no half-imported
      item; per-item retry reuses the uploaded photo. *Agent: Opus — the async/
      failure semantics are the risky part.*
- [ ] Post-generation: confirm/adjust cm dimensions → rescale + floor-snap →
      place at Figma-seeded position/rotation (default position if no footprint).
      *Agent: Sonnet, against spike 3's proven scaling/snapping logic.*

**Exit:** one real furniture item goes photo → Meshy → placed in the rendered
room, in-app, with a paid generation Shyam approved.

### Phase 5 — View polish + acceptance (`v1/polish`)

- [ ] Named camera viewpoints (save/recall), viewport chrome per PRD §9
      (near-black floating control bar, pill buttons). *Agent: Sonnet.*
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
