# Build Plan — v2: Arrangement

**Status:** Active, 2026-07-22. Executes `PRD-v2.md`. Supersedes nothing — this is
the first implementation plan for v2, following the same shape as `plan-v1.md`.
PRD-v2 §11's open questions are resolved (elevation control and undo are in
scope, reversing that section's original "defer undo" draft recommendation;
shell-texture order, rotate-handle snapping, and multi-view-out-of-scope are
confirmed as drafted) — this plan schedules the resulting §7 build scope.

## Planning principles

1. **Interruption-safe phases.** Every phase ends with work merged to `main`, a
   journal entry via `@historian`, and its checkbox ticked here. If a session or
   weekly limit cuts a phase short, the phase's branch holds WIP with a committed
   `HANDOFF.md` note at the branch root; nothing lives only in a conversation.
   A fresh session resumes from: this doc's checkboxes → the phase branch →
   `HANDOFF.md`.
2. **Multiagent orchestration, sized to the work.** The primary session
   orchestrates: decomposes phases, spawns subagents into worktrees, reviews and
   merges. Subagents get the cheapest model that reliably does their kind of
   work (assignments per phase below) — independent of the primary session's
   model. Historian stays on its existing Stop-hook trigger — orchestration
   sessions on branches are gated out by design; journal entries land when work
   merges to `main`.
3. **Branch discipline.** Implementation phases run on `v2/<phase>` branches
   (worktrees for parallel streams). Docs and this plan's checkbox updates
   commit directly to `main`, per existing workflow. `/code-review` runs on
   each phase branch before merge — v1's pattern of "fix the real findings on
   the branch, defer the rest to the phase positioned to own them" carries
   forward unchanged.
4. **Starting point is not a blank slate.** Unlike v1, most of the arrangement
   core (move, rotate, collision, snapping, replace, multi-layout) already
   merged to `main` during the v2 spike (PRs #10–#12), reviewed and tested.
   Every phase below is hardening, a gap-closing feature, or new scope from
   §11's decisions — not a from-scratch build.

## Model assignment rationale

| Work type | Model | Why |
|---|---|---|
| Orchestration, integration review, architectural decisions | Sonnet (primary session) | Judgment-heavy, holds full context |
| Undo/history (command-stack invert + rebuild), the commit-path unification it depends on, Hunyuan async job-flow swap | Opus | Complex, correctness-critical, cross-cutting |
| Standard feature work: layout/viewpoint rename UI, elevation control, flat-texture upload control, default-placement nudge logic | Sonnet | Well-specified implementation against existing patterns (`LayoutChrome.tsx`, `ShellPanel.tsx`, `collision.ts`) |
| Shell-texture ladder, lever 1 (CC0 source + calibration) | Sonnet | Calibration against the existing tint/repeat UI, bounded scope |
| Shell-texture ladder, lever 2 (agent-driven pipeline pass) — only if lever 1 fails the bar | Opus | Open-ended pipeline work (seam removal, de-lighting) if it's reached at all |
| Scaffolding, CORS-check research, fal.ai API/docs lookups | Haiku (Explore/general-purpose) | Mechanical or read-only; speed and cost win |

## Phases

Dependency shape: `0 → 1 → {2 ∥ 3 ∥ 4} → 7`, with `5 ∥ 6` running independently
alongside everything (different files, no shared state), and `8` last once
1–7 are all merged.

### Phase 0 — Gate: Hunyuan CORS re-verification (no app code)

Carried from PRD-v2 §7.3: D5's live Meshy-vs-Hunyuan comparison in the spike
ran from Node, so the literal browser-tab CORS check ADR-0001 did for Meshy
has not been repeated for Hunyuan. Expected to pass (same fal platform and
client library) but expected ≠ verified, per the project's own discipline —
and it blocks Phase 4's provider swap, so it runs first and alone.

- [x] Minimal throwaway HTML page (scratch, not committed) exercising the full
      round trip browser-side against `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`:
      photo upload, job submission, result-GLB download. *Agent: Haiku for
      setup, then a hands-on run needs Shyam's fal.ai key — human-in-the-loop.*
      **Result (2026-07-22): PASS, all three legs.** Upload via
      `fal.storage.upload` returned a `v3b.fal.media` URL; `fal.subscribe`
      against the endpoint returned `model_glb.url` (plus `obj`/`mtl`/
      `texture` alternates, unused); GLB downloaded directly, 51,897,344
      bytes, no CORS errors on any leg. Run by Shyam via a throwaway page at
      repo root (`scratch-phase0-hunyuan-cors.html`, deleted after this run).

**Exit:** pass/fail recorded (a pass needs no ADR update — ADR-0002 already
adopted Hunyuan; a fail would need one). Phase 4 can start.

### Phase 1 — Arrangement hardening + commit-path unification (`v2/hardening`)

Foundational: Phase 7 (undo) hooks into whatever single commit path this
phase produces, so it goes first. From PRD-v2 §7.1:

- [ ] Fix `applyFurnitureImport`'s default-placement logic to behave correctly
      (and be tested) when importing while any non-default layout is active —
      currently only checks `sceneFile.current`.
- [ ] Revisit the placement-reconciliation effect's silent `if (!group) return`
      now that layout-mutating paths exist beyond import.
- [ ] Factor the commit-path duplication — `commitPlacement`, `handleImported`,
      `handleSaveView`/`handleDeleteView` (`App.tsx`), `applyImport.ts` — into
      one helper (`commitPlacement` or equivalent single entry point). This is
      the piece Phase 7 depends on: undo needs one place that writes to a
      layout's `commands[]`, not four.
- [ ] Fix snapping's wrong-direction edge case (item inside a wall's thickness
      band snapping to the far face); drag-path hot-loop cleanup
      (`getBoundingClientRect` per pointermove).
- [ ] Rotate-handle polish: camera-relative grab-target sizing; **handle-drag
      snaps to the same 15° steps as the keyboard shortcut by default, Shift
      held frees it** (PRD-v2 §11.4, decided); hover/cursor affordances;
      explicit revert on pointer-cancel; a deliberate keyboard-focus ownership
      model for viewport shortcuts.
- [ ] *Agent: Opus for the commit-path unification (cross-cutting, and Phase 7
      builds directly on its shape); Sonnet for the rest.*

**Exit:** `/code-review` clean on the branch; one commit path for all
placement-affecting actions; existing collision/snap/rename tests plus new
coverage for the non-default-layout import case pass.

### Phase 2 — Layout & viewpoint rename (`v2/rename`, parallel with 3–6)

PRD-v2 §7.2. Depends on Phase 1 merging first (touches `LayoutChrome.tsx`,
which Phase 1's `handleSaveView`/`handleDeleteView` unification also touches).

- [ ] In-place rename for saved layouts.
- [ ] In-place rename for saved camera viewpoints — same gap, same pill-bar
      pattern (`ViewportChrome.tsx`).
- [ ] *Agent: Sonnet.*

**Exit:** rename round-trips through autosave/reload for both layouts and
viewpoints; `/code-review` clean.

### Phase 3 — Elevation control (`v2/elevation`, parallel with 2, 4–6)

PRD-v2 §7.8 / §11.1 (decided). Depends on Phase 1 (uses the unified commit
path as its write point, and Phase 7 needs elevation changes to be a proper
command through that same path).

- [ ] Keyboard step and/or numeric field on the selected item, writing
      `elevationCm` (already modeled in schema/seed, currently unused by any
      UI control).
- [ ] No free vertical dragging, no stacking physics — this one scalar plus
      existing floor-plane XZ + yaw is the complete v2 placement model.
- [ ] *Agent: Sonnet.*

**Exit:** lifting an item (the C1 lamp-over-bookshelf case) works and
persists; `/code-review` clean.

### Phase 4 — Hunyuan provider swap + default placement (`v2/import`, parallel with 2, 3, 5, 6)

PRD-v2 §7.3 + §7.4 (grouped: both touch the import flow's same files).
Depends on Phase 0 (gate) and Phase 1 (touches `applyImport.ts`, one of
Phase 1's unified-commit-path files).

- [ ] Swap `src/import/falClient.ts` / `applyImport.ts` from Meshy's
      endpoint/schema to Hunyuan3D's: `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`,
      `input_image_url` in, `model_glb.url` out (already
      `GLB_URL_CANDIDATES`'s #2), `enable_pbr` on. Single-photo import only.
- [ ] Default placement for a genuinely new item with no seeded placement: a
      visible position (open floor near room center, nudged via existing
      footprint/collision math to avoid overlap), `elevationCm` accounted
      for — never `[0,0,0]` at the origin corner. This is the D0-confirmed
      acceptance criterion (PRD-v2 §3) tracing back to v1's "TV not showing"
      report.
- [ ] *Agent: Opus for the falClient/applyImport swap (async job-flow
      correctness matters, same reasoning as v1 Phase 4); Sonnet for the
      default-placement logic against existing collision helpers.*

**Exit:** a real import runs through Hunyuan end-to-end in-app; a new item
with no seed placement lands visible and collision-free; `/code-review` clean.

### Phase 5 — Shell-texture ladder (`v2/shell-quality`, parallel with everything)

PRD-v2 §7.5 / §11.2 (CC0-first decided). No file overlap with arrangement
work — independent throughout.

- [ ] Lever 1: better CC0 source textures (Poly Haven / ambientCG) calibrated
      to Shyam's surface photos via the existing tint/repeat calibration UI.
- [ ] Judged by Shyam against the same reference photos as spike C2, at the
      two standard views. If it fails the bar, lever 2 (agent-driven pass on
      `src/texturing/` — seam removal, de-lighting, higher-res input) runs as
      a second iteration, hard-capped, same lever discipline as every prior
      quality pass in this project (one iteration per lever, no loops).
- [ ] *Agent: Sonnet for lever 1; Opus only if lever 2 is reached.*

**Exit:** floor/wall/ceiling no longer read as obvious tiles at the two
standard views (retires acceptance feedback #5), or a recorded fail with
what was tried and capped expectations.

### Phase 6 — Flat-texture import UI (`v2/flat-texture-ui`, parallel with everything)

PRD-v2 §7.6. `flatItemTexture.ts` (the rug fix's underlying logic) is already
merged with no UI — this phase is purely the upload affordance.

- [ ] Per-item "use flat photo texture" upload control, mirroring
      `ShellPanel.tsx`'s per-surface upload pattern: stores the photo in OPFS,
      sets `flatTextureHash`. Box items only, per the spike's schema decision.
      Replaces the current only-path of hand-editing the persisted project
      record.
- [ ] *Agent: Sonnet.*

**Exit:** a rug-class item gets its flat texture through the UI, no manual
project-file editing required; `/code-review` clean.

### Phase 7 — Undo (`v2/undo`)

PRD-v2 §7.9 / §11.3 (decided, reversing the draft's "defer again"
recommendation). The one item in this build with no spike de-risking behind
it. Depends on Phase 1 (the unified commit path is what undo pops from),
Phase 2 (rename becomes a command type undo must cover), and Phase 3
(elevation becomes a command type undo must cover) — all three need to be
merged so undo can hook every actual committed-action type, not a subset.

- [ ] **Single-step undo**, scoped down from general history per the PRD:
      a button plus a keyboard shortcut that pops the last committed command
      — move, rotate, elevation change, replace, or layout
      save/delete/rename — off the active layout's `commands[]` and rebuilds
      the scene from what remains.
- [ ] Multi-step history and redo are explicitly out of scope for this phase
      (open implementation questions per the PRD, not decided) — build the
      single step Shyam asked for; extend only if he wants more once he's
      using it.
- [ ] *Agent: Opus — this is the one genuinely new architectural piece in the
      build, not a hardening pass.*

**Exit:** undoing after a move/rotate/elevation/replace/rename/layout-op
restores the prior state and persists correctly; `/code-review` clean.

### Phase 8 — Acceptance run (`v2/polish` if any final chrome work is needed, else direct)

Mirrors v1 Phase 5. Depends on all of Phases 1–7 merged.

- [x] Shyam sets up arrangement on his actual room: move, rotate (including
      the three known orientation bugs, absorbed by in-app rotate per the
      spike's resolution — §3 of `v2-spike-plan.md`), elevation, undo, layout
      save/switch/rename, and an item replace/import via Hunyuan3D — judged
      against PRD-v2 §10's success criteria.
      **Result (2026-07-22): pass.** Import/arrangement/undo/layouts all
      confirmed working directly against his real project. One nit noted,
      not a blocker: Hunyuan3D's color reproduction is slightly behind
      Meshy's on vividly colored items (e.g. a table lamp), though object
      shape is significantly better — the tradeoff ADR-0002 already accepted.
- [x] Confirm the shell tiles no longer make his issue list at the two
      standard views (retiring acceptance feedback #5, the last open item
      from v1's acceptance run).
      **Result (2026-07-22): pass.** Shyam uploaded the Phase 5 lever-1
      source textures (`src/assets/shell-source-textures/`) through
      `ShellPanel.tsx`'s existing upload+calibration UI on his real project
      (not auto-wired — by design, see `defaultShellTextures.ts`) and
      confirmed the tiling issue is resolved.
- [x] Fix-forward on whatever surfaces, same discipline as v1 Phase 5.
      *Human-in-the-loop.* Nothing surfaced that needed a fix — only the
      Meshy-vs-Hunyuan color nit above, which is an accepted tradeoff, not a
      defect.

**v2 is done, per Shyam's own judgment against PRD-v2 §10.**

**Exit:** PRD-v2 §10 satisfied by Shyam's own judgment. **v2 is done.**
Closing journal entry next; v3 (measurement) scoping becomes the next
conversation, per PRD-v2 §4 — not opened here.

## Standing orchestration mechanics

- Worktree subagents get: the phase goal, relevant PRD-v2/DESIGN sections, and
  the instruction to commit incrementally with descriptive messages — so a
  killed session loses minutes, not the phase.
- The orchestrator updates this doc's checkboxes and merges; subagents never
  touch `main` or canonical docs.
- Anything that changes a standing decision (e.g. Phase 0's gate forcing a
  proxy, which ADR-0001/0002 don't currently anticipate) becomes an ADR, not
  an edit to the PRD.
