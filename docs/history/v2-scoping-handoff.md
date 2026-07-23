# v2 spike-scoping — handoff note

**For:** a new session (Fable) picking up v2 scoping cold. This file is the full brief —
you don't have the conversation that produced it.

## Where things stand

v1 (`PRD-v1.md`, `plan-v1.md`) is functionally built — five phases merged. Phase 5's
last checklist item, the human acceptance run, is done: Shyam set up his actual room,
imported his actual furniture, and judged it. Verdict: **"passable — just clears the
minimum requirements."** Real issues surfaced (listed below). Per `plan-v1.md`'s Phase 5
exit note, "v2 spike scoping becomes the next conversation" — that conversation is now.

Per **PRD-v1.md §11** (standing decision, don't relitigate without reopening scope —
scope *has* been explicitly reopened by Shyam and Supritha, see below): v2 (Arrangement)
gets **a dedicated spike first** — drag/drop interaction, collision/overlap detection,
snapping, multi-layout save — before its own PRD, since it has zero spike coverage
unlike v1's three precursor spikes (`poc-plan.md`, `poc2-plan.md`, `poc3-plan.md`,
outcomes in `spike/OUTCOME*.md`). Rough estimate from that section: 3–5 weeks once
scoped. That estimate predates the scope expansion below and should be revisited.

## Your task

Draft the v2 spike-scoping doc (follow the `poc2-plan.md`/`poc3-plan.md` shape: decision
bar, framing, risks, delegation map, cost estimate — whatever fits an arrangement-
interaction spike). This is planning only, no code. Check with Supritha/Shyam before
finalizing anything that reads as a firm commitment rather than a draft.

## Scope for this spike — confirmed with Shyam and Supritha

The acceptance run produced seven feedback items. They've already been triaged into
buckets — don't re-litigate the triage, just work from it:

1. *(general verdict, "passable, minimum bar" — not an action item)*
2. **Orientation bugs** (ÄPPLARYD sofa, shoe rack facing wrong way; bookshelf cubbies
   on the narrow end instead of the wide end) — **in scope for v2.** Open question worth
   addressing in the spike: if v2 ships in-app rotate, these may not need a data/code
   fix at all — the UI absorbs them. Decide whether to still patch seed data now or let
   v2 handle it.
3. **Replace/re-import a single item's asset** (Shyam's water-cooler photo was wrong,
   no way to swap the GLB after the fact) — **in scope for v2.** Item-level edit
   operation, same family as move/rotate.
4. **Poor rug render quality** — **in scope for v2** (explicitly pulled in by Shyam/
   Supritha as a known v1 issue to fix here, even though it's not really an
   "arrangement" problem per se).
5. **Floor/wall/ceiling textures look bad as tiles** — Shyam wants either a better CC0
   source texture swapped in, or an agent-driven pass to make the photo-derived texture
   look more realistic. **In scope for v2** (same explicit pull-in as #4). This is
   `spike/textures/` / Phase 3 texturing-pipeline territory, not really arrangement —
   flag that in the doc so it's a visible scope choice, not a silent one.
6. **Missing kitchen-outer wall** next to the water cooler (shell/wall-generation bug)
   — **explicitly OUT of scope here.** Shyam is fixing this himself, resuming his own
   Claude session. Do not touch it.
7. **Hunyuan 3D produced noticeably better import results than Meshy** in an informal
   test, and supports multi-angle photo input (Meshy doesn't) — **in scope as a
   comparison spike feeding v2.** This connects to `PRD-v1.md §11`'s already-flagged
   "multi-state furniture" idea (multi-angle photos as separate states of one object,
   explicitly noted as unscoped/needs-design). It also matters for v3 (measurement)
   accuracy later, since better geometry fidelity improves clearance/distance math —
   worth noting the cross-version payoff in the doc, but v3 stays out of scope for the
   actual planning here (v3 depends on v2's placement model, per §11, and isn't being
   opened yet).

So net: this spike is no longer just "drag/drop, collision, snapping, multi-layout" —
it now also needs to scope item-replace, a render-quality fix pass (rug + shell
textures), and a Meshy-vs-Hunyuan comparison. That's a real scope expansion beyond the
PRD §11 stub, done with explicit buy-in from both Shyam and Supritha this round — write
it into the doc as a deliberate decision, not an assumption.

## Constraints / context to preserve

- **Standing architecture decision:** only network call is fal.ai Meshy
  (`docs/adr/0001-fal-browser-direct.md`). Adding/comparing Hunyuan 3D would touch this
  — treat as an open question the spike should answer, not something to silently
  decide. If the spike recommends adding or switching providers, that's an ADR later,
  not a PRD assumption now.
- **Browser-only, no backend** — still the standing shell decision (CLAUDE.md). Any
  provider comparison work should stay client-side/API-call-only, consistent with how
  Meshy is integrated today (`src/import/falClient.ts`).
- Don't pull v3 (measurement) forward — it's referenced above only because Hunyuan's
  accuracy payoff is cross-version context, not because v3 is being scoped now.
- Historian/journal: once this doc is real and lands on `main`, the Stop hook picks it
  up automatically (primary checkout on `main` only — this note itself doesn't need
  journaling, the resulting plan doc does).

## Where to look

- `PRD-v1.md` §11 (Future/deferred section — the v2/v3 stubs)
- `plan-v1.md` (Phase 5 section, exit note)
- `poc2-plan.md`, `poc3-plan.md` (shape to follow for a spike-scoping doc)
- `spike/OUTCOME*.md` (what "GO"/"NO-GO" verdicts looked like for prior spikes)
- `docs/adr/0001-fal-browser-direct.md` (the Meshy-only decision #7 touches)
- `CLAUDE.md` (conventions: ISO dates, ADR supersede-don't-edit, don't expand scope
  silently)
