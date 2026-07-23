# v2 Spike Plan — Arrangement + Quality (post-v1 acceptance)

**Status: APPROVED (2026-07-21)** — reviewed and approved by Shyam (via Supritha),
with the §3 and §8 answers folded in below. Nothing is implemented yet.

Successor to the spike arc (`poc-plan.md` → `poc2-plan.md` → `poc3-plan.md`,
outcomes in `spike/OUTCOME*.md`) and to the v1 build (`PRD-v1.md`, `plan-v1.md` —
five phases merged, acceptance run done). The acceptance verdict was **"passable —
just clears the minimum requirements"**: v1's import + view pipeline works on
Shyam's real room, and the gap to "good" is now concrete — seven feedback items,
already triaged with Shyam and Supritha (see §1).

Per PRD-v1 §11, v2 (Arrangement) gets a dedicated spike before its own PRD — it is
the one workstream with zero spike coverage. This plan scopes that spike. The
question it answers:

**Can in-app arrangement — move, rotate, replace, collision, snapping, multi-layout
— be made decision-grade in the browser viewport, and can the two quality gaps the
acceptance run surfaced (rug, shell textures) plus the Meshy-vs-Hunyuan generation
question be closed alongside it?**

This is a scoping + delegation plan, planning only, no code.

## 1. Scope — expanded beyond the PRD §11 stub, deliberately

The PRD §11 stub scoped this spike as "drag/drop interaction, collision/overlap
detection, snapping, multi-layout save." The acceptance run's feedback triage —
done explicitly with Shyam and Supritha this round, so scope has been formally
reopened, not drifted — pulls in three more things. Recording the mapping so the
expansion is a visible decision:

| Feedback item | Disposition here |
|---|---|
| 1. "Passable, minimum bar" verdict | Context, not an action item |
| 2. Orientation bugs (ÄPPLARYD sofa, shoe rack, bookshelf cubby side) | **W-A** — in-app rotate absorbs these; seed-data patch decision in §3 |
| 3. Replace/re-import a single item's asset (wrong water-cooler photo) | **W-A** — item-level edit operation, same family as move/rotate |
| 4. Poor rug render quality | **W-B** — explicitly pulled in by Shyam/Supritha; not an arrangement problem, and flagged as such |
| 5. Floor/wall/ceiling textures look bad as tiles | **W-B** — same explicit pull-in; this is Phase-3/texturing-pipeline territory, not arrangement — a visible scope choice, not a silent one |
| 6. Missing kitchen-outer wall (shell-generation bug) | **OUT.** Shyam is fixing this himself in his own session. Not touched here |
| 7. Hunyuan 3D beat Meshy in an informal test; supports multi-angle input | **W-C** — comparison spike; touches ADR-0001, see §5 |
| 8. TV object not showing despite a completed image import (reported 2026-07-21, after the first triage) | **W-A (D0)** — likely the Phase 4 GLB-load-failure silent-fallback path or an asset-integrity miss; diagnose first, since a swallowed load error would also undermine W-A's replace flow |

Net: three workstreams instead of one. The PRD's 3–5-week v2 estimate predates
this expansion; §8 revises it.

**What a "go" unlocks:** PRD-v2 gets written from this spike's outcomes, the same
way PRD-v1 was written from OUTCOME-3. The spike does not build v2 — it retires
v2's unknowns.

## 2. The decision bars (set now, before any building)

Each workstream has its own bar, judged separately — a no-go in one does not sink
the others. As in every prior spike: if borderline, one outside reaction
(Supritha) before recording.

### W-A — Arrangement interaction (the core question)

Prototyped in the real app viewport (see §4 on where the code lives), on Shyam's
actual room data. Bar, judged by Shyam driving the prototype himself:

- **Move**: drag an item across the floor plane in the 3D viewport; it tracks the
  cursor without jumping, jittering, or losing the item.
- **Rotate**: rotate a selected item in place (handle or keyboard step); the three
  known orientation bugs (#2) become fixable by Shyam in under a minute total.
- **Collision/overlap**: items visibly flag interpenetration (item-vs-item and
  item-vs-wall). Footprint-rectangle detection is enough — this is decision
  support, not physics.
- **Snapping**: against-the-wall and edge-to-edge alignment helps more than it
  fights; must be escapable (hold-to-disable or similar).
- **Replace**: swap one item's GLB via re-import (new photo → new asset hash)
  while keeping its placement, scale-to-cm, and identity.
- **Multi-layout**: save the current arrangement as a named layout, make a second
  one, switch between them; both survive reload. The `layouts[]`/`current` branch
  shape has been in the schema since v1 (`src/schema/scene.ts`) precisely for
  this — the spike proves the shape works, it doesn't design a new one.

**Go** = Shyam can rearrange his real room and trust what he sees — the
interactions are decision-grade, not tech-demo-grade. **Go-with-constraints** =
core move/rotate/save works but a named piece (e.g. snapping, or 3D dragging
itself) needs a different approach — recorded as a constraint for PRD-v2, e.g.
falling back to a top-down orthographic arrange mode (§6 keeps that fallback in
reserve, not built by default). **No-go** = direct manipulation in the viewport
can't be made trustworthy → v2's interaction model reopens entirely before any
PRD is written.

### W-B — Render quality (rug + shell textures)

Judged side-by-side against the same reference photos as OUTCOME-3's C2 —
this was a *noted, minor reservation* in that clean go ("floor and wall textures
could have been better") that the acceptance run promoted to a real issue.

- **Rug**: currently the worst-rendering item. Try, in cost order: re-generate
  from a better (straight-on, evenly-lit) photo per OUTCOME-3's input-quality
  finding; flat textured plane/box with the photo-derived texture instead of a
  generated mesh; CC0 fabric normal/roughness over the photo albedo.
- **Shell tiles**: floor/wall/ceiling read as obvious tiles. Two candidate fixes,
  per the triage: swap in better CC0 source textures (Poly Haven/ambientCG)
  calibrated to Shyam's surface photos, or an agent-driven pass on the
  photo-derived textures (`src/texturing/`) — better tileability (seam removal,
  larger effective tile), de-lighting, higher-res input.

**Pass** = at the two standard views, rug and shell no longer appear on Shyam's
issue list — the "could have been better" reservation is retired. **Fail** = the
levers above don't close it → record what was tried and cap expectations in
PRD-v2 rather than looping (one iteration per lever, not a loop — same discipline
as poc3's qualified-go branch).

### W-C — Generation provider comparison (Meshy vs. Hunyuan 3D)

The informal finding ("Hunyuan noticeably better, supports multi-angle") gets the
same rigor OUTCOME-3 applied to Meshy — nothing counts until the GLB renders in
the app's own lighting (the viewer-flattery risk, verbatim from poc3 §3).

- **Like-for-like gate**: 3 items generated on both providers from the same
  single input photo, rescaled to cm, judged in-app under OUTCOME-3's C1 rules
  (silhouette, voids, color, category, back-view angle, no regression vs.
  neighbors). Item slate (draft, Shyam to confirm): **water cooler** (needs
  regeneration anyway per #3), **rug** (worst current render; overlaps W-B
  deliberately — one generation serves both verdicts), **bookshelf** (OUTCOME-3's
  weakest pass, so the most room to show a difference).
- **Multi-angle test**: 1–2 items generated from 2–3 angles via Hunyuan's
  multi-view input — the capability Meshy lacks. This is also the cheapest
  possible probe of PRD §11's "multi-state furniture" idea (multiple photos of
  one item), so the outcome doc should note what multi-view input does and
  doesn't buy for that — without designing the feature.

**Verdicts the spike must produce** (a recommendation, not a decision — see §5):
(a) is Hunyuan's quality edge real under app lighting, or viewer flattery?
(b) does multi-angle input materially fix back-view/fidelity failures?
(c) what would adoption cost — is Hunyuan reachable browser-direct via fal.ai
(fal hosts Hunyuan3D model endpoints; the spike verifies the same three CORS legs
ADR-0001 verified for Meshy), and what's the per-generation price delta?

## 3. Seed orientation data: RESOLVED — no patch, v2's rotate absorbs it

Shyam's call (2026-07-21): skip the seed patch; the wrong-facing renders are not
an issue for the interim, and W-A's in-app rotate is the fix. The plan's earlier
patch-now recommendation is overridden and D0 is repurposed (§7).

**Correct orientations, recorded here as the C1 acceptance reference** (Shyam
fixes these himself via rotate when driving the W-A prototype — doing so *is*
part of the C1 bar):

- **ÄPPLARYD sofa** — faces the TV / media console / coffee table.
- **Shoe rack** — same orientation as the sofa.
- **Bookshelf** — the open cubbies (square holes) face the window; the closed
  back faces the dining table.

## 4. Where the spike code lives

Unlike spikes 1–3, W-A and W-B cannot be standalone HTML files: arrangement needs
the real `Viewport.tsx`/`buildScene.ts` scene graph and the real schema, and W-B
targets `src/texturing/` and real OPFS assets. So:

- **W-A and W-B are app branches** (`v2/spike-arrange`, `v2/spike-quality`),
  normal worktree discipline, prototype-quality code clearly marked. What
  merges to `main` at the end is decided at C4 per workstream: quality fixes
  (W-B) likely merge as v1 patches; arrangement code (W-A) merges only if it's
  genuinely the seed of the v2 build, otherwise it stays a branch as evidence.
- **W-C is scripted**, like spike 3 (`spike/generate.py` lineage) — but new
  scripts and outputs go in a **new `spike-v2/` directory**, not `spike/`, which
  is frozen evidence per CLAUDE.md.
- The outcome doc is `spike-v2/OUTCOME.md`, same format as prior outcomes: what
  ran, what held, what drifted, decision + implication — feeding PRD-v2.

## 5. Constraints carried in (not re-litigated here)

- **ADR-0001 (fal.ai browser-direct, Meshy the only network call).** W-C
  *touches* this but does not change it: the spike produces evidence and a
  recommendation; adopting or adding Hunyuan is a **new ADR superseding or
  amending 0001**, written only after the spike, never assumed in PRD-v2's
  draft. Until that ADR exists, Meshy remains the provider.
- **Browser-only, no backend** (CLAUDE.md). W-C stays client-side/API-only —
  the comparison prefers fal-hosted Hunyuan endpoints for exactly this reason.
  If Hunyuan turns out to require a server or fails browser CORS, that is a
  *finding* (raises its adoption cost), not a license to add a proxy.
- **v3 (measurement) stays closed.** Hunyuan's geometry fidelity has a
  cross-version payoff — better meshes improve v3's future clearance/distance
  math — and the outcome doc may say so in one sentence. Nothing in this spike
  plans, designs, or depends on v3.
- **Feedback item #6 (missing kitchen-outer wall)** is Shyam's, in his own
  session. No workstream touches shell wall generation.

## 6. Known risks (so they're tested, not discovered)

- **3D direct manipulation is genuinely hard to make feel good.** Camera-relative
  dragging, floor-plane ray-casting, occlusion while dragging — this is the
  spike's core uncertainty and why W-A runs first. Named fallback if 3D dragging
  fails the bar: top-down orthographic arrange mode (kept in reserve, not built
  by default).
- **Scene-rebuild architecture vs. per-frame interaction.** v1's viewport
  structurally rebuilds the scene from data on change (Phase 5 already had to
  carve camera recall out of that rebuild path). Sixty-fps dragging cannot
  rebuild per frame; W-A must find the mutate-during-gesture/commit-on-drop
  seam without forking the data model. This is the most likely source of
  ugly-but-instructive spike code.
- **Layout branches meet item identity.** Replace (new `glbHash`) lives on the
  *item*; placement lives in *layout commands*. The spike must check a swap
  behaves sanely across multiple saved layouts (it should — placements reference
  `itemId`, not the asset — but "should" is what spikes are for).
- **Viewer flattery, round 2.** Shyam's informal Hunyuan test was almost
  certainly in a hosted preview viewer. OUTCOME-3's rule stands: nothing counts
  until it renders in the app's sun + IBL. The C3 gate exists for this.
- **Which Hunyuan? RESOLVED:** Shyam's test ran a fal-hosted Hunyuan3D endpoint
  via the fal dashboard — so W-C compares the exact model it would adopt, and R1
  narrows to identifying the endpoint/version/pricing plus the CORS-leg plan.
  The viewer-flattery caveat stands in full: the dashboard's preview viewer is
  precisely the flattering context OUTCOME-3 warns about, so the C3 in-app
  judgment remains the only one that counts.
- **Texture-pass rabbit hole.** "Agent-driven pass to make textures more
  realistic" is open-ended by nature. W-B is lever-per-iteration, one iteration
  each, hard-capped — the poc2 lesson (fidelity bottlenecks on authoring hours)
  applies to texture fiddling verbatim.

## 7. Workstreams and delegation map

W-A is the long pole and the reason the spike exists; it starts first and alone
(single-viewport code, same serial-build logic as poc2). W-B and W-C are
parallel-safe against it (different files/assets) once W-A is underway.

| # | Task | Agent type | Runs | Inputs | Output / done criteria |
|---|---|---|---|---|---|
| D0 | **TV-not-showing diagnosis (#8)**: trace the TV item's import through asset store → GLB load → scene placement; the Phase 4 fallback intentionally degrades a failed GLB load to "looks unimported", so check whether the asset is corrupt/missing (OPFS), the load silently failed, or placement put it out of view. Fix if small; otherwise record cause for v2 | general-purpose (build) | first, tiny — before or alongside D1 | Shyam's project file/OPFS state (or a reproduction via the same TV image) | cause identified; TV visible or a recorded diagnosis with the fix scoped |
| D1 | W-A core: selection + floor-plane drag + rotate in `Viewport.tsx`, mutate-during-gesture seam | general-purpose (build) | first, alone on the branch | v1 app, Shyam's room data | movable/rotatable items, screen-recording + Playwright-driven captures |
| D2 | W-A rules: footprint collision flagging + wall/edge snapping | general-purpose (build) | after D1 (same files) | D1 branch | collision/snap behaviors per §2 bar |
| D3 | W-A persistence: named layouts (save/switch/reload) + item replace via re-import | general-purpose (build) | after D2 | D2 branch, existing `layouts[]` schema, `applyImport.ts` | two persistent layouts + one successful asset swap |
| R1 | W-C research: fal-hosted Hunyuan3D endpoint/version/pricing survey; identify which Hunyuan Shyam's informal test used; CORS-leg check plan | Explore/general-purpose (research) | parallel with D1 | ADR-0001, fal docs | short memo: endpoint, price, browser-direct feasibility, comparison protocol |
| D4 | W-B: rug fix ladder + shell texture pass (one iteration per lever per §2) | general-purpose (build) | parallel with D2–D3 (different files) | surface/reference photos, `src/texturing/`, new rug photo from Shyam | before/after contact sheet at both standard views |
| D5 | W-C: 3-item Meshy-vs-Hunyuan generation + 1–2 multi-angle Hunyuan runs, rescale, in-app render harness | general-purpose (build) | after R1, parallel with D4 | R1 memo, item photos, FAL_KEY (+ Hunyuan key if separate) | `spike-v2/` scripts + side-by-side contact sheet incl. back views |
| C1 | **Checkpoint (Shyam): drives D3's build** hands-on against the W-A bar | human | after D3 | the running branch | W-A go / go-with-constraints / no-go |
| C2 | **Checkpoint (Shyam):** W-B before/after vs. reference photos | human | after D4 | D4 contact sheet | rug + shell pass/fail per §2 |
| C3 | **Checkpoint (Shyam):** W-C side-by-sides in-app | human | after D5 | D5 contact sheet | §2's three W-C verdicts recorded |
| C4 | **Record:** `spike-v2/OUTCOME.md`; merge decisions per §4; PRD-v2 drafting becomes the next conversation | human | last | everything | outcomes written; ADR question (Hunyuan) explicitly opened or closed |

Checkpoint independence: C1–C3 can land in any order as their workstreams finish;
C4 waits for all three. A W-A no-go at C1 does not stop C2/C3 — quality fixes and
the provider answer are worth having under any v2 interaction model.

## 8. Inputs needed from Shyam

Answered 2026-07-21 (via Supritha):

1. ~~**Correct orientations** for the three misfacing items~~ — **answered**,
   recorded in §3 as the C1 acceptance reference.
2. ~~**Which Hunyuan he tested**~~ — **answered**: fal-hosted Hunyuan3D, run
   from the fal dashboard (see §6).
3. **W-C item slate** (water cooler, rug, bookshelf) — **confirmed**.

Still to arrive when the workstreams reach them:

4. **Photos**: a better straight-on rug photo (D4); item photos for the W-C
   slate, ideally the same source photos Meshy got, plus 2–3 angles of 1–2 items
   for the multi-view test (D5); the correct water-cooler photo (fixes #3's
   original complaint while serving W-C). *Shyam has confirmed he can provide.*
5. **FAL_KEY** at D5 run time (inline, never committed), plus any separate
   Hunyuan credential if R1 finds fal-hosted endpoints insufficient. *Confirmed
   available.*
6. **The TV item's project state** for D0 — export/zip of the project (or at
   least the console output when loading), or failing that the TV source image
   so D0 can reproduce the import.
7. **Hands-on time at C1** — unlike prior spikes' contact-sheet judgments,
   the arrangement bar can only be judged by driving it.
8. At C1–C4: judgment against the §2 bars, set before looking at results.

## 9. Explicitly out of scope

- **No PRD-v2 drafting inside the spike** — the spike ends in an OUTCOME doc;
  the PRD is the next conversation, shaped by it.
- **No kitchen-wall fix (#6)** — Shyam's own session owns it.
- **No v3 (measurement) work** — cross-version payoff noted in one line, nothing
  more.
- **No provider switch** — W-C produces a recommendation; any adoption is a
  post-spike ADR (§5).
- **No multi-state furniture design** — D5's multi-angle runs probe feasibility
  only; storage/switching design stays unscoped per PRD §11.
- **No general physics, no free 3D transform** — floor-plane placement + yaw
  rotation only; no vertical stacking, no tilt, no physics engine.
- **No undo/history system** — the schema's `commands[]` shape anticipates one;
  building it is v2-proper at the earliest.
- **No top-down 2D editor by default** — it is the named W-A fallback, built
  only if C1 lands on go-with-constraints naming it.
- **No touching `spike/`** — frozen evidence; new artifacts go to `spike-v2/`.

## 10. Cost, schedule, and record-keeping

- **API cost:** W-C is the only spend — 3 items × 2 providers + 2 multi-angle
  runs + retries ≈ **$10–20** (R1 confirms Hunyuan pricing; Meshy ≈ $0.80/run
  held in spike 3). W-B adds ~$1–3 only if the rug ladder's regeneration rung
  runs. Everything else is local.
- **Schedule (draft, supersedes nothing):** W-A ≈ 1–1.5 weeks; W-B ≈ 2–4 days;
  W-C ≈ 2–4 days, largely parallel → **spike ≈ 2 weeks elapsed.** The PRD §11
  "3–5 weeks" figure was for v2 *once scoped*; with the scope expansion, the
  v2 build estimate gets re-cut in PRD-v2 from this spike's outcomes rather
  than restated here.
- **Deliverable:** `spike-v2/OUTCOME.md` in the established format, with per-
  workstream verdicts (W-A interaction, W-B quality, W-C provider) recorded
  separately, so a mixed result stays legible. Once this plan and later the
  outcome land on `main`, the historian hook journals them (primary checkout
  on `main` only, per CLAUDE.md).
